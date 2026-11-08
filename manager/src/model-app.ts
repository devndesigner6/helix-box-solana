import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createHash } from 'node:crypto';
import type { ModelDatabaseInput } from './model-database.ts';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import { paymentMiddleware } from '@x402/hono';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { createModelCatalog, type ModelKind } from './model-catalog.ts';
import { quoteModelCall, type ModelCallInput } from './model-quotes.ts';
import { assertShareablePrompt, runModelCall } from './model-provider.ts';
import { createModelStore } from './model-store.ts';
import type { X402Config } from './x402-payment.ts';
import { createModelMandateApp } from './model-mandate-app.ts';
interface Options {
    db: ModelDatabaseInput;
    apiKey: string;
    dataKey: string;
    config: X402Config | null;
    enabled: boolean;
    durable: boolean;
    authenticate: (request: Request) => string | null | Promise<string | null>;
    fetcher?: typeof fetch;
}
export function createModelApp(options: Options) {
    const { apiKey, config } = options;
    const catalog = createModelCatalog({ apiKey, fetcher: options.fetcher });
    const store = createModelStore(options.db, options.dataKey || apiKey);
    const ready = Boolean(apiKey && options.dataKey && config && options.enabled && options.durable);
    const resource = config ? new x402ResourceServer(new HTTPFacilitatorClient({ url: config.facilitatorUrl })).register(config.network, new ExactSvmScheme()) : null;
    const app = new Hono<{
        Variables: {
            owner: string;
        };
    }>();
    let active = 0;
    app.use('*', bodyLimit({ maxSize: 32000, onError: c => c.json({ error: 'Request exceeds 32 KB' }, 413) }));
    app.use('*', async (c, next) => {
        c.header('Cache-Control', 'no-store');
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Access-Control-Expose-Headers', 'payment-required, payment-response');
        if (c.req.method === 'GET' && c.req.path === '/v2/models')
            return next();
        const owner = await options.authenticate(c.req.raw);
        if (!owner)
            return c.json({ error: 'Pair a workspace before using model tools' }, 401);
        c.set('owner', owner);
        await next();
    });
    app.onError((error, c) => {
        const message = error.message;
        const safe = /^(?:Model|Live model|No available provider|A prompt|Prompt|Output token|Purchase|Quote|The prompt|Original input|Invalid model)/.test(message);
        return c.json({ error: safe ? message : 'Model operation could not be completed' }, safe ? 400 : 500);
    });
    app.get('/v2/models', async (c) => {
        await store.cleanup();
        try {
            return c.json({ ...await catalog.list(), paymentsEnabled: ready, paymentMode: 'phone-mandate-channel',
                paymentConfiguration:{durableStorage:options.durable,dataKey:Boolean(options.dataKey),providerKey:Boolean(apiKey),enabled:options.enabled},
                generationStatus: !apiKey ? 'Backend model API key is not configured' : !ready ? 'Paid model tools await backend payment and durable-storage configuration' : 'Ready for wallet-approved calls',
                pricingPolicy: { markupBps: 2000, minimumAmount: '1000', maximumAmount: '1000000', asset: config?.asset ?? null } });
        }
        catch {
            return c.json({ error: 'Live model catalog is temporarily unavailable' }, 503);
        }
    });
    app.post('/v2/models/quotes', async (c) => {
        if (!ready)
            return c.json({ error: 'Model purchases are not enabled. Configure the backend API key, durable storage, data key and payment feature flag first.' }, 503);
        const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
        if (!body || body.consent !== true)
            return c.json({ error: 'Approve sharing this prompt with the selected model provider' }, 400);
        if (typeof body.modelId !== 'string' || !['chat', 'image', 'voice'].includes(String(body.kind)) || typeof body.prompt !== 'string')
            return c.json({ error: 'Invalid model request' }, 400);
        const input: ModelCallInput = { prompt: body.prompt };
        if (body.maxOutputTokens !== undefined) {
            if (typeof body.maxOutputTokens !== 'number')
                return c.json({ error: 'Invalid output limit' }, 400);
            input.maxOutputTokens = body.maxOutputTokens;
        }
        if (body.voice !== undefined) {
            if (typeof body.voice !== 'string')
                return c.json({ error: 'Invalid voice' }, 400);
            input.voice = body.voice;
        }
        assertShareablePrompt(input.prompt);
        const model = await catalog.model(body.modelId, body.kind as ModelKind);
        const endpoints = await catalog.endpoints(model.id, model.kind);
        const terms = quoteModelCall(model, endpoints.endpoints, input);
        return c.json(await store.create(c.get('owner'), terms, input), 201);
    });
    app.get('/v2/models/purchases', async (c) => c.json({ purchases: await store.list(c.get('owner')) }));
    app.get('/v2/models/purchases/:id', async (c) => {
        try {
            return c.json(await store.get(c.get('owner'), c.req.param('id')));
        }
        catch {
            return c.json({ error: 'Purchase not found' }, 404);
        }
    });
    app.post('/v2/models/purchases/:id/cancel',async c=>{
        try{return c.json(await store.cancelUnsubmitted(c.get('owner'),c.req.param('id')));}
        catch{return c.json({error:'This purchase may have entered payment processing. Refresh for reconciliation; do not pay again.'},409);}
    });
    async function execute(owner: string, id: string,authorized=false) {
        if (active >= 4)
            return await store.get(owner, id);
        active++;
        let dispatched = false, generated = false;
        try {
            if(!await(authorized?store.startPreparing(owner,id):store.start(owner,id)))return await store.get(owner,id);
            const job = await store.get(owner, id);
            const input = await store.input(owner, id);
            const model = await catalog.model(job.terms.modelId, job.terms.kind);
            const endpoints = await catalog.endpoints(model.id, model.kind, true);
            const current = quoteModelCall(model, endpoints.endpoints.filter((endpoint: any) => (endpoint.tag ?? endpoint.provider_tag) === job.terms.provider), input);
            if (BigInt(current.amount) > BigInt(job.terms.amount) || JSON.stringify(current.limits) !== JSON.stringify(job.terms.limits) ||
                Object.entries(current.maxPrice).some(([key, value]) => value > (job.terms.maxPrice?.[key] ?? -1)))
                throw new Error('Model pricing or capabilities changed before dispatch');
            dispatched = true;
            const result = await runModelCall(job.terms, input, apiKey, options.fetcher);
            generated = true;
            if(authorized)await store.prepared(owner,id,result);else await store.complete(owner, id, result);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Model provider request failed';
            const uncertain = generated || (dispatched && /timeout|abort|fetch|network|socket/i.test(message));
            if(authorized)await store.failedPreparing(owner,id,uncertain);
            else await store.failed(owner, id, uncertain ? 'Provider execution needs reconciliation. Do not purchase again.' : 'The provider did not deliver a complete result. Your payment requires a refund.', uncertain);
        }
        finally {
            active--;
        }
        return await store.get(owner, id);
    }
    app.post('/v2/models/purchases/:id/resume', async (c) => {
        if (!ready)
            return c.json({ error: 'Model generation is not configured' }, 503);
        const job = await store.get(c.get('owner'), c.req.param('id'));
        if (job.state !== 'paid')
            return c.json(job);
        return c.json(await execute(c.get('owner'), job.id));
    });
    app.post('/v2/models/purchases/:id/pay', async (c) => {
        if (!ready || !resource || !config)
            return c.json({ error: 'Model purchases are not configured' }, 503);
        if (c.req.header('x-payment'))
            return c.json({ error: 'Use the x402 v2 payment-signature header' }, 400);
        const owner = c.get('owner');
        const job = await store.get(owner, c.req.param('id'));
        if (job.state !== 'quoted')
            return c.json(job, job.state === 'completed' ? 200 : 202);
        if (job.terms.expiresAt <= Date.now())
            return c.json({ error: 'Quote expired. Request a fresh quote before paying.' }, 409);
        if (active >= 4)
            return c.json({ error: 'Model workers are busy. No payment has been requested.' }, 429);
        const header = c.req.header('payment-signature');
        if (header) {
            if (header.length > 32000)
                return c.json({ error: 'Invalid payment payload' }, 400);
            try {
                const payment = decodePaymentSignatureHeader(header);
                const transaction = (payment.payload as {
                    transaction?: unknown;
                })?.transaction;
                if (typeof transaction !== 'string')
                    return c.json({ error: 'Invalid payment transaction' }, 400);
                // Persist authorization intent before a facilitator can settle money.
                await store.beginPayment(owner, job.id, createHash('sha256').update(Buffer.from(transaction, 'base64')).digest('hex'),true);
            }
            catch {
                return c.json({ error: 'Payment is invalid or already processing. Retrieve purchase status before retrying.' }, 409);
            }
        }
        const route = c.req.path;
        const paymentApp = new Hono();
        paymentApp.use(paymentMiddleware({ [`POST ${route}`]: {
                accepts: { scheme: 'exact', network: config.network, payTo: config.payTo, price: { asset: config.asset, amount: job.terms.amount, extra: { memo: job.id,paymentFlow:'authorization' } } },
                description: `HelixBox ${job.terms.kind} model call`, mimeType: 'application/json',
            } }, resource));
        // x402 authorization verifies first, then settles only a successfully prepared response.
        paymentApp.post(route,async ctx=>{
            const prepared=await execute(owner,job.id,true);
            return ctx.json({prepared:prepared.state==='prepared'},prepared.state==='prepared'?200:503);
        });
        let response: Response;
        try {
            response = await paymentApp.fetch(c.req.raw.clone());
        }
        catch {
            if (header)
                await store.paymentFailed(owner, job.id, true);
            return header ? c.json(await store.get(owner, job.id), 202) : c.json({ error: 'Payment facilitator is unavailable' }, 503);
        }
        if (!header)
            return response;
        if(response.status>=400){
            const current=await store.get(owner,job.id);
            if(['provider_failed','provider_uncertain','payment_pending'].includes(current.state)){
                await store.uncharged(owner,job.id);return c.json(await store.get(owner,job.id),202);
            }
        }
        const settlement = response.headers.get('payment-response');
        if (!response.ok || !settlement) {
            await store.paymentFailed(owner, job.id, true);
            return c.json(await store.get(owner, job.id), 202);
        }
        try {
            const receipt = decodePaymentResponseHeader(settlement);
            if (!receipt.success || receipt.network !== config.network || !receipt.transaction)
                throw new Error('Invalid settlement receipt');
            await store.settled(owner, job.id, `${receipt.network}:${receipt.transaction}`);
        }
        catch {
            await store.paymentFailed(owner, job.id, true);
            return c.json(await store.get(owner, job.id), 202);
        }
        const result = await execute(owner, job.id);
        c.header('payment-response', settlement);
        return c.json(result);
    });
    const mandateApp = createModelMandateApp({ db: options.db, secret: options.dataKey, config, ready, channelReady: Boolean(options.dataKey && config && options.durable), purchases: store, catalog, execute,prepare:(owner,id)=>execute(owner,id,true) });
    app.route('/', mandateApp);
    return Object.assign(app, { ready:store.ready,cleanupModelData: async () => { await store.cleanup(); await mandateApp.maintainChannels(); } });
}
