import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createMandateStore } from '../src/model-mandates.ts';

const payer='7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const policy=()=>({payer,authorizer:'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',models:[{id:'lab/code',kind:'chat' as const}],totalAmount:'10000',perCallAmount:'6000',maxCalls:2,expiresAt:Date.now()+60000});
const quote=(id:string,amount='6000')=>({id,modelId:'lab/code',kind:'chat' as const,amount,expiresAt:Date.now()+30000});

test('rejects malformed, unbounded or already expired mandates before storing them',()=>{
  const db=new Database(':memory:');const store=createMandateStore(db);
  for(const change of [{totalAmount:'1e6'},{perCallAmount:'10001'},{maxCalls:0},{maxCalls:1.2},{models:[]},{expiresAt:Date.now()-1},{payer:'no wallet'},{totalAmount:'100000001'}]) {
    expect(()=>store.create('owner',{...policy(),...change})).toThrow();
  }
  expect(store.list('owner')).toHaveLength(0);
});

test('requires verified activation, enforces ownership and never rebinds an active channel',()=>{
  const store=createMandateStore(new Database(':memory:'));const mandate=store.create('owner',policy());
  expect(()=>store.reserve('owner',mandate.id,quote('q1'))).toThrow();
  expect(()=>store.activate('stranger',mandate.id,payer)).toThrow();
  store.activate('owner',mandate.id,payer);
  expect(()=>store.activate('owner',mandate.id,'11111111111111111111111111111111')).toThrow();
  expect(()=>store.get('stranger',mandate.id)).toThrow();
});

test('holds the cumulative budget atomically and keeps uncertain work reserved after restart',()=>{
  const db=new Database(':memory:');const store=createMandateStore(db);const m=store.create('owner',policy());store.activate('owner',m.id,payer);
  const firstQuote=quote('q1');const first=store.reserve('owner',m.id,firstQuote);
  expect(first.cumulativeAmount).toBe('6000');
  expect(store.reserve('owner',m.id,firstQuote).id).toBe(first.id);
  expect(()=>store.reserve('owner',m.id,quote('q2','4000'))).toThrow();
  store.markSigned('owner',first.id);
  const restored=createMandateStore(db);
  expect(restored.get('owner',m.id).reservedAmount).toBe('6000');
  expect(()=>restored.release('owner',first.id)).toThrow();
  restored.complete('owner',first.id);
  expect(restored.get('owner',m.id).spentAmount).toBe('6000');
  expect(()=>restored.reserve('owner',m.id,quote('q2'))).toThrow();
  const second=restored.reserve('owner',m.id,quote('q2','4000'));expect(second.cumulativeAmount).toBe('10000');
  restored.markSigned('owner',second.id);restored.complete('owner',second.id);restored.complete('owner',second.id);
  expect(restored.get('owner',m.id).spentAmount).toBe('10000');
  expect(()=>restored.reserve('owner',m.id,quote('q3','1000'))).toThrow();
});

test('rejects changed replay terms, model swaps, expired quotes and requests after stop',()=>{
  const store=createMandateStore(new Database(':memory:'));const m=store.create('owner',policy());store.activate('owner',m.id,payer);
  expect(()=>store.reserve('owner',m.id,{...quote('other'),modelId:'unapproved'})).toThrow();
  expect(()=>store.reserve('owner',m.id,{...quote('old'),expiresAt:0})).toThrow();
  const held=store.reserve('owner',m.id,quote('q1'));store.release('owner',held.id);
  expect(()=>store.reserve('owner',m.id,quote('q1','1000'))).toThrow();
  expect(store.get('owner',m.id).reservedAmount).toBe('0');
  store.stop('owner',m.id);
  expect(()=>store.reserve('owner',m.id,quote('q2','1000'))).toThrow();
});

test('expired mandates cannot admit new purchases even if the app stays open',()=>{
  let now=100000;const store=createMandateStore(new Database(':memory:'),()=>now);
  const m=store.create('owner',{...policy(),expiresAt:now+1000});store.activate('owner',m.id,payer);now+=1001;
  expect(()=>store.reserve('owner',m.id,{...quote('q1'),expiresAt:now+1000})).toThrow();
});
