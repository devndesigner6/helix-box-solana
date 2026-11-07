import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createModelApp} from '../src/model-app.ts';
import {encodePaymentSignatureHeader,decodePaymentRequiredHeader} from '@x402/core/http';
import {createModelStore} from '../src/model-store.ts';
const config={network:'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',asset:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',payTo:'7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy',facilitatorUrl:'https://facilitator.payai.network'} as any;
const upstream = async (url:any) => Response.json(String(url).includes('/endpoints')
  ? {data:{endpoints:[{tag:'lab',status:0,pricing:{prompt:'0.000001',completion:'0.000002'},supported_parameters:['max_tokens']}]}}
  : {data:[{id:'lab/code',name:'Code',architecture:{output_modalities:['text']},endpoints:['/api/v1/chat/completions'],pricing:{prompt:'0.000001',completion:'0.000002'}}]});
test('catalog stays real and public, quotes require paired authentication, provider setup and consent',async()=>{
  const app=createModelApp({db:new Database(':memory:'),apiKey:'test-key',dataKey:'test-data',config,enabled:true,durable:true,
    authenticate:req=>req.headers.get('authorization')==='Bearer paired'?'owner':null,fetcher:upstream});
  expect((await app.request('/v2/models')).status).toBe(200);
  expect((await app.request('/v2/models/quotes',{method:'POST',body:'{}'})).status).toBe(401);
  const quote=await app.request('/v2/models/quotes',{method:'POST',headers:{authorization:'Bearer paired','content-type':'application/json'},
    body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'Explain this',consent:true})});
  expect(quote.status).toBe(201);
  const job=await quote.json(); expect(job.terms.modelId).toBe('lab/code');
  expect(JSON.stringify(job)).not.toContain('test-key');
  expect((await app.request('/v2/models/purchases/'+job.id,{headers:{authorization:'Bearer other'}})).status).toBe(401);
});
test('missing backend configuration never creates a payable quote',async()=>{
  const app=createModelApp({db:new Database(':memory:'),apiKey:'',dataKey:'key',config,enabled:false,durable:false,authenticate:()=> 'owner',fetcher:upstream});
  const result=await app.request('/v2/models/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'hi',consent:true})});
  expect(result.status).toBe(503);
});
test('legacy payment headers cannot bypass purchase settlement tracking',async()=>{
  const app=createModelApp({db:new Database(':memory:'),apiKey:'test',dataKey:'key',config,enabled:true,durable:true,authenticate:()=> 'owner',fetcher:upstream});
  const job=await (await app.request('/v2/models/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'Explain',consent:true})})).json();
  const response=await app.request('/v2/models/purchases/'+job.id+'/pay',{method:'POST',headers:{'x-payment':'legacy'}});
  expect(response.status).toBe(400);
});
test('a paid resume rechecks live rates and never dispatches a higher priced operation',async()=>{
  const db=new Database(':memory:');let changed=false,generations=0;
  const app=createModelApp({db,apiKey:'test',dataKey:'test-data',config,enabled:true,durable:true,authenticate:()=> 'owner',fetcher:async(url,init)=>{
    if(init?.method==='POST')generations++;
    if(changed&&String(url).includes('/endpoints'))return Response.json({data:{endpoints:[{tag:'lab',status:0,pricing:{prompt:'0.1',completion:'0.1'},supported_parameters:['max_tokens']}]}});
    return upstream(url);
  }});
  const job=await (await app.request('/v2/models/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'Explain',consent:true})})).json();
  const store=createModelStore(db,'test-data');store.beginPayment('owner',job.id,'proof');store.settled('owner',job.id,'test-settled');changed=true;
  const result=await (await app.request('/v2/models/purchases/'+job.id+'/resume',{method:'POST'})).json();
  expect(result.state).toBe('refund_due');expect(generations).toBe(0);
});

test('actual x402 middleware settles once, then calls the provider once and replays its saved result',async()=>{
  let settlements=0, generations=0;
  const facilitator=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    if(new URL(req.url).pathname==='/verify') return Response.json({isValid:true,payer:config.payTo});
    if(new URL(req.url).pathname==='/settle') {settlements++;return Response.json({success:true,transaction:'integration-settlement',network:config.network,payer:config.payTo});}
    return Response.json({kinds:[{x402Version:2,scheme:'exact',network:config.network,extra:{feePayer:'11111111111111111111111111111111'}}],extensions:[],signers:{}});
  }});
  try {
    const app=createModelApp({db:new Database(':memory:'),apiKey:'test',dataKey:'test-data',enabled:true,durable:true,
      config:{...config,facilitatorUrl:facilitator.url.toString()},authenticate:()=> 'owner',fetcher:async(url,init)=>{
        if(init?.method==='POST') {generations++;return Response.json({id:'actual-adapter-result',choices:[{message:{content:'Useful provider output'},finish_reason:'stop'}],usage:{cost:0.0002}});}
        return upstream(url);
      }});
    const quote=await app.request('/v2/models/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'Explain',consent:true})});
    const job=await quote.json();
    const path='/v2/models/purchases/'+job.id+'/pay';
    const unpaid=await app.request(path,{method:'POST'});
    expect(unpaid.status).toBe(402);
    expect(generations).toBe(0);
    const required=decodePaymentRequiredHeader(unpaid.headers.get('payment-required')!);
    expect(required.accepts[0].amount).toBe(job.terms.amount);
    expect(required.accepts[0].extra?.memo).toBe(job.id);
    const signed=encodePaymentSignatureHeader({x402Version:2,resource:required.resource,accepted:required.accepts[0],payload:{transaction:Buffer.from('test transaction bytes').toString('base64')}});
    const pay=()=>app.request(path,{method:'POST',headers:{'payment-signature':signed}});
    const responses=await Promise.all([pay(),pay()]);
    expect(responses.some(response=>response.status===200)).toBe(true);
    const result=await (await pay()).json();
    expect(result.state).toBe('completed');
    expect(result.result.text).toBe('Useful provider output');
    expect(settlements).toBe(1);expect(generations).toBe(1);
  } finally {facilitator.stop(true);}
});

test('failed or unknown settlement cannot call the provider or settle again on a retry',async()=>{
  let settlements=0, generations=0;
  const facilitator=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    if(new URL(req.url).pathname==='/verify') return Response.json({isValid:true,payer:config.payTo});
    if(new URL(req.url).pathname==='/settle') {settlements++;return Response.json({success:false,errorReason:'settlement failed',transaction:'',network:config.network});}
    return Response.json({kinds:[{x402Version:2,scheme:'exact',network:config.network,extra:{feePayer:'11111111111111111111111111111111'}}],extensions:[],signers:{}});
  }});
  try {
    const app=createModelApp({db:new Database(':memory:'),apiKey:'test',dataKey:'test-data',enabled:true,durable:true,
      config:{...config,facilitatorUrl:facilitator.url.toString()},authenticate:()=> 'owner',fetcher:async(url,init)=>{if(init?.method==='POST') generations++;return upstream(url);}});
    const job=await (await app.request('/v2/models/quotes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({modelId:'lab/code',kind:'chat',prompt:'Explain',consent:true})})).json();
    const path='/v2/models/purchases/'+job.id+'/pay';
    const required=decodePaymentRequiredHeader((await app.request(path,{method:'POST'})).headers.get('payment-required')!);
    const signed=encodePaymentSignatureHeader({x402Version:2,resource:required.resource,accepted:required.accepts[0],payload:{transaction:Buffer.from('failed transaction bytes').toString('base64')}});
    const pay=()=>app.request(path,{method:'POST',headers:{'payment-signature':signed}});
    expect((await (await pay()).json()).state).toBe('settlement_uncertain');
    expect((await (await pay()).json()).state).toBe('settlement_uncertain');
    expect(settlements).toBe(1);expect(generations).toBe(0);
  } finally {facilitator.stop(true);}
});
