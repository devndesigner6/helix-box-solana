import { randomUUID } from 'node:crypto';
import { address } from '@solana/kit';
import { createModelDatabase, type ModelDatabaseInput } from './model-database.ts';
import type { ModelKind } from './model-catalog.ts';
export interface MandatePolicy {
    payer: string;
    authorizer: string;
    models: {
        id: string;
        kind: ModelKind;
    }[];
    totalAmount: string;
    perCallAmount: string;
    maxCalls: number;
    expiresAt: number;
}
export interface MandateQuote {
    id: string;
    modelId: string;
    kind: ModelKind;
    amount: string;
    expiresAt: number;
}
export interface ModelMandate {
    id: string;
    policy: MandatePolicy;
    channelId: string | null;
    state: 'pending' | 'funding' | 'active' | 'stopped';
    spentAmount: string;
    reservedAmount: string;
    usedCalls: number;
}
export interface MandateReservation {
    id: string;
    mandateId: string;
    quote: MandateQuote;
    cumulativeAmount: string;
    state: 'reserved' | 'signed' | 'completed' | 'released';
}
const amount = (value: unknown): bigint => {
    if (typeof value !== 'string' || !/^(?:[1-9]\d{0,8})$/.test(value))
        throw new Error('Invalid mandate amount');
    return BigInt(value);
};
export function createMandateStore(input: ModelDatabaseInput, now = Date.now) {
    const db = createModelDatabase(input), ready = db.initialize();
    const row = async (owner: string, id: string): Promise<any> => {
        const value = await db.query('SELECT * FROM model_mandates WHERE id=? AND owner=?').get(id, owner);
        if (!value)
            throw new Error('Mandate not found');
        return value;
    };
    const entries = async (id: string): Promise<MandateReservation[]> => (await db.query('SELECT * FROM model_mandate_reservations WHERE mandate_id=?').all(id) as any[])
        .map(r => ({ id: r.id, mandateId: r.mandate_id, quote: JSON.parse(r.quote), cumulativeAmount: r.cumulative, state: r.state }));
    const view = async (value: any): Promise<ModelMandate> => {
        const all = await entries(value.id);
        let spent = 0n, held = 0n, used = 0;
        for (const entry of all) {
            if (entry.state === 'released')
                continue;
            used++;
            if (entry.state === 'completed')
                spent += BigInt(entry.quote.amount);
            else
                held += BigInt(entry.quote.amount);
        }
        return { id: value.id, policy: JSON.parse(value.policy), channelId: value.channel_id, state: value.state, spentAmount: String(spent), reservedAmount: String(held), usedCalls: used };
    };
    const reservation = async (owner: string, id: string): Promise<MandateReservation> => {
        const value = await db.query('SELECT r.* FROM model_mandate_reservations r JOIN model_mandates m ON m.id=r.mandate_id WHERE r.id=? AND m.owner=?').get(id, owner) as any;
        if (!value)
            throw new Error('Mandate reservation not found');
        return { id: value.id, mandateId: value.mandate_id, quote: JSON.parse(value.quote), cumulativeAmount: value.cumulative, state: value.state };
    };
    return {
        async create(owner: string, policy: MandatePolicy): Promise<ModelMandate> {
            await ready;
            if (!owner || owner.length > 256)
                throw new Error('Invalid mandate owner');
            address(policy.payer);
            address(policy.authorizer);
            const total = amount(policy.totalAmount), perCall = amount(policy.perCallAmount);
            if (total < 10000n || total > 100000000n || perCall > total || !Number.isSafeInteger(policy.maxCalls) || policy.maxCalls < 1 || policy.maxCalls > 1000 ||
                !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= now() || policy.expiresAt > now() + 86400000 ||
                !Array.isArray(policy.models) || policy.models.length < 1 || policy.models.length > 50 ||
                policy.models.some(m => !m || typeof m.id !== 'string' || !m.id || m.id.length > 256 || !['chat', 'image', 'voice'].includes(m.kind)))
                throw new Error('Invalid mandate limits');
            const count = await db.query("SELECT count(*) AS n FROM model_mandates WHERE owner=? AND state!='stopped'").get(owner) as {
                n: number;
            };
            if (count.n >= 10)
                throw new Error('Too many open mandates; close an existing mandate first');
            const id = randomUUID();
            await db.query('INSERT INTO model_mandates VALUES (?,?,?,NULL,?,?)').run(id, owner, JSON.stringify(policy), 'pending', now());
            return await view(await row(owner, id));
        },
        async get(owner: string, id: string): Promise<ModelMandate> { await ready; return await view(await row(owner, id)); },
        async list(owner: string): Promise<ModelMandate[]> { await ready; return Promise.all((await db.query('SELECT * FROM model_mandates WHERE owner=? ORDER BY created_at DESC LIMIT 50').all(owner) as any[]).map(view)); },
        // Only the verified channel-deposit handler may call this, never a client-supplied activation flag.
        async activate(owner: string, id: string, channelId: string): Promise<void> {
            await ready;
            address(channelId);
            await db.transaction(async () => {
                const value = await row(owner, id), policy = JSON.parse(value.policy) as MandatePolicy;
                if (!['pending', 'funding'].includes(value.state) || policy.expiresAt <= now())
                    throw new Error('Mandate cannot be activated');
                await db.query("UPDATE model_mandates SET state='active',channel_id=? WHERE id=? AND owner=?").run(channelId, id, owner);
            });
        },
        async stop(owner: string, id: string): Promise<void> { await ready;await db.transaction(async()=>{ await row(owner, id); await db.query("UPDATE model_mandates SET state='stopped' WHERE id=? AND owner=?").run(id, owner); });},
        async recordChannel(owner: string, id: string, channelId: string): Promise<void> {
            await ready;
            address(channelId);
            await db.transaction(async()=>{
            const current = await row(owner, id);
            if (current.channel_id && current.channel_id !== channelId)
                throw new Error('Mandate channel cannot change');
            await db.query('UPDATE model_mandates SET channel_id=? WHERE id=? AND owner=?').run(channelId, id, owner);
            });
        },
        async reserveFunding(owner: string, id: string, quote: MandateQuote): Promise<MandateReservation> { await ready; return await this.reserve(owner, id, quote, true); },
        async reserve(owner: string, id: string, quote: MandateQuote, funding = false): Promise<MandateReservation> {
            await ready;
            return await db.transaction(async () => {
                const mandate = await view(await row(owner, id));
                const existing = await db.query('SELECT id,mandate_id FROM model_mandate_reservations WHERE quote_id=?').get(quote.id) as {
                    id: string;
                    mandate_id: string;
                } | null;
                if (existing) {
                    if (existing.mandate_id !== id)
                        throw new Error('Purchase already belongs to another mandate');
                    const previous = await reservation(owner, existing.id);
                    if (JSON.stringify(previous.quote) !== JSON.stringify(quote))
                        throw new Error('Purchase terms changed');
                    return previous;
                }
                const cost = amount(quote.amount), policy = mandate.policy;
                if (typeof quote.id !== 'string' || !quote.id || quote.id.length > 128 || !Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= now())
                    throw new Error('Invalid or expired quote');
                if (policy.expiresAt <= now() || (funding ? mandate.state !== 'pending' : mandate.state !== 'active' || !mandate.channelId))
                    throw new Error('Mandate is not active');
                if (!policy.models.some(m => m.id === quote.modelId && m.kind === quote.kind))
                    throw new Error('Model is outside this mandate');
                if (cost > BigInt(policy.perCallAmount) || cost + BigInt(mandate.spentAmount) + BigInt(mandate.reservedAmount) > BigInt(policy.totalAmount) || mandate.usedCalls >= policy.maxCalls)
                    throw new Error('Mandate spending limit exceeded');
                // Sequential vouchers avoid signing conflicting cumulative watermarks while a prior result is uncertain.
                if (mandate.reservedAmount !== '0')
                    throw new Error('Previous mandate purchase needs completion or reconciliation');
                const reservationId = randomUUID(), cumulative = String(BigInt(mandate.spentAmount) + cost);
                await db.query("INSERT INTO model_mandate_reservations VALUES (?,?,?,?,?,'reserved')").run(reservationId, id, quote.id, JSON.stringify(quote), cumulative);
                if (funding)
                    await db.query("UPDATE model_mandates SET state='funding' WHERE id=? AND owner=?").run(id, owner);
                return await reservation(owner, reservationId);
            });
        },
        async markSigned(owner: string, id: string): Promise<void> {
            await ready;
            await db.transaction(async()=>{
            const value = await reservation(owner, id), mandate = await view(await row(owner, value.mandateId));
            if (value.state !== 'reserved' || !['active', 'funding'].includes(mandate.state) || mandate.policy.expiresAt <= now() || value.quote.expiresAt <= now())
                throw new Error('Mandate authorization is no longer valid');
            await db.query("UPDATE model_mandate_reservations SET state='signed' WHERE id=? AND state='reserved'").run(id);
            });
        },
        async complete(owner: string, id: string): Promise<void> {
            await ready;
            await db.transaction(async()=>{
            const value = await reservation(owner, id);
            if (value.state === 'completed')
                return;
            if (value.state !== 'signed')
                throw new Error('Purchase has not been signed');
            await db.query("UPDATE model_mandate_reservations SET state='completed' WHERE id=? AND state='signed'").run(id);
            });
        },
        async release(owner: string, id: string): Promise<void> {
            await ready;
            await db.transaction(async()=>{
            const value = await reservation(owner, id);
            if (value.state !== 'reserved')
                throw new Error('Signed or completed purchase cannot be released without settlement reconciliation');
            await db.query("UPDATE model_mandate_reservations SET state='released' WHERE id=? AND state='reserved'").run(id);
            });
        },
        async cancelUncharged(owner:string,id:string,deposit:boolean):Promise<void>{
            await ready;
            await db.transaction(async()=>{
                const held=await reservation(owner,id);
                if(held.state==='released')return;
                if(held.state!=='signed')throw new Error('Only a verified cancelled charge can release a signed reservation');
                await db.run("UPDATE model_mandate_reservations SET state='released' WHERE id=? AND state='signed'",id);
                if(deposit)await db.run("UPDATE model_mandates SET channel_id=NULL,state=CASE WHEN state='funding' THEN 'pending' ELSE state END WHERE id=? AND owner=?",held.mandateId,owner);
            });
        },
        reservation,
        async pending(owner: string): Promise<MandateReservation[]> {
            await ready;
            return Promise.all((await db.query("SELECT r.id FROM model_mandate_reservations r JOIN model_mandates m ON m.id=r.mandate_id WHERE m.owner=? AND r.state IN ('reserved','signed') ORDER BY m.created_at,r.id LIMIT 20").all(owner) as {
                id: string;
            }[]).map(async (r) => await reservation(owner, r.id)));
        },
    };
}
