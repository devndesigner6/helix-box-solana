import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { ModelCallInput, ModelQuoteTerms } from './model-quotes.ts';
import type { ModelResult } from './model-provider.ts';

export interface ModelPurchase {
  id: string; state: string; terms: ModelQuoteTerms; createdAt: number; transaction: string | null;
  error: string | null; result: ModelResult | null;
}
export function createModelStore(db: Database, secret: string) {
  // Authorization intent must reach durable storage before money can settle.
  db.run('PRAGMA synchronous = FULL');
  const key = createHash('sha256').update('helixbox-model-results-v1\0').update(secret).digest();
  const encrypt = (value: unknown): string => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',key,iv);
    return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
  };
  const decrypt = <T>(value: string): T => {
    const bytes = Buffer.from(value,'base64'); const cipher = createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString('utf8'));
  };
  db.run(`CREATE TABLE IF NOT EXISTS model_purchases (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, terms TEXT NOT NULL, input TEXT,
    state TEXT NOT NULL, created_at INTEGER NOT NULL, fingerprint TEXT UNIQUE,
    payment_id TEXT UNIQUE, result TEXT, error TEXT
  )`);
  db.run('CREATE INDEX IF NOT EXISTS model_purchase_owner ON model_purchases(owner, created_at)');
  // Do not re-submit a possibly paid or executed operation after a process crash.
  db.run("UPDATE model_purchases SET state='settlement_uncertain' WHERE state='payment_pending'");
  db.run("UPDATE model_purchases SET state='provider_uncertain' WHERE state='running'");
  const expireContent = () => {
    db.query("UPDATE model_purchases SET input=NULL,result=NULL,error='Result retention expired',state=CASE WHEN state IN ('paid','running') THEN 'refund_due' ELSE state END WHERE created_at<? AND (input IS NOT NULL OR result IS NOT NULL)").run(Date.now()-86400000);
  };
  const row = (owner: string, id: string): any => {
    expireContent();
    const value = db.query('SELECT * FROM model_purchases WHERE id=? AND owner=?').get(id,owner);
    if (!value) throw new Error('Purchase not found');
    return value;
  };
  const view = (value: any): ModelPurchase => ({id:value.id,state:value.state,terms:JSON.parse(value.terms),createdAt:value.created_at,
    transaction:value.payment_id,error:value.error,result:value.result ? decrypt<ModelResult>(value.result) : null});
  return {
    create(owner: string, terms: ModelQuoteTerms, input: ModelCallInput): ModelPurchase {
      const count = db.query('SELECT count(*) as count FROM model_purchases WHERE owner=? AND created_at>?').get(owner,Date.now()-60000) as {count:number};
      if (count.count >= 10) throw new Error('Quote rate limit reached; wait one minute');
      const id = randomUUID();
      db.query('INSERT INTO model_purchases (id,owner,terms,input,state,created_at) VALUES (?,?,?,?,?,?)').run(id,owner,JSON.stringify(terms),encrypt(input),'quoted',Date.now());
      return view(row(owner,id));
    },
    get(owner: string, id: string): ModelPurchase { return view(row(owner,id)); },
    list(owner: string): ModelPurchase[] {
      expireContent();
      return (db.query('SELECT id,state,terms,created_at,payment_id,error FROM model_purchases WHERE owner=? ORDER BY created_at DESC LIMIT 20').all(owner) as any[]).map(value => view(value));
    },
    input(owner: string, id: string): ModelCallInput {
      const value = row(owner,id); if (!value.input) throw new Error('Original input is no longer available');
      return decrypt<ModelCallInput>(value.input);
    },
    beginPayment(owner: string, id: string, fingerprint: string): void {
      db.transaction(() => {
        const value = row(owner,id);
        if (value.state !== 'quoted' || JSON.parse(value.terms).expiresAt <= Date.now()) throw new Error('Purchase is expired or already processing; retrieve its status before paying again');
        db.query("UPDATE model_purchases SET fingerprint=?,state='payment_pending' WHERE id=? AND owner=?").run(fingerprint,id,owner);
      })();
    },
    paymentFailed(owner: string, id: string, uncertain: boolean): void {
      db.query("UPDATE model_purchases SET state=?,error=? WHERE id=? AND owner=? AND state='payment_pending'").run(
        uncertain ? 'settlement_uncertain' : 'quoted', uncertain ? 'Settlement needs reconciliation. Do not pay again.' : null,id,owner);
    },
    settled(owner: string, id: string, transaction: string): void {
      if (!transaction) throw new Error('Missing payment transaction');
      db.transaction(() => {
        if (row(owner,id).state !== 'payment_pending') throw new Error('Payment is not pending');
        db.query("UPDATE model_purchases SET payment_id=?,state='paid' WHERE id=? AND owner=?").run(transaction,id,owner);
      })();
    },
    start(owner: string, id: string): boolean {
      expireContent();
      return db.query("UPDATE model_purchases SET state='running' WHERE id=? AND owner=? AND state='paid'").run(id,owner).changes === 1;
    },
    complete(owner: string, id: string, result: ModelResult): void {
      if (row(owner,id).created_at < Date.now()-86400000) return;
      db.query("UPDATE model_purchases SET state='completed',result=?,input=NULL,error=NULL WHERE id=? AND owner=? AND state='running'").run(encrypt(result),id,owner);
    },
    failed(owner: string, id: string, error: string, uncertain: boolean): void {
      db.query("UPDATE model_purchases SET state=?,error=? WHERE id=? AND owner=? AND state='running'").run(
        uncertain ? 'provider_uncertain' : 'refund_due',error.slice(0,240),id,owner);
    },
    cleanup(): void {
      expireContent();
      db.query("DELETE FROM model_purchases WHERE created_at<? AND state='quoted'").run(Date.now()-86400000);
    },
  };
}
