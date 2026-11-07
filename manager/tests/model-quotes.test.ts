import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteModelCall } from '../src/model-quotes.ts';
const model = {id:'lab/code',name:'Code',kind:'chat',contextLength:10000,voices:[],outputModalities:['text']} as any;
const endpoints = [{tag:'lab',status:0,pricing:{prompt:'0.000001',completion:'0.000002'},supported_parameters:['max_tokens']}];
test('prices a bounded call with integer USDC arithmetic and pins the endpoint', () => {
  const quote = quoteModelCall(model,endpoints,{prompt:'hello',maxOutputTokens:100},0);
  assert.equal(quote.provider,'lab');
  assert.equal(quote.amount,'1000'); // disclosed minimum charge = 0.001 USDC
  assert.equal(quote.limits.maxOutputTokens,100);
});
test('rejects oversized calls, unsupported billing and unavailable providers instead of guessing', () => {
  assert.throws(() => quoteModelCall(model,endpoints,{prompt:'x'.repeat(9000)},0),/limit/i);
  assert.throws(() => quoteModelCall(model,[{...endpoints[0],status:-2}],{prompt:'hello'},0),/price|provider/i);
  assert.throws(() => quoteModelCall({...model,kind:'image'},[{provider_tag:'lab',pricing:[{unit:'token',billable:'output_image',cost_usd:1}]}],{prompt:'hi'},0),/price|provider/i);
});
test('quotes only listed voices and accounts for the complete bounded image operation', () => {
  const voice = quoteModelCall({...model,kind:'voice',voices:['calm']},[{...endpoints[0],pricing:{prompt:'0.000015',completion:'0'}}],{prompt:'hello',voice:'calm'},0);
  assert.equal(voice.limits.voice,'calm');
  assert.throws(() => quoteModelCall({...model,kind:'voice',voices:['calm']},endpoints,{prompt:'hi',voice:'unknown'},0));
  const image = quoteModelCall({...model,kind:'image'},[{provider_tag:'lab',supported_parameters:{output_format:{type:'enum',values:['png']},n:{type:'range',min:1,max:1}},pricing:[{unit:'image',billable:'output_image',cost_usd:0.02}]}],{prompt:'hi'},0);
  assert.equal(image.amount,'24000');
});
test('unverified image count or output format is declined before payment',()=>{
  const endpoint={provider_tag:'lab',supported_parameters:{},pricing:[{unit:'image',billable:'output_image',cost_usd:0.02}]};
  assert.throws(()=>quoteModelCall({...model,kind:'image'},[endpoint],{prompt:'hi'}),/price|provider/);
});
test('unbounded chat billing dimensions and mixed output are rejected; speech counts fixed request fees',()=>{
  assert.throws(()=>quoteModelCall(model,[{...endpoints[0],pricing:{prompt:'0',completion:'0',internal_reasoning:'0.5'}}],{prompt:'hi'}),/provider|price/);
  assert.throws(()=>quoteModelCall({...model,outputModalities:['text','image']},endpoints,{prompt:'hi'}),/modality|text/);
  const speech=quoteModelCall({...model,kind:'voice',voices:['a']},[{...endpoints[0],pricing:{prompt:'0',completion:'0',request:'0.02'}}],{prompt:'hi',voice:'a'});
  assert.equal(speech.amount,'24000');
});
