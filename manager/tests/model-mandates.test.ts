import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createMandateStore } from '../src/model-mandates.ts';
const payer = '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const policy = () => ({ payer, authorizer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', models: [{ id: 'lab/code', kind: 'chat' as const }], totalAmount: '10000', perCallAmount: '6000', maxCalls: 2, expiresAt: Date.now() + 60000 });
const quote = (id: string, amount = '6000') => ({ id, modelId: 'lab/code', kind: 'chat' as const, amount, expiresAt: Date.now() + 30000 });
test('expired mandates do not consume the open mandate limit', async () => {
    let time = Date.now();
    const store = createMandateStore(new Database(':memory:'), () => time);
    for (let i = 0; i < 10; i++) await store.create('owner', { ...policy(), expiresAt: time + 1000 });
    await expect(store.create('owner', { ...policy(), expiresAt: time + 5000 })).rejects.toThrow('Too many');
    time += 1001;
    expect((await store.create('owner', { ...policy(), expiresAt: time + 5000 })).state).toBe('pending');
});
test('concurrent reservations never spend the same remaining mandate budget twice',async()=>{
    const store=createMandateStore(new Database(':memory:')),m=await store.create('owner',policy());
    await store.activate('owner',m.id,payer);
    const results=await Promise.allSettled([store.reserve('owner',m.id,quote('race-1')),store.reserve('owner',m.id,quote('race-2'))]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await store.get('owner',m.id)).reservedAmount).toBe('6000');
});
test('rejects malformed, unbounded or already expired mandates before storing them', async () => {
    const db = new Database(':memory:');
    const store = createMandateStore(db);
    for (const change of [{ totalAmount: '1e6' }, { perCallAmount: '10001' }, { maxCalls: 0 }, { maxCalls: 1.2 }, { models: [] }, { expiresAt: Date.now() - 1 }, { payer: 'no wallet' }, { totalAmount: '100000001' }]) {
        await expect((async () => await store.create('owner', { ...policy(), ...change }))()).rejects.toThrow();
    }
    expect(await store.list('owner')).toHaveLength(0);
});
test('requires verified activation, enforces ownership and never rebinds an active channel', async () => {
    const store = createMandateStore(new Database(':memory:'));
    const mandate = await store.create('owner', policy());
    await expect((async () => await store.reserve('owner', mandate.id, quote('q1')))()).rejects.toThrow();
    await expect((async () => await store.activate('stranger', mandate.id, payer))()).rejects.toThrow();
    await store.activate('owner', mandate.id, payer);
    await expect((async () => await store.activate('owner', mandate.id, '11111111111111111111111111111111'))()).rejects.toThrow();
    await expect((async () => await store.get('stranger', mandate.id))()).rejects.toThrow();
});
test('holds the cumulative budget atomically and keeps uncertain work reserved after restart', async () => {
    const db = new Database(':memory:');
    const store = createMandateStore(db);
    const m = await store.create('owner', policy());
    await store.activate('owner', m.id, payer);
    const firstQuote = quote('q1');
    const first = await store.reserve('owner', m.id, firstQuote);
    expect(first.cumulativeAmount).toBe('6000');
    expect((await store.reserve('owner', m.id, firstQuote)).id).toBe(first.id);
    await expect((async () => await store.reserve('owner', m.id, quote('q2', '4000')))()).rejects.toThrow();
    await store.markSigned('owner', first.id);
    const restored = createMandateStore(db);
    expect((await restored.get('owner', m.id)).reservedAmount).toBe('6000');
    await expect((async () => await restored.release('owner', first.id))()).rejects.toThrow();
    await restored.complete('owner', first.id);
    expect((await restored.get('owner', m.id)).spentAmount).toBe('6000');
    await expect((async () => await restored.reserve('owner', m.id, quote('q2')))()).rejects.toThrow();
    const second = await restored.reserve('owner', m.id, quote('q2', '4000'));
    expect(second.cumulativeAmount).toBe('10000');
    await restored.markSigned('owner', second.id);
    await restored.complete('owner', second.id);
    await restored.complete('owner', second.id);
    expect((await restored.get('owner', m.id)).spentAmount).toBe('10000');
    await expect((async () => await restored.reserve('owner', m.id, quote('q3', '1000')))()).rejects.toThrow();
});
test('rejects changed replay terms, model swaps, expired quotes and requests after stop', async () => {
    const store = createMandateStore(new Database(':memory:'));
    const m = await store.create('owner', policy());
    await store.activate('owner', m.id, payer);
    await expect((async () => await store.reserve('owner', m.id, { ...quote('other'), modelId: 'unapproved' }))()).rejects.toThrow();
    await expect((async () => await store.reserve('owner', m.id, { ...quote('old'), expiresAt: 0 }))()).rejects.toThrow();
    const held = await store.reserve('owner', m.id, quote('q1'));
    await store.release('owner', held.id);
    await expect((async () => await store.reserve('owner', m.id, quote('q1', '1000')))()).rejects.toThrow();
    expect((await store.get('owner', m.id)).reservedAmount).toBe('0');
    await store.stop('owner', m.id);
    await expect((async () => await store.reserve('owner', m.id, quote('q2', '1000')))()).rejects.toThrow();
});
test('expired mandates cannot admit new purchases even if the app stays open', async () => {
    let now = 100000;
    const store = createMandateStore(new Database(':memory:'), () => now);
    const m = await store.create('owner', { ...policy(), expiresAt: now + 1000 });
    await store.activate('owner', m.id, payer);
    now += 1001;
    await expect((async () => await store.reserve('owner', m.id, { ...quote('q1'), expiresAt: now + 1000 }))()).rejects.toThrow();
});
test('first purchase reserves funding once and cannot activate after the user stops', async () => {
    const store = createMandateStore(new Database(':memory:'));
    const m = await store.create('owner', policy());
    const q = quote('initial');
    const held = await store.reserveFunding('owner', m.id, q);
    expect((await store.get('owner', m.id)).state).toBe('funding');
    expect((await store.reserveFunding('owner', m.id, q)).id).toBe(held.id);
    await expect((async () => await store.reserveFunding('owner', m.id, quote('different')))()).rejects.toThrow();
    await store.markSigned('owner', held.id);
    await store.stop('owner', m.id);
    await expect((async () => await store.activate('owner', m.id, payer))()).rejects.toThrow();
    await store.complete('owner', held.id);
    expect((await store.get('owner', m.id)).spentAmount).toBe('6000');
});
