import assert from 'node:assert/strict';
import test from 'node:test';
import { runModelCall } from '../src/model-provider.ts';
import {PNG} from 'pngjs';
const terms = {modelId:'lab/code',kind:'chat',provider:'lab',limits:{maxOutputTokens:10,tokenParameter:'max_tokens'},maxPrice:{prompt:1,completion:2}} as any;
test('uses the quoted model, bounded output and pinned provider without leaking the API key', async () => {
  let sent:any;
  const result = await runModelCall(terms,{prompt:'explain this function'},'test-key',async (url,init) => {
    assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
    sent = JSON.parse(String(init?.body));
    return Response.json({id:'generation-1',choices:[{message:{content:'It adds two numbers.'},finish_reason:'stop'}],usage:{cost:0.0001}});
  });
  assert.equal(sent.model,'lab/code'); assert.equal(sent.max_tokens,10);
  assert.equal(sent.provider.allow_fallbacks,false);
  assert.deepEqual(sent.provider.max_price,terms.maxPrice);
  assert.equal(result.text,'It adds two numbers.');
  assert.ok(!JSON.stringify(result).includes('test-key'));
});
test('truncated or filtered output and header-only media never earn completion',async()=>{
  for(const reason of ['length','content_filter',undefined]) await assert.rejects(runModelCall(terms,{prompt:'hi'},'key',async()=>Response.json({choices:[{message:{content:'partial'},finish_reason:reason}]})),/incomplete/);
  await assert.rejects(runModelCall({...terms,kind:'image'},{prompt:'hi'},'key',async()=>Response.json({data:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]})),/image|format/);
  await assert.rejects(runModelCall({...terms,kind:'voice'},{prompt:'hi'},'key',async()=>new Response('ID3',{headers:{'content-type':'audio/mpeg'}})),/audio/);
});
test('image adapter accepts a fully decoded PNG and rejects corrupted pixel data',async()=>{
  const image=PNG.sync.write({width:1,height:1,data:Buffer.from([1,2,3,255])} as PNG);
  const imageTerms={...terms,kind:'image',maxPrice:{image:0.02}} as any;
  const result=await runModelCall(imageTerms,{prompt:'hi'},'key',async()=>Response.json({data:[{b64_json:image.toString('base64')}],usage:{cost:0.02}}));
  assert.equal(result.mediaType,'image/png');
  const broken=Buffer.from(image);broken[broken.length-15]^=255;
  await assert.rejects(runModelCall(imageTerms,{prompt:'hi'},'key',async()=>Response.json({data:[{b64_json:broken.toString('base64')}]})),/image/);
});
test('rejects secrets, malformed outputs and upstream failures rather than inventing a result', async () => {
  await assert.rejects(runModelCall(terms,{prompt:'sk-proj-'+'x'.repeat(30)},'key',async()=>{throw Error('must not send');}),/secret/i);
  await assert.rejects(runModelCall(terms,{prompt:'hi'},'key',async()=>Response.json({choices:[]})),/output/i);
  await assert.rejects(runModelCall(terms,{prompt:'hi'},'key',async()=>new Response('secret provider detail',{status:429})),/429/);
});
