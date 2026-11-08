import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { decodePaymentSignatureHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { paymentMiddleware } from '@x402/hono';
import { isBatchPayload } from '@x402/svm';
import { BatchSvmScheme } from '@x402/svm/batch-settlement/server';
import { createModelDatabase, type ModelDatabaseInput } from './model-database.ts';
import type { X402Config } from './x402-payment.ts';
import { createMandateStore, type MandatePolicy, type MandateQuote, type MandateReservation } from './model-mandates.ts';
import { createChannelStore } from './model-channel-store.ts';
import type { createModelStore, ModelPurchase } from './model-store.ts';
import type { createModelCatalog } from './model-catalog.ts';
interface Options {
    db: ModelDatabaseInput;
    secret: string;
    config: X402Config | null;
    ready: boolean;
    channelReady: boolean;
    purchases: ReturnType<typeof createModelStore>;
    catalog: ReturnType<typeof createModelCatalog>;
    execute: (owner: string, id: string) => Promise<ModelPurchase>;
    prepare: (owner:string,id:string)=>Promise<ModelPurchase>;
}
export function createModelMandateApp(options: Options) {
    const app = new Hono<{
        Variables: {
            owner: string;
        };
    }>();
    const db = createModelDatabase(options.db);
    const mandates = createMandateStore(options.db), channels = createChannelStore(options.db), purchases = options.purchases;
    let batchPromise: ReturnType<typeof setup> | null = null;
    async function setup() {
        const config = options.config;
        if (!options.channelReady || !config)
            throw new Error('Payments are not configured');
        const closeSigner = await createKeyPairSignerFromPrivateKeyBytes(createHash('sha256').update('helixbox-channel-close-v1\0').update(options.secret).digest());
        const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
        const supported = await facilitator.getSupported();
        const kind = supported.kinds.find(k => k.x402Version === 2 && k.network === config.network && k.scheme === 'batch-settlement');
        if (!kind)
            throw new Error('Facilitator does not support Solana batch settlement');
        const scheme = new BatchSvmScheme({ store: channels, receiverAuthorizer: closeSigner, withdrawDelay: 3600 });
        const invalid = scheme.validateFacilitatorSupport(config.network, kind, []);
        if (invalid)
            throw new Error(invalid);
        const requirements = await scheme.enhancePaymentRequirements({ scheme: 'batch-settlement', network: config.network, asset: config.asset, payTo: config.payTo, amount: '1000', maxTimeoutSeconds: 120, extra: { minDeposit: '10000', voucherSigner: 'client' } }, kind, []);
        const resource = new x402ResourceServer(facilitator).register(config.network, scheme);
        const worker = scheme.createChannelManager(facilitator, requirements, { rpcUrl: process.env.SOLANA_RPC_URL, onError: () => console.warn('[model-channels] redemption needs retry') });
        return { resource, worker };
    }
    const batch = () => batchPromise ?? (batchPromise = setup().catch(error => { batchPromise = null; throw error; }));
    const quote = (job: ModelPurchase): MandateQuote => ({ id: job.id, modelId: job.terms.modelId, kind: job.terms.kind, amount: job.terms.amount, expiresAt: job.terms.expiresAt });
    const accept = async (owner: string, reservation: MandateReservation, channelId: string) => await db.transaction(async () => {
        await purchases.acceptedBatch(owner, reservation.quote.id, `${channelId}:${reservation.cumulativeAmount}`, channelId);
        await mandates.recordChannel(owner, reservation.mandateId, channelId);
        const current = await mandates.get(owner, reservation.mandateId);
        if (current.state === 'funding' && current.policy.expiresAt > Date.now())
            await mandates.activate(owner, current.id, channelId);
        await mandates.complete(owner, reservation.id);
    });
    app.onError((_error, c) => c.json({ error: 'Mandate operation could not be completed. Refresh its status before retrying.' }, 409));
    app.get('/v2/models/mandates', async (c) => {
        const owner = c.get('owner');
        return c.json({ mandates: await Promise.all((await mandates.list(owner)).map(async (m) => {
                const channel = m.channelId ? await channels.get(m.channelId) : undefined;
                return { ...m, channel: channel ? { channelId: channel.channelId, status: channel.status, deposit: String(channel.deposit), chargedAmount: String(channel.chargedCumulativeAmount), settledAmount: String(channel.settled), distributedAmount: String(channel.payoutWatermark) } : null };
            })) }, 200, { 'Cache-Control': 'no-store' });
    });
    app.post('/v2/models/mandates', async (c) => {
        if (!options.ready)
            return c.json({ error: 'Durable model payments are not enabled' }, 503);
        const body = await c.req.json().catch(() => null);
        if (body?.consent !== true || !body?.policy || typeof body.policy !== 'object')
            return c.json({ error: 'Approve the model limits and prompt-sharing policy first' }, 400);
        const raw = body.policy;
        const policy: MandatePolicy = { payer: raw.payer, authorizer: raw.authorizer, models: raw.models, totalAmount: raw.totalAmount, perCallAmount: raw.perCallAmount, maxCalls: raw.maxCalls, expiresAt: raw.expiresAt };
        if (!Array.isArray(policy.models) || policy.models.length > 50)
            return c.json({ error: 'Invalid model allowlist' }, 400);
        for (const model of policy.models)
            await options.catalog.model(model?.id, model?.kind);
        return c.json(await mandates.create(c.get('owner'), policy), 201);
    });
    app.post('/v2/models/mandates/:id/stop', async (c) => { await mandates.stop(c.get('owner'), c.req.param('id')); return c.json(await mandates.get(c.get('owner'), c.req.param('id'))); });
    app.post('/v2/models/purchases/:id/request', async (c) => {
        if (!options.ready)
            return c.json({ error: 'Durable model payments are not enabled' }, 503);
        const owner = c.get('owner'), body = await c.req.json().catch(() => null), job = await purchases.get(owner, c.req.param('id'));
        if (job.state !== 'quoted')
            return c.json(job);
        const reservation = await mandates.reserve(owner, body?.mandateId, quote(job));
        return c.json({ purchase: job, reservation }, 202);
    });
    app.get('/v2/models/mandates/pending', async (c) => {
        const owner = c.get('owner');
        const requests = [];
        for (const reservation of await mandates.pending(owner)) {
            const mandate = await mandates.get(owner, reservation.mandateId), job = await purchases.get(owner, reservation.quote.id);
            const channel = mandate.channelId ? await channels.get(mandate.channelId) : undefined;
            // The SDK's durable watermark can recover a lost HTTP acknowledgement, never a guessed payment.
            if (reservation.state === 'signed' && channel && channel.payer === mandate.policy.payer && channel.payerAuthorizer === mandate.policy.authorizer && channel.mint === options.config?.asset && channel.receiver === options.config?.payTo &&
                channel.chargedCumulativeAmount >= BigInt(reservation.cumulativeAmount) && ['payment_pending', 'prepared','settlement_uncertain', 'paid', 'running', 'completed', 'refund_due', 'provider_uncertain'].includes(job.state)) {
                await accept(owner, reservation, channel.channelId);
                if (options.ready)
                    await options.execute(owner, job.id);
            }
            else if(reservation.state==='signed'&&channel&&await purchases.canCancelInterrupted(owner,job.id)&&
                channel.payer===mandate.policy.payer&&channel.payerAuthorizer===mandate.policy.authorizer&&channel.mint===options.config?.asset&&channel.receiver===options.config?.payTo&&
                channel.chargedCumulativeAmount<BigInt(reservation.cumulativeAmount)&&!Object.values(channel.reservations??{}).some(value=>value.expiresAt>Date.now())){
                // Retire the operation before pruning SDK reservations: a late handler can no longer prepare a charge.
                if(await purchases.uncharged(owner,job.id)){
                    const deposit=!channel.openSignature&&mandate.spentAmount==='0';
                    await channels.update(channel.channelId,current=>{
                        if(!current||current.chargedCumulativeAmount>=BigInt(reservation.cumulativeAmount)||Object.values(current.reservations??{}).some(value=>value.expiresAt>Date.now()))throw new Error('Channel still has an active operation');
                        return {...current,reservations:{},...deposit?{status:'distributed' as const,deposit:0n}:{}};
                    });
                    await mandates.cancelUncharged(owner,reservation.id,deposit);
                }
            }
            else if (reservation.state === 'reserved') {
                if (job.state!=='quoted'||mandate.state !== 'active' || mandate.policy.expiresAt <= Date.now() || job.terms.expiresAt <= Date.now())
                    await mandates.release(owner, reservation.id);
                else
                    requests.push({ reservation, mandate, purchase: job });
            }
        }
        return c.json({ requests });
    });
    app.post('/v2/models/purchases/:id/channel/:mandate', async (c) => {
        if (!options.ready || !options.config)
            return c.json({ error: 'Durable model payments are not enabled' }, 503);
        const owner = c.get('owner'), job = await purchases.get(owner, c.req.param('id')), mandate = await mandates.get(owner, c.req.param('mandate'));
        if (job.state !== 'quoted')
            return c.json(job, job.state === 'completed' ? 200 : 202);
        if (job.terms.expiresAt <= Date.now())
            return c.json({ error: 'Quote expired; no new payment was requested' }, 409);
        const header = c.req.header('payment-signature');
        let reservation;
        if (header) {
            const payment = decodePaymentSignatureHeader(header), raw = payment.payload;
            if (!isBatchPayload(raw) || !['deposit', 'voucher'].includes(raw.type) || !('voucher' in raw) || !raw.voucher ||
                raw.channelConfig.payer !== mandate.policy.payer || raw.channelConfig.payerAuthorizer !== mandate.policy.authorizer || raw.channelConfig.voucherSigner === 'server' ||
                raw.channelConfig.token !== options.config.asset || raw.channelConfig.receiver !== options.config.payTo || raw.channelConfig.withdrawDelay !== 3600 ||
                (raw.type === 'deposit' ? raw.deposit.amount !== mandate.policy.totalAmount : raw.voucher.channelId !== mandate.channelId))
                return c.json({ error: 'Payment is outside this mandate' }, 400);
            const signedVoucher=raw.voucher;
            reservation=await db.transaction(async()=>{
                const held = raw.type === 'deposit' ? await mandates.reserveFunding(owner, mandate.id, quote(job)) : await mandates.reserve(owner, mandate.id, quote(job));
                if (signedVoucher.maxClaimableAmount !== held.cumulativeAmount)throw new Error('Cumulative voucher does not match the reserved purchase');
                await mandates.markSigned(owner, held.id);
                await purchases.beginPayment(owner, job.id, createHash('sha256').update(signedVoucher.channelId + ':' + signedVoucher.signature).digest('hex'),true);
                await mandates.recordChannel(owner, mandate.id, signedVoucher.channelId);
                return held;
            });
        }
        const { resource } = await batch(), route = c.req.path;
        const paid = new Hono();
        paid.use(paymentMiddleware({ [`POST ${route}`]: { accepts: { scheme: 'batch-settlement', network: options.config.network, payTo: options.config.payTo,
                    price: { asset: options.config.asset, amount: job.terms.amount, extra: { minDeposit: mandate.policy.totalAmount, voucherSigner: 'client',paymentFlow:'authorization' } } }, description: 'HelixBox bounded model purchase', mimeType: 'application/json' } }, resource));
        paid.post(route,async ctx=>{
            const result=await options.prepare(owner,job.id);
            return ctx.json({prepared:result.state==='prepared'},result.state==='prepared'?200:503);
        });
        let response: Response;
        try {
            response = await paid.fetch(c.req.raw.clone());
        }
        catch {
            if (header)
                await purchases.paymentFailed(owner, job.id, true);
            return c.json({ error: 'Channel settlement needs reconciliation; refresh before retrying' }, 503);
        }
        if (!header)
            return response;
        if(response.status>=400&&reservation){
            const current=await purchases.get(owner,job.id),channelId=(await mandates.get(owner,mandate.id)).channelId;
            const channel=channelId?await channels.get(channelId):undefined;
            // Handler failure cancels SDK reservations before settlement; never guess after an uncertain settle.
            if(['provider_failed','provider_uncertain','payment_pending'].includes(current.state)&&channel&&
                channel.chargedCumulativeAmount<BigInt(reservation.cumulativeAmount)&&!Object.keys(channel.reservations??{}).length){
                await db.transaction(async()=>{await purchases.uncharged(owner,job.id);await mandates.cancelUncharged(owner,reservation.id,mandate.state==='pending');});
                return c.json(await purchases.get(owner,job.id),202);
            }
        }
        const receiptHeader = response.headers.get('payment-response');
        if (!response.ok || !receiptHeader) {
            await purchases.paymentFailed(owner, job.id, true);
            return c.json(await purchases.get(owner, job.id), 202);
        }
        const receipt = decodePaymentResponseHeader(receiptHeader), extra = receipt.extra as {
            commitmentId?: string;
            channelState?: {
                channelId?: string;
            };
        } | undefined;
        const channelId = extra?.channelState?.channelId, channel = channelId ? await channels.get(channelId) : undefined;
        if (!receipt.success || receipt.network !== options.config.network || !channel || channel.payer !== mandate.policy.payer || channel.payerAuthorizer !== mandate.policy.authorizer ||
            channel.chargedCumulativeAmount !== BigInt(reservation!.cumulativeAmount) || extra?.commitmentId !== `${channel.channelId}:${reservation!.cumulativeAmount}`) {
            await purchases.paymentFailed(owner, job.id, true);
            return c.json(await purchases.get(owner, job.id), 202);
        }
        await accept(owner, reservation!, channel.channelId);
        c.header('payment-response', receiptHeader);
        return c.json(await options.execute(owner, job.id));
    });
    app.post('/v2/models/mandates/:id/close', async (c) => {
        if (!options.channelReady || !options.config)
            return c.json({ error: 'Channel service is not configured' }, 503);
        const owner = c.get('owner'), mandate = await mandates.get(owner, c.req.param('id'));
        await mandates.stop(owner, mandate.id);
        const header = c.req.header('payment-signature');
        if (header) {
            const raw = decodePaymentSignatureHeader(header).payload;
            if (!isBatchPayload(raw) || raw.type !== 'refund' || !raw.voucher || raw.voucher.channelId !== mandate.channelId || raw.channelConfig.payer !== mandate.policy.payer ||
                raw.channelConfig.payerAuthorizer !== mandate.policy.authorizer || raw.channelConfig.voucherSigner === 'server')
                return c.json({ error: 'Invalid channel close' }, 400);
        }
        const { resource } = await batch(), route = c.req.path, paid = new Hono();
        paid.use(paymentMiddleware({ [`POST ${route}`]: { accepts: { scheme: 'batch-settlement', network: options.config.network, payTo: options.config.payTo,
                    price: { asset: options.config.asset, amount: '1000', extra: { voucherSigner: 'client' } } }, description: 'Close HelixBox channel and return unspent escrow', mimeType: 'application/json' } }, resource));
        paid.post(route, ctx => ctx.json({ stopped: true }));
        const response = await paid.fetch(c.req.raw.clone());
        if (!header)
            return response;
        const receipt = response.headers.get('payment-response');
        if (!response.ok || !receipt)
            return response;
        return c.json({ mandate: await mandates.get(owner, mandate.id), settlement: decodePaymentResponseHeader(receipt) });
    });
    return Object.assign(app, { maintainChannels: async () => {
            if (!options.channelReady)
                return;
            if (batchPromise || (await channels.list()).some(channel => channel.status !== 'distributed'))
                try {
                    await (await batch()).worker.redeem();
                }
                catch {
                    console.warn('[model-channels] redemption needs retry');
                }
        } });
}
