import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createModelDatabase, type ModelDatabaseInput } from './model-database.ts';
import type { ModelCallInput, ModelQuoteTerms } from './model-quotes.ts';
import type { ModelResult } from './model-provider.ts';
export interface ModelPurchase {
    id: string;
    state: string;
    terms: ModelQuoteTerms;
    createdAt: number;
    transaction: string | null;
    commitmentId: string | null;
    channelId: string | null;
    error: string | null;
    result: ModelResult | null;
}
export function createModelStore(input: ModelDatabaseInput, secret: string) {
    const db = createModelDatabase(input);
    const ready = db.initialize().then(async () => {
        await db.run("UPDATE model_purchases SET state='settlement_uncertain' WHERE state='payment_pending'");
        await db.run("UPDATE model_purchases SET state='provider_uncertain' WHERE state='running'");
        await db.run("UPDATE model_purchases SET state='provider_uncertain' WHERE state='preparing'");
        await db.run("UPDATE model_purchases SET state='settlement_uncertain' WHERE state='prepared'");
    });
    const key = createHash('sha256').update('helixbox-model-results-v1\0').update(secret).digest();
    const encrypt = (value: unknown): string => {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64');
    };
    const decrypt = <T>(value: string): T => {
        const bytes = Buffer.from(value, 'base64');
        const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        cipher.setAuthTag(bytes.subarray(-16));
        return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8'));
    };
    const expireContent = async () => {
        await db.query("UPDATE model_purchases SET input=NULL,result=NULL,error='Result retention expired',state=CASE WHEN state IN ('paid','running') THEN 'refund_due' ELSE state END WHERE created_at<? AND (input IS NOT NULL OR result IS NOT NULL)").run(Date.now() - 86400000);
    };
    const row = async (owner: string, id: string): Promise<any> => {
        await expireContent();
        const value = await db.query('SELECT * FROM model_purchases WHERE id=? AND owner=?').get(id, owner);
        if (!value)
            throw new Error('Purchase not found');
        return value;
    };
    const view = (value: any): ModelPurchase => ({ id: value.id, state: value.state, terms: JSON.parse(value.terms), createdAt: Number(value.created_at),
        transaction: value.channel_id ? null : value.payment_id, commitmentId: value.channel_id ? value.payment_id : null, channelId: value.channel_id ?? null,
        error: value.error, result: value.result&&value.state==='completed' ? decrypt<ModelResult>(value.result) : null });
    return {
        ready,
        async verifyKey():Promise<void>{
            await ready;
            const stored=await db.get('SELECT input,result FROM model_purchases WHERE input IS NOT NULL OR result IS NOT NULL LIMIT 1');
            if(stored)try{decrypt(stored.input??stored.result);}catch{throw new Error('MODEL_DATA_KEY cannot decrypt retained data. Restore the original key.');}
        },
        async create(owner: string, terms: ModelQuoteTerms, input: ModelCallInput): Promise<ModelPurchase> {
            await ready;
            const count = await db.query('SELECT count(*) as count FROM model_purchases WHERE owner=? AND created_at>?').get(owner, Date.now() - 60000) as {
                count: number;
            };
            if (count.count >= 10)
                throw new Error('Quote rate limit reached; wait one minute');
            const id = randomUUID();
            await db.query('INSERT INTO model_purchases (id,owner,terms,input,state,created_at) VALUES (?,?,?,?,?,?)').run(id, owner, JSON.stringify(terms), encrypt(input), 'quoted', Date.now());
            return await view(await row(owner, id));
        },
        async get(owner: string, id: string): Promise<ModelPurchase> { await ready; return await view(await row(owner, id)); },
        async list(owner: string): Promise<ModelPurchase[]> {
            await ready;
            await expireContent();
            return (await db.query('SELECT id,state,terms,created_at,payment_id,channel_id,error FROM model_purchases WHERE owner=? ORDER BY created_at DESC LIMIT 20').all(owner) as any[]).map(view);
        },
        async input(owner: string, id: string): Promise<ModelCallInput> {
            await ready;
            const value = await row(owner, id);
            if (!value.input)
                throw new Error('Original input is no longer available');
            return decrypt<ModelCallInput>(value.input);
        },
        async beginPayment(owner: string, id: string, fingerprint: string,fulfillFirst=false): Promise<void> {
            await ready;
            await db.transaction(async () => {
                const value = await row(owner, id);
                if (value.state !== 'quoted' || JSON.parse(value.terms).expiresAt <= Date.now())
                    throw new Error('Purchase is expired or already processing; retrieve its status before paying again');
                await db.query("UPDATE model_purchases SET fingerprint=?,state='payment_pending',fulfill_first=? WHERE id=? AND owner=?").run(fingerprint,fulfillFirst?1:0, id, owner);
            });
        },
        async cancelUnsubmitted(owner:string,id:string):Promise<ModelPurchase>{
            await ready;
            return db.transaction(async()=>{
                const current=await row(owner,id);
                if(current.state==='cancelled')return view(current);
                if(current.state!=='quoted')throw new Error('Purchase needs settlement reconciliation; it cannot be cancelled');
                await db.run("UPDATE model_purchases SET state='cancelled',input=NULL,error='Cancelled before payment processing' WHERE id=? AND owner=? AND state='quoted'",id,owner);
                return view(await row(owner,id));
            });
        },
        async paymentFailed(owner: string, id: string, uncertain: boolean): Promise<void> {
            await ready;
            await db.query("UPDATE model_purchases SET state=?,error=? WHERE id=? AND owner=? AND state IN ('payment_pending','prepared')").run(uncertain ? 'settlement_uncertain' : 'quoted', uncertain ? 'Settlement needs reconciliation. Do not pay again.' : null, id, owner);
        },
        async settled(owner: string, id: string, transaction: string): Promise<void> {
            await ready;
            if (!transaction)
                throw new Error('Missing payment transaction');
            await db.transaction(async () => {
                const current=await row(owner,id);
                if (!['payment_pending','prepared','settlement_uncertain'].includes(current.state))
                    throw new Error('Payment is not pending');
                await db.query("UPDATE model_purchases SET payment_id=?,state=CASE WHEN result IS NOT NULL THEN 'completed' ELSE 'paid' END WHERE id=? AND owner=?").run(transaction, id, owner);
            });
        },
        async acceptedBatch(owner: string, id: string, commitmentId: string, channelId: string): Promise<void> {
            await ready;
            if (!commitmentId || !channelId)
                throw new Error('Missing channel commitment');
            await db.transaction(async () => {
                const current = await row(owner, id);
                if (current.payment_id === commitmentId && current.channel_id === channelId)
                    return;
                if (!['payment_pending', 'prepared','settlement_uncertain'].includes(current.state))
                    throw new Error('Payment is not pending');
                await db.query("UPDATE model_purchases SET payment_id=?,channel_id=?,state=CASE WHEN result IS NOT NULL THEN 'completed' ELSE 'paid' END,error=NULL WHERE id=? AND owner=?").run(commitmentId, channelId, id, owner);
            });
        },
        async startPreparing(owner:string,id:string):Promise<boolean>{
            await ready;
            return (await db.run("UPDATE model_purchases SET state='preparing' WHERE id=? AND owner=? AND state='payment_pending'",id,owner)).changes===1;
        },
        async prepared(owner:string,id:string,result:ModelResult):Promise<void>{
            await ready;
            if((await db.run("UPDATE model_purchases SET state='prepared',result=?,input=NULL,error=NULL WHERE id=? AND owner=? AND state='preparing'",encrypt(result),id,owner)).changes!==1)throw new Error('Generated result could not be saved');
        },
        async failedPreparing(owner:string,id:string,uncertain:boolean):Promise<void>{
            await ready;
            await db.run("UPDATE model_purchases SET state=?,error=? WHERE id=? AND owner=? AND state='preparing'",
                uncertain?'provider_uncertain':'provider_failed',uncertain?'Provider execution is uncertain; no payment was settled for this attempt.':'The provider did not deliver a complete result. No payment was settled.',id,owner);
        },
        async canCancelInterrupted(owner:string,id:string):Promise<boolean>{
            await ready;const current=await row(owner,id);
            return current.fulfill_first===1&&!current.result&&!current.payment_id&&JSON.parse(current.terms).expiresAt<=Date.now()&&
                ['payment_pending','settlement_uncertain','provider_uncertain','provider_failed','unfulfilled'].includes(current.state);
        },
        async uncharged(owner:string,id:string):Promise<boolean>{
            await ready;
            return(await db.run("UPDATE model_purchases SET state='unfulfilled',fingerprint=NULL,error=COALESCE(error,'The operation was cancelled before settlement. No payment was settled.') WHERE id=? AND owner=? AND state IN ('payment_pending','settlement_uncertain','unfulfilled','provider_failed','provider_uncertain') AND payment_id IS NULL AND result IS NULL",id,owner)).changes===1;
        },
        async start(owner: string, id: string): Promise<boolean> {
            await ready;
            await expireContent();
            return (await db.query("UPDATE model_purchases SET state='running' WHERE id=? AND owner=? AND state='paid'").run(id, owner)).changes === 1;
        },
        async complete(owner: string, id: string, result: ModelResult): Promise<void> {
            await ready;
            if ((await row(owner, id)).created_at < Date.now() - 86400000)
                return;
            await db.query("UPDATE model_purchases SET state='completed',result=?,input=NULL,error=NULL WHERE id=? AND owner=? AND state='running'").run(encrypt(result), id, owner);
        },
        async failed(owner: string, id: string, error: string, uncertain: boolean): Promise<void> {
            await ready;
            await db.query("UPDATE model_purchases SET state=?,error=? WHERE id=? AND owner=? AND state='running'").run(uncertain ? 'provider_uncertain' : 'refund_due', error.slice(0, 240), id, owner);
        },
        async cleanup(): Promise<void> {
            await ready;
            await expireContent();
            await db.query("DELETE FROM model_purchases WHERE created_at<? AND state='quoted' AND id NOT IN (SELECT quote_id FROM model_mandate_reservations WHERE state IN ('reserved','signed'))").run(Date.now() - 86400000);
        },
    };
}
