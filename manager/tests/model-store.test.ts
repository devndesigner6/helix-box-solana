import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createModelStore } from '../src/model-store.ts';
import { createMandateStore } from '../src/model-mandates.ts';
const terms = { modelId: 'lab/code', kind: 'chat', provider: 'lab', amount: '1000', expiresAt: Date.now() + 120000, limits: { maxOutputTokens: 20 }, markupBps: 2000, minimumAmount: '1000' } as any;
test('generated results remain encrypted and unavailable until payment is acknowledged',async()=>{
    const store=createModelStore(new Database(':memory:'),'key'),q=await store.create('owner',terms,{prompt:'hi'});
    await store.beginPayment('owner',q.id,'one-proof');
    expect(await store.startPreparing('owner',q.id)).toBe(true);expect(await store.startPreparing('owner',q.id)).toBe(false);
    await store.prepared('owner',q.id,{kind:'chat',text:'paid output',generationId:'g',providerCost:null});
    expect((await store.get('owner',q.id)).result).toBeNull();
    await store.acceptedBatch('owner',q.id,'channel:1000','channel');
    expect((await store.get('owner',q.id)).state).toBe('completed');expect((await store.get('owner',q.id)).result?.text).toBe('paid output');
});
test('only a purchase with no accepted payment intent can be cancelled after a lost upload',async()=>{
    const store=createModelStore(new Database(':memory:'),'key');
    const unsent=await store.create('owner',terms,{prompt:'not sent'});
    expect((await store.cancelUnsubmitted('owner',unsent.id)).state).toBe('cancelled');
    await expect(store.beginPayment('owner',unsent.id,'late-upload')).rejects.toThrow();
    const seen=await store.create('owner',terms,{prompt:'possibly paid'});
    await store.beginPayment('owner',seen.id,'received-proof');
    await expect(store.cancelUnsubmitted('owner',seen.id)).rejects.toThrow('reconciliation');
    expect((await store.get('owner',seen.id)).state).toBe('payment_pending');
});
test('encrypts inputs and results, enforces ownership and never executes a purchase twice', async () => {
    const db = new Database(':memory:');
    const store = createModelStore(db, 'test-encryption-material');
    const quote = await store.create('owner', terms, { prompt: 'private project snippet' });
    await expect((async () => await store.get('other', quote.id))()).rejects.toThrow();
    expect(JSON.stringify(db.query('SELECT * FROM model_purchases').get())).not.toContain('private project snippet');
    await store.beginPayment('owner', quote.id, 'fingerprint');
    await store.settled('owner', quote.id, 'tx-1');
    expect(await store.start('owner', quote.id)).toBe(true);
    expect(await store.start('owner', quote.id)).toBe(false);
    await store.complete('owner', quote.id, { kind: 'chat', text: 'private answer', generationId: 'g1', providerCost: null });
    expect((await store.get('owner', quote.id)).result?.text).toBe('private answer');
    expect(JSON.stringify(db.query('SELECT * FROM model_purchases').get())).not.toContain('private answer');
    const restored = createModelStore(db, 'test-encryption-material');
    expect((await restored.get('owner', quote.id)).result?.text).toBe('private answer');
});
test('refuses payment reuse and holds interrupted settlement instead of charging again', async () => {
    const db = new Database(':memory:');
    const store = createModelStore(db, 'key');
    const first = await store.create('owner', terms, { prompt: 'first' });
    const second = await store.create('owner', terms, { prompt: 'second' });
    await store.beginPayment('owner', first.id, 'proof-1');
    await store.settled('owner', first.id, 'tx-1');
    await store.beginPayment('owner', second.id, 'proof-2');
    await expect((async () => await store.settled('owner', second.id, 'tx-1'))()).rejects.toThrow();
    const restored = createModelStore(db, 'key');
    expect((await restored.get('owner', second.id)).state).toBe('settlement_uncertain');
    await expect((async () => await restored.beginPayment('owner', second.id, 'proof-3'))()).rejects.toThrow();
});
test('private reads and execution enforce retention without catalog traffic', async () => {
    const db = new Database(':memory:');
    const store = createModelStore(db, 'key');
    const completed = await store.create('owner', terms, { prompt: 'private input' });
    await store.beginPayment('owner', completed.id, 'fp-1');
    await store.settled('owner', completed.id, 'tx-1');
    await store.start('owner', completed.id);
    await store.complete('owner', completed.id, { kind: 'chat', text: 'expired secret', generationId: null, providerCost: null });
    const paid = await store.create('owner', terms, { prompt: 'do not dispatch' });
    await store.beginPayment('owner', paid.id, 'fp-2');
    await store.settled('owner', paid.id, 'tx-2');
    db.query('UPDATE model_purchases SET created_at=?').run(Date.now() - 86400001);
    expect((await store.get('owner', completed.id)).result).toBeNull();
    await expect((async () => await store.input('owner', paid.id))()).rejects.toThrow();
    expect(await store.start('owner', paid.id)).toBe(false);
    expect((await store.get('owner', paid.id)).state).toBe('refund_due');
});
test('history query never loads encrypted artifact or prompt blobs', async () => {
    const db = new Database(':memory:');
    const queries: string[] = [];
    const query = db.query.bind(db);
    const tracked = new Proxy(db, { get(target, key) {
            if (key === 'query')
                return (sql: string) => { queries.push(sql); return query(sql); };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
    const store = createModelStore(tracked, 'key');
    await store.create('owner', terms, { prompt: 'hi' });
    queries.length = 0;
    expect(await store.list('owner')).toHaveLength(1);
    const select = queries.find(sql => sql.includes('ORDER BY'))!;
    expect(select).not.toContain('*');
    expect(select).not.toMatch(/\b(?:input|result)\b/);
});
test('channel commitments are receipts, not fabricated on-chain transaction signatures', async () => {
    const db = new Database(':memory:');
    const store = createModelStore(db, 'key');
    const q = await store.create('owner', terms, { prompt: 'hello' });
    await store.beginPayment('owner', q.id, 'voucher-fingerprint');
    await store.acceptedBatch('owner', q.id, 'channel:1000', 'channel');
    const paid = await store.get('owner', q.id);
    expect(paid.state).toBe('paid');
    expect(paid.transaction).toBeNull();
    expect(paid.commitmentId).toBe('channel:1000');
    expect(paid.channelId).toBe('channel');
});
test('retention never deletes the quote needed to release a held mandate reservation', async () => {
    const db = new Database(':memory:'), store = createModelStore(db, 'key'), mandates = createMandateStore(db);
    const q = await store.create('owner', terms, { prompt: 'hello' });
    const m = await mandates.create('owner', { payer: '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy', authorizer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', models: [{ id: 'lab/code', kind: 'chat' }], totalAmount: '10000', perCallAmount: '1000', maxCalls: 2, expiresAt: Date.now() + 60000 });
    await mandates.reserveFunding('owner', m.id, { id: q.id, modelId: 'lab/code', kind: 'chat', amount: '1000', expiresAt: terms.expiresAt });
    db.query('UPDATE model_purchases SET created_at=? WHERE id=?').run(Date.now() - 86400001, q.id);
    await store.cleanup();
    expect((await store.get('owner', q.id)).id).toBe(q.id);
});
