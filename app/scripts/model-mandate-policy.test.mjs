import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveLocalModelCall,serializeLocalModelOperation,processPhoneModelQueue,modelRecoveryAction} from '../lib/model-mandate-policy.mjs';
const policy={models:[{id:'lab/code',kind:'chat'}],totalAmount:'10000',perCallAmount:'6000',maxCalls:2,expiresAt:2000};
const state={spentAmount:'0',usedCalls:0,stopped:false,pending:null};
const job={id:'q1',state:'quoted',terms:{modelId:'lab/code',kind:'chat',amount:'6000',expiresAt:1800}};
test('recovery replays only an existing signature and never cancels a possibly accepted payment',()=>{
  assert.equal(modelRecoveryAction(policy,state,job,true,true,1000),'replay');
  assert.equal(modelRecoveryAction(policy,state,job,false,true,1000),'cancel');
  assert.equal(modelRecoveryAction(policy,state,job,true,true,1900),'cancel');
  assert.equal(modelRecoveryAction(policy,{...state,stopped:true},job,true,true,1000),'cancel');
  assert.equal(modelRecoveryAction(policy,state,job,true,false,1000),'cancel');
  for(const status of ['payment_pending','settlement_uncertain','provider_uncertain','completed']){
    assert.equal(modelRecoveryAction(policy,state,{...job,state:status},true,true,1900),'status');
  }
});
test('phone enforces model, price, total, call count, expiry and stop independently of the server',()=>{
  assert.equal(reserveLocalModelCall(policy,state,job,1000).cumulativeAmount,'6000');
  for(const [p,s,j] of [[policy,{...state,stopped:true},job],[policy,{...state,spentAmount:'6000'},job],[policy,{...state,usedCalls:2},job],
    [{...policy,expiresAt:900},state,job],[policy,state,{...job,terms:{...job.terms,amount:'1e6'}}],[policy,state,{...job,terms:{...job.terms,modelId:'other'}}],
    [policy,state,{...job,terms:{...job.terms,amount:'7000'}}],[policy,state,{...job,terms:{...job.terms,expiresAt:900}}]])assert.throws(()=>reserveLocalModelCall(p,s,j,1000));
});
test('an interrupted signature holds its budget and only the identical purchase may recover it',()=>{
  const pending=reserveLocalModelCall(policy,state,job,1000);
  assert.deepEqual(reserveLocalModelCall(policy,{...state,pending},job,1000),pending);
  assert.throws(()=>reserveLocalModelCall(policy,{...state,pending},{...job,id:'q2'},1000));
  assert.throws(()=>reserveLocalModelCall(policy,{...state,pending},{...job,terms:{...job.terms,amount:'1000'}},1000));
});
test('two callers cannot read the same old phone budget while signing',async()=>{
  let spent=0;
  await Promise.all([1,2].map(()=>serializeLocalModelOperation('mandate',async()=>{const before=spent;await new Promise(resolve=>setTimeout(resolve,5));spent=before+1;})));
  assert.equal(spent,2);
  await assert.rejects(serializeLocalModelOperation('mandate',async()=>{throw new Error('cancelled');}));
  assert.equal(await serializeLocalModelOperation('mandate',async()=>spent),2);
});
test('another phone’s queued purchase cannot block purchases owned by this phone',async()=>{
  const done=[];const error=await processPhoneModelQueue(['other-phone','this-phone'],async id=>{
    if(id==='other-phone')throw new Error('This phone does not hold the mandate signing key');done.push(id);
  },()=>true);
  assert.deepEqual(done,['this-phone']);assert.equal(error,null);
});
