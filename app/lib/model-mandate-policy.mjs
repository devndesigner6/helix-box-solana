const integer=(value,zero=false)=>{
  if(typeof value!=='string'||!(zero?/^(0|[1-9]\d{0,8})$/:/^[1-9]\d{0,8}$/).test(value))throw new Error('Invalid mandate amount');
  return BigInt(value);
};
const operations=new Map();
export function modelRecoveryAction(policy,state,job,hasSubmission,allowReplay,now=Date.now()){
  if(job.state!=='quoted')return 'status';
  if(!hasSubmission||!allowReplay||state.stopped||policy.expiresAt<=now||job.terms.expiresAt<=now)return 'cancel';
  return 'replay';
}
export async function serializeLocalModelOperation(id,action) {
  const previous=operations.get(id)??Promise.resolve();let release;
  const current=previous.then(()=>new Promise(resolve=>{release=resolve;}));operations.set(id,current);await previous;
  try{return await action();}finally{release();if(operations.get(id)===current)operations.delete(id);}
}
export async function processPhoneModelQueue(requests,authorize,isCurrent) {
  let error=null;
  for(const request of requests) {
    if(!isCurrent())break;
    try{await authorize(request);}catch(cause){
      const message=cause instanceof Error?cause.message:'Model purchase paused';
      if(!message.includes('does not hold')&&!message.includes('another workspace'))error=message;
    }
  }
  return error;
}
export function reserveLocalModelCall(policy,state,job,now=Date.now()) {
  const terms=job?.terms;
  if(state.stopped||!Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=now||!Number.isSafeInteger(terms?.expiresAt)||terms.expiresAt<=now)throw new Error('Mandate or quote is stopped or expired');
  if(!Array.isArray(policy.models)||!policy.models.some(m=>m.id===terms.modelId&&m.kind===terms.kind))throw new Error('This model is not in your mandate');
  const price=integer(terms.amount),limit=integer(policy.totalAmount),perCall=integer(policy.perCallAmount);
  if(limit<10000n||limit>100000000n||perCall>limit||price>perCall||typeof job.id!=='string'||!job.id)throw new Error('Purchase exceeds your mandate');
  const termsKey=JSON.stringify([job.id,terms.modelId,terms.kind,terms.amount,terms.expiresAt]);
  if(state.pending) {
    if(state.pending.termsKey!==termsKey)throw new Error('Previous purchase needs reconciliation before another signature');
    return state.pending;
  }
  const cumulative=integer(state.spentAmount,true)+price;
  if(cumulative>limit||!Number.isSafeInteger(policy.maxCalls)||!Number.isSafeInteger(state.usedCalls)||state.usedCalls<0||state.usedCalls>=policy.maxCalls)throw new Error('Mandate budget or call limit reached');
  return {id:job.id,termsKey,amount:terms.amount,cumulativeAmount:cumulative.toString()};
}
