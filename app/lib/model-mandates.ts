import * as SecureStore from 'expo-secure-store';
import sodium from 'react-native-libsodium';
import {Buffer} from 'buffer';
import {address,createSolanaRpc,getBase58Decoder} from '@solana/kit';
import {encodeVoucherMessageBytes} from '@x402/svm';
import {decodePaymentRequiredHeader,encodePaymentSignatureHeader} from '@x402/core/http';
import type {PaymentRequirements} from '@x402/core/types';
import {MODEL_MANAGER_URL,modelRequest,type ModelPurchase,type ModelKind} from './model-tools';
import {buildDelegatedDeposit,buildWalletChannelClose,MODEL_RECEIVER,MODEL_USDC} from './solana-channel';
import {createSolanaPaymentSigner,connectSolanaWallet,SOLANA_MAINNET} from './solana-wallet';
import {reserveLocalModelCall,serializeLocalModelOperation,modelRecoveryAction,type LocalModelPolicy,type LocalModelState} from './model-mandate-policy.mjs';

export interface ModelMandate {
  id:string;state:'pending'|'funding'|'active'|'stopped';channelId:string|null;spentAmount:string;reservedAmount:string;usedCalls:number;
  policy:LocalModelPolicy&{payer:string;authorizer:string;models:{id:string;kind:ModelKind}[]};
  channel?:{status:string;deposit:string;chargedAmount:string;settledAmount:string;distributedAmount:string}|null;
}
type ChannelConfig=Awaited<ReturnType<typeof buildDelegatedDeposit>>['payload']['channelConfig'];
interface LocalRecord {
  code:string;policy:ModelMandate['policy'];state:LocalModelState;channelConfig?:ChannelConfig;channelConfigId?:string;feePayer?:string;
  submission?:{accepted:PaymentRequirements;resource?:{url:string;description?:string;mimeType?:string};payload:Record<string,unknown>};
}
const prefix=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid mandate');return `helixbox.model.${id}`;};
const read=async(id:string,code:string):Promise<LocalRecord>=>{
  const raw=await SecureStore.getItemAsync(prefix(id)+'.record');if(!raw)throw new Error('This phone does not hold the mandate signing key');
  const value=JSON.parse(raw) as LocalRecord;if(value.code!==code)throw new Error('Mandate belongs to another workspace');return value;
};
const save=(id:string,record:LocalRecord)=>SecureStore.setItemAsync(prefix(id)+'.record',JSON.stringify(record),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
async function voucher(id:string,record:LocalRecord,cumulative:string,job?:ModelPurchase) {
  if(!record.channelConfig)throw new Error('Mandate channel has not been funded');
  const raw=await SecureStore.getItemAsync(prefix(id)+'.key');if(!raw)throw new Error('Mandate signing key is unavailable');
  await sodium.ready;const privateKey=Buffer.from(raw,'base64');
  try {
    if(job&&reserveLocalModelCall(record.policy,record.state,job).cumulativeAmount!==cumulative)throw new Error('Mandate budget changed');
    const message=encodeVoucherMessageBytes({channelId:record.channelConfigId!,cumulativeAmount:BigInt(cumulative),expiresAt:0n});
    return {channelId:record.channelConfigId!,expiresAt:0,maxClaimableAmount:cumulative,signature:getBase58Decoder().decode(sodium.crypto_sign_detached(message,privateKey))};
  }finally{privateKey.fill(0);}
}
async function challenge(path:string,password:string,amount:string) {
  const response=await fetch(MODEL_MANAGER_URL+'/v2/models'+path,{method:'POST',headers:{Authorization:`Bearer ${password}`,'Content-Type':'application/json'},body:'{}'});
  const header=response.headers.get('payment-required');
  if(response.status!==402||!header)throw new Error('Channel payment is not available. Refresh the purchase before trying again.');
  const required=decodePaymentRequiredHeader(header);
  const accepted=required.accepts.find(item=>item.scheme==='batch-settlement'&&item.network===SOLANA_MAINNET&&item.asset===MODEL_USDC&&item.payTo===MODEL_RECEIVER&&item.amount===amount&&
    item.extra?.voucherSigner!=='server'&&item.extra?.operator===undefined&&item.extra?.withdrawDelay===3600&&item.extra?.tokenProgram==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  if(!accepted||typeof accepted.extra?.feePayer!=='string'||typeof accepted.extra?.receiverAuthorizer!=='string')throw new Error('The payment challenge is outside HelixBox policy');
  address(accepted.extra.feePayer);address(accepted.extra.receiverAuthorizer);
  return {accepted,...required.resource?{resource:required.resource}:{}};
}
async function submit<T>(path:string,password:string,submission:NonNullable<LocalRecord['submission']>):Promise<T> {
  const response=await fetch(MODEL_MANAGER_URL+'/v2/models'+path,{method:'POST',headers:{Authorization:`Bearer ${password}`,'Content-Type':'application/json',
    'payment-signature':encodePaymentSignatureHeader({x402Version:2,...submission})},body:'{}'});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(result?.error||'Channel response is uncertain. Refresh this purchase; do not fund again.');return result as T;
}
async function finish(id:string,record:LocalRecord,job:ModelPurchase) {
  if(record.state.pending?.id===job.id&&['cancelled','unfulfilled'].includes(job.state)){
    if(record.submission?.payload.type==='deposit'){delete record.channelConfig;delete record.channelConfigId;delete record.feePayer;}
    record.state.pending=null;delete record.submission;await save(id,record);
  }
  if(record.state.pending?.id===job.id&&(['paid','running','completed','refund_due'].includes(job.state)||(job.state==='provider_uncertain'&&Boolean(job.commitmentId||job.transaction)))) {
    record.state.spentAmount=record.state.pending.cumulativeAmount;record.state.usedCalls++;record.state.pending=null;delete record.submission;await save(id,record);
  }
  return job;
}
export async function createPhoneMandate(code:string,password:string,limits:LocalModelPolicy):Promise<ModelMandate> {
  await sodium.ready;const pair=sodium.crypto_sign_keypair();
  try {
    const payer=await connectSolanaWallet(),authorizer=getBase58Decoder().decode(pair.publicKey);
    const policy={...limits,payer,authorizer,models:limits.models as ModelMandate['policy']['models']};
    if(JSON.stringify(policy).length>1400)throw new Error('Use a smaller model allowlist for secure phone storage');
    const mandate=await modelRequest<ModelMandate>('/mandates',password,{policy,consent:true});
    await SecureStore.setItemAsync(prefix(mandate.id)+'.key',Buffer.from(pair.privateKey).toString('base64'),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
    await save(mandate.id,{code,policy,state:{spentAmount:'0',usedCalls:0,stopped:false,pending:null}});return mandate;
  }finally{pair.privateKey.fill(0);}
}
export async function fundPhoneMandate(code:string,password:string,id:string,job:ModelPurchase):Promise<ModelPurchase> {
  return serializeLocalModelOperation(id,async()=>{
  const record=await read(id,code);
  if(record.state.pending)throw new Error('Refresh the pending purchase before funding again');
  record.state.pending=reserveLocalModelCall(record.policy,record.state,job);await save(id,record);
  const path=`/purchases/${job.id}/channel/${id}`;let submitted=false;
  try {
    const required=await challenge(path,password,job.terms.amount),extra=required.accepted.extra!;
    const wallet=await createSolanaPaymentSigner();if(wallet.address!==record.policy.payer)throw new Error('Use the wallet that approved this mandate');
    const rpc=createSolanaRpc(process.env.EXPO_PUBLIC_SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
    const [block,slot]=await Promise.all([rpc.getLatestBlockhash({commitment:'confirmed'}).send(),rpc.getSlot({commitment:'confirmed'}).send()]);
    await sodium.ready;const nonce=sodium.randombytes_buf(8) as Uint8Array;
    const built=await buildDelegatedDeposit({payer:wallet,authorizer:record.policy.authorizer,receiver:MODEL_RECEIVER,receiverAuthorizer:String(extra.receiverAuthorizer),mint:MODEL_USDC,
      feePayer:String(extra.feePayer),tokenProgram:String(extra.tokenProgram),blockhash:block.value,openSlot:slot,depositAmount:BigInt(record.policy.totalAmount),firstCharge:BigInt(job.terms.amount),withdrawDelay:3600,memo:job.id.replace(/-/g,''),salt:new DataView(nonce.buffer,nonce.byteOffset,8).getBigUint64(0,true)});
    record.channelConfig=built.payload.channelConfig;record.channelConfigId=built.channelId;record.feePayer=String(extra.feePayer);
    record.submission={...required,payload:{...built.payload,voucher:await voucher(id,record,record.state.pending!.cumulativeAmount,job)}};
    await save(id,record);submitted=true;
    return finish(id,record,await submit<ModelPurchase>(path,password,record.submission));
  }catch(error){if(!submitted){record.state.pending=null;delete record.submission;await save(id,record);}throw error;}
  });
}
export async function authorizePhoneModelCall(code:string,password:string,id:string,job:ModelPurchase,isCurrent:()=>boolean):Promise<ModelPurchase> {
  return serializeLocalModelOperation(id,async()=>{
  if(!isCurrent())throw new Error('Phone authorization is paused');
  const record=await read(id,code);record.state.pending=reserveLocalModelCall(record.policy,record.state,job);
  const path=`/purchases/${job.id}/channel/${id}`,required=await challenge(path,password,job.terms.amount);
  if(!record.channelConfig||required.accepted.extra?.feePayer!==record.feePayer||required.accepted.extra?.receiverAuthorizer!==record.channelConfig.receiverAuthorizer)throw new Error('The channel payment terms changed');
  if(!isCurrent())throw new Error('Phone authorization is paused');
  record.submission={...required,payload:{type:'voucher',channelConfig:record.channelConfig,voucher:await voucher(id,record,record.state.pending.cumulativeAmount,job)}};
  await save(id,record);
  if(!isCurrent()){record.state.pending=null;delete record.submission;await save(id,record);throw new Error('Phone authorization is paused');}
  return finish(id,record,await submit<ModelPurchase>(path,password,record.submission));
  });
}
export async function refreshPhoneMandate(code:string,password:string,id:string,canReplay:()=>boolean=()=>false) {
  return serializeLocalModelOperation(id,async()=>{
  const record=await read(id,code);
  if(record.state.pending){
    const path=`/purchases/${record.state.pending.id}`;
    let job=await modelRequest<ModelPurchase>(path,password);
    const action=modelRecoveryAction(record.policy,record.state,job,Boolean(record.submission),canReplay());
    // The server's atomic quoted->cancelled transition is proof it never accepted payment intent.
    if(action==='cancel')job=await modelRequest<ModelPurchase>(path+'/cancel',password,{});
    else if(action==='replay'&&canReplay())job=await submit<ModelPurchase>(path+`/channel/${id}`,password,record.submission!);
    await finish(id,record,job);
  }
  });
}
export async function stopPhoneMandate(code:string,password:string,id:string) {
  return serializeLocalModelOperation(id,async()=>{
  const record=await read(id,code);record.state.stopped=true;await save(id,record);
  return modelRequest<ModelMandate>(`/mandates/${id}/stop`,password,{});
  });
}
export async function closePhoneMandate(code:string,password:string,id:string,walletApproval=false) {
  await stopPhoneMandate(code,password,id);
  return serializeLocalModelOperation(id,async()=>{
  const record=await read(id,code);
  if(record.state.pending)throw new Error('Resolve the pending purchase before closing this channel');
  if(!record.channelConfig)throw new Error('This phone has no funded channel to close');
  const path=`/mandates/${id}/close`,required=await challenge(path,password,'1000');
  if(required.accepted.extra?.feePayer!==record.feePayer||required.accepted.extra?.receiverAuthorizer!==record.channelConfig.receiverAuthorizer)throw new Error('Channel close terms changed');
  let transaction:string|undefined;
  if(walletApproval) {
    const wallet=await createSolanaPaymentSigner();if(wallet.address!==record.policy.payer)throw new Error('Use the original funding wallet');
    const rpc=createSolanaRpc(process.env.EXPO_PUBLIC_SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');
    const block=await rpc.getLatestBlockhash({commitment:'confirmed'}).send();
    transaction=await buildWalletChannelClose({payer:wallet,feePayer:record.feePayer!,channelId:record.channelConfigId!,blockhash:block.value,memo:id.replace(/-/g,'')});
  }
  return submit<{settlement:{success:boolean;transaction:string;errorReason?:string}}>(path,password,{...required,payload:{type:'refund',channelConfig:record.channelConfig,voucher:await voucher(id,record,record.state.spentAmount),...transaction?{transaction}:{}}});
  });
}
