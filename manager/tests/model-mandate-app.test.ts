import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createModelApp } from '../src/model-app.ts';
import { createMandateStore } from '../src/model-mandates.ts';
import { createModelStore } from '../src/model-store.ts';
import { createChannelStore } from '../src/model-channel-store.ts';
import type { ChannelState } from '@x402/svm/batch-settlement/server';
const config = { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', payTo: '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy', facilitatorUrl: 'https://facilitator.payai.network' } as any;
const upstream = async (url: any) => Response.json(String(url).includes('/endpoints') ? { data: { endpoints: [{ tag: 'lab', status: 0, pricing: { prompt: '0.000001', completion: '0.000001' }, supported_parameters: ['max_tokens'] }] } } : { data: [{ id: 'lab/code', name: 'Code', architecture: { output_modalities: ['text'] }, endpoints: ['/api/v1/chat/completions'], pricing: { prompt: '0.000001', completion: '0.000001' } }] });
const policy = () => ({ payer: config.payTo, authorizer: 'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww', models: [{ id: 'lab/code', kind: 'chat' }], totalAmount: '10000', perCallAmount: '10000', maxCalls: 2, expiresAt: Date.now() + 60000 });
const post = (body: unknown) => ({ method: 'POST', headers: { authorization: 'Bearer paired', 'content-type': 'application/json' }, body: JSON.stringify(body) });
for(const fulfillFirst of [true,false])test(`interrupted pre-fulfillment work releases only provably uncharged new-protocol reservations (${fulfillFirst})`,async()=>{
    const db=new Database(':memory:'),app=createModelApp({db,apiKey:'key',dataKey:'data',config,enabled:true,durable:true,authenticate:()=> 'owner',fetcher:upstream});
    const m=await(await app.request('/v2/models/mandates',post({policy:policy(),consent:true}))).json();
    const job=await(await app.request('/v2/models/quotes',post({modelId:'lab/code',kind:'chat',prompt:'Explain',maxOutputTokens:20,consent:true}))).json();
    const mandates=createMandateStore(db),purchases=createModelStore(db,'data');await purchases.ready;
    const held=await mandates.reserveFunding('owner',m.id,{id:job.id,modelId:job.terms.modelId,kind:job.terms.kind,amount:job.terms.amount,expiresAt:job.terms.expiresAt});
    await mandates.markSigned('owner',held.id);await mandates.recordChannel('owner',m.id,config.payTo);
    await purchases.beginPayment('owner',job.id,'interrupted-proof',fulfillFirst);await purchases.startPreparing('owner',job.id);
    await createChannelStore(db).put({channelId:config.payTo,payer:m.policy.payer,payerAuthorizer:m.policy.authorizer,receiver:config.payTo,mint:config.asset,
        deposit:10000n,chargedCumulativeAmount:0n,signedMaxClaimable:0n,settled:0n,payoutWatermark:0n,status:'open',reservations:{expired:{kind:'client',ceiling:1000n,expiresAt:Date.now()-1}}} as ChannelState);
    db.query('UPDATE model_purchases SET terms=? WHERE id=?').run(JSON.stringify({...job.terms,expiresAt:Date.now()-1}),job.id);
    await createModelStore(db,'data').ready;
    expect((await app.request('/v2/models/mandates/pending')).status).toBe(200);
    const recovered=await mandates.get('owner',m.id),purchase=await purchases.get('owner',job.id);
    expect(recovered.reservedAmount).toBe(fulfillFirst?'0':job.terms.amount);
    expect(recovered.state).toBe(fulfillFirst?'pending':'funding');
    expect(purchase.state).toBe(fulfillFirst?'unfulfilled':'provider_uncertain');
});

test('disabling new purchases or removing the provider key does not disable channel withdrawal',async()=>{
    const facilitator=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({kinds:[{x402Version:2,scheme:'batch-settlement',network:config.network,extra:{feePayer:'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',transactionVersions:[0]}}],extensions:[],signers:{}})});
    try{
        const db=new Database(':memory:'),mandates=createMandateStore(db),m=await mandates.create('owner',policy() as any);
        await mandates.activate('owner',m.id,config.payTo);
        const app=createModelApp({db,apiKey:'',dataKey:'data',config:{...config,facilitatorUrl:facilitator.url.toString()},enabled:false,durable:true,authenticate:()=> 'owner',fetcher:upstream});
        const response=await app.request(`/v2/models/mandates/${m.id}/close`,post({}));
        expect(response.status).toBe(402);expect(response.headers.has('payment-required')).toBe(true);
        expect((await mandates.get('owner',m.id)).state).toBe('stopped');
        expect((await app.request('/v2/models/mandates',post({policy:policy(),consent:true}))).status).toBe(503);
    }finally{facilitator.stop(true);}
});
test('paired ownership and durable-payment feature flag gate creation, never a client activation flag', async () => {
    const app = createModelApp({ db: new Database(':memory:'), apiKey: 'key', dataKey: 'data', config, enabled: false, durable: false, authenticate: req => req.headers.has('authorization') ? 'owner' : null, fetcher: upstream });
    expect((await app.request('/v2/models/mandates')).status).toBe(401);
    expect((await app.request('/v2/models/mandates', post({ policy: policy(), consent: true, active: true }))).status).toBe(503);
});
test('agent requests stay queued until the paired phone authorizes them, and stopping prevents admission', async () => {
    const db = new Database(':memory:');
    const app = createModelApp({ db, apiKey: 'key', dataKey: 'data', config, enabled: true, durable: true, authenticate: () => 'owner', fetcher: upstream });
    const created = await app.request('/v2/models/mandates', post({ policy: policy(), consent: true }));
    expect(created.status).toBe(201);
    const m = await created.json();
    expect(m.state).toBe('pending');
    const store = createMandateStore(db);
    await store.activate('owner', m.id, config.payTo);
    const job = await (await app.request('/v2/models/quotes', post({ modelId: 'lab/code', kind: 'chat', prompt: 'Explain this', maxOutputTokens: 20, consent: true }))).json();
    const queued = await app.request(`/v2/models/purchases/${job.id}/request`, post({ mandateId: m.id }));
    expect(queued.status).toBe(202);
    const pending = await (await app.request('/v2/models/mandates/pending')).json();
    expect(pending.requests[0].purchase.id).toBe(job.id);
    expect(pending.requests[0].purchase.state).toBe('quoted');
    expect(JSON.stringify(pending)).not.toContain('Explain this');
    await app.request(`/v2/models/mandates/${m.id}/stop`, post({}));
    const another = await (await app.request('/v2/models/quotes', post({ modelId: 'lab/code', kind: 'chat', prompt: 'Next', maxOutputTokens: 20, consent: true }))).json();
    expect((await app.request(`/v2/models/purchases/${another.id}/request`, post({ mandateId: m.id }))).status).toBe(409);
});
for (const acknowledged of [false, true])
    test(`committed first-deposit recovery activates its mandate and clears a signed reservation (acknowledged=${acknowledged})`, async () => {
        const db = new Database(':memory:');
        const app = createModelApp({ db, apiKey: 'key', dataKey: 'data', config, enabled: true, durable: true, authenticate: () => 'owner', fetcher: upstream });
        const m = await (await app.request('/v2/models/mandates', post({ policy: policy(), consent: true }))).json();
        const job = await (await app.request('/v2/models/quotes', post({ modelId: 'lab/code', kind: 'chat', prompt: 'Explain', maxOutputTokens: 20, consent: true }))).json();
        const mandates = createMandateStore(db), purchases = createModelStore(db, 'data');
        const held = await mandates.reserveFunding('owner', m.id, { id: job.id, modelId: job.terms.modelId, kind: job.terms.kind, amount: job.terms.amount, expiresAt: job.terms.expiresAt });
        await mandates.markSigned('owner', held.id);
        await mandates.recordChannel('owner', m.id, config.payTo);
        await purchases.beginPayment('owner', job.id, 'fixture-proof');
        await createChannelStore(db).put({ channelId: config.payTo, payer: m.policy.payer, payerAuthorizer: m.policy.authorizer, receiver: config.payTo, mint: config.asset,
            deposit: 10000n, chargedCumulativeAmount: BigInt(job.terms.amount), signedMaxClaimable: BigInt(job.terms.amount), settled: 0n, payoutWatermark: 0n, status: 'open' } as ChannelState);
        if (acknowledged)
            await purchases.acceptedBatch('owner', job.id, `${config.payTo}:${job.terms.amount}`, config.payTo);
        expect((await app.request('/v2/models/mandates/pending')).status).toBe(200);
        const recovered = await mandates.get('owner', m.id);
        expect(recovered.state).toBe('active');
        expect(recovered.reservedAmount).toBe('0');
        expect(recovered.spentAmount).toBe(job.terms.amount);
    });
