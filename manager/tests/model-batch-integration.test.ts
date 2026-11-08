import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createKeyPairSignerFromPrivateKeyBytes} from '@solana/kit';
import {signBatchVoucher} from '@x402/svm/batch-settlement/client';
import {decodePaymentRequiredHeader,encodePaymentSignatureHeader} from '@x402/core/http';
import {buildDelegatedDeposit} from '../../app/lib/solana-channel.ts';
import {createModelApp} from '../src/model-app.ts';

// Only the external facilitator and inference boundaries are fixtures. Real x402 middleware,
// voucher cryptography, SQLite accounting and our adapters execute; no mainnet money is sent.
for(const failure of ['none','deposit','voucher'])test(`channel purchases deliver before charging and do not charge failed inference (${failure})`,async()=>{
  const payer=await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(3));
  const delegate=await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(4));
  const network='solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',asset='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const feePayer='CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',payTo='7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
  let deposits=0,generations=0,channelId='';const order:string[]=[];
  const facilitator=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
    const route=new URL(req.url).pathname;
    if(route==='/supported')return Response.json({kinds:[{x402Version:2,scheme:'batch-settlement',network,extra:{feePayer,transactionVersions:[0]}}],extensions:[],signers:{}});
    const body=await req.json() as any;
    if(route==='/verify')return Response.json({isValid:true,payer:payer.address,extra:{channelId:body.paymentPayload.payload.voucher.channelId,balance:'10000',totalClaimed:'0',withdrawRequestedAt:0}});
    deposits++;order.push('deposit settled');
    return Response.json({success:true,payer:payer.address,transaction:'fixture-open-transaction',network,extra:{channelState:{channelId,balance:'10000',totalClaimed:'0',withdrawRequestedAt:0}}});
  }});
  try {
    const db=new Database(':memory:');
    const app=createModelApp({db,apiKey:'fixture-provider-key',dataKey:'fixture-stable-encryption-material',enabled:true,durable:true,authenticate:()=> 'owner',
      config:{network,asset,payTo,facilitatorUrl:facilitator.url.toString()} as any,fetcher:async(url,init)=>{
        if(init?.method==='POST'){
          generations++;order.push('provider called');
          if((failure==='deposit'&&generations===1)||(failure==='voucher'&&generations===2))return Response.json({error:'provider unavailable'},{status:503});
          return Response.json({id:`fixture-generation-${generations}`,choices:[{message:{content:'Fixture model output'},finish_reason:'stop'}],usage:{cost:0.0001}});
        }
        return Response.json(String(url).includes('/endpoints')?{data:{endpoints:[{tag:'lab',status:0,pricing:{prompt:'0.000001',completion:'0.000001'},supported_parameters:['max_tokens']}]}}:
          {data:[{id:'lab/code',name:'Code',architecture:{output_modalities:['text']},endpoints:['/api/v1/chat/completions'],pricing:{prompt:'0.000001',completion:'0.000001'}}]});
      }});
    const post=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const mandate=await (await app.request('/v2/models/mandates',post({consent:true,policy:{payer:payer.address,authorizer:delegate.address,models:[{id:'lab/code',kind:'chat'}],totalAmount:'10000',perCallAmount:'1000',maxCalls:2,expiresAt:Date.now()+60000}}))).json();
    const quote=async()=>await (await app.request('/v2/models/quotes',post({modelId:'lab/code',kind:'chat',prompt:'A bounded task',maxOutputTokens:20,consent:true}))).json();
    const first=await quote(),route=`/v2/models/purchases/${first.id}/channel/${mandate.id}`;
    const challenge=decodePaymentRequiredHeader((await app.request(route,post({}))).headers.get('payment-required')!);
    const accepted=challenge.accepts[0],extra=accepted.extra!;
    const built=await buildDelegatedDeposit({payer,authorizer:delegate.address,receiver:payTo,receiverAuthorizer:String(extra.receiverAuthorizer),mint:asset,feePayer:String(extra.feePayer),tokenProgram:String(extra.tokenProgram),
      blockhash:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:1000n},openSlot:123n,depositAmount:10000n,firstCharge:1000n,withdrawDelay:3600,memo:first.id,salt:10n});
    channelId=built.channelId;
    const firstPayload={...built.payload,voucher:await signBatchVoucher(delegate,{channelId,maxClaimableAmount:1000n,expiresAt:0})};
    const pay=async(path:string,accept:any,payload:any)=>app.request(path,{...post({}),headers:{'content-type':'application/json','payment-signature':encodePaymentSignatureHeader({x402Version:2,resource:challenge.resource,accepted:accept,payload})}});
    const firstResponse=await pay(route,accepted,firstPayload),firstResult=await firstResponse.json();
    if(failure==='deposit'){
      expect(firstResult.state).toBe('unfulfilled');expect(deposits).toBe(0);expect(generations).toBe(1);
      const state=await (await app.request('/v2/models/mandates')).json();expect(state.mandates[0].spentAmount).toBe('0');expect(state.mandates[0].reservedAmount).toBe('0');expect(state.mandates[0].state).toBe('pending');
      expect((await (await pay(route,accepted,firstPayload)).json()).state).toBe('unfulfilled');expect(generations).toBe(1);return;
    }
    expect(firstResult.state).toBe('completed');expect(firstResult.transaction).toBeNull();expect(firstResult.commitmentId).toBe(`${channelId}:1000`);
    expect(order).toEqual(['provider called','deposit settled']);
    const second=await quote();
    expect((await app.request(`/v2/models/purchases/${second.id}/request`,post({mandateId:mandate.id}))).status).toBe(202);
    const secondRoute=`/v2/models/purchases/${second.id}/channel/${mandate.id}`;
    const next=decodePaymentRequiredHeader((await app.request(secondRoute,post({}))).headers.get('payment-required')!).accepts[0];
    const result=await (await pay(secondRoute,next,{type:'voucher',channelConfig:built.payload.channelConfig,voucher:await signBatchVoucher(delegate,{channelId,maxClaimableAmount:2000n,expiresAt:0})})).json();
    if(failure==='voucher'){
      expect(result.state).toBe('unfulfilled');expect(deposits).toBe(1);
      const state=await (await app.request('/v2/models/mandates')).json();expect(state.mandates[0].spentAmount).toBe('1000');expect(state.mandates[0].reservedAmount).toBe('0');expect(state.mandates[0].usedCalls).toBe(1);
      const retry=await quote(),retryRoute=`/v2/models/purchases/${retry.id}/channel/${mandate.id}`;
      expect((await app.request(`/v2/models/purchases/${retry.id}/request`,post({mandateId:mandate.id}))).status).toBe(202);
      const acceptedRetry=decodePaymentRequiredHeader((await app.request(retryRoute,post({}))).headers.get('payment-required')!).accepts[0];
      expect((await (await pay(retryRoute,acceptedRetry,{type:'voucher',channelConfig:built.payload.channelConfig,voucher:await signBatchVoucher(delegate,{channelId,maxClaimableAmount:2000n,expiresAt:0})})).json()).state).toBe('completed');
      expect(deposits).toBe(1);expect(generations).toBe(3);return;
    }
    expect(result.state).toBe('completed');expect(deposits).toBe(1);expect(generations).toBe(2);
    expect((await (await pay(route,accepted,firstPayload)).json()).state).toBe('completed');expect(generations).toBe(2);
    const saved=await (await app.request('/v2/models/mandates')).json();expect(saved.mandates[0].spentAmount).toBe('2000');expect(saved.mandates[0].usedCalls).toBe(2);
    const third=await quote();expect((await app.request(`/v2/models/purchases/${third.id}/request`,post({mandateId:mandate.id}))).status).toBe(409);
  }finally{facilitator.stop(true);}
});
