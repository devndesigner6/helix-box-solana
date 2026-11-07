import AsyncStorage from '@react-native-async-storage/async-storage';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { createSolanaPaymentSigner, SOLANA_MAINNET } from './solana-wallet';
import { validateSolanaPayment } from './solana-payment-policy.mjs';

export type ModelKind = 'chat' | 'image' | 'voice';
export interface ToolModel {
  id:string; name:string; kind:ModelKind; description:string; contextLength:number;
  pricing:Record<string,string>; voices:string[]; inputModalities:string[]; outputModalities:string[];
}
export interface ModelCatalog {models:ToolModel[];configured:boolean;paymentsEnabled:boolean;generationStatus:string;fetchedAt:number;warnings:string[]}
export interface ModelPurchase {
  id:string;state:string;terms:{modelId:string;kind:ModelKind;amount:string;expiresAt:number;provider:string;markupBps:number;limits:Record<string,unknown>};
  transaction:string|null;error:string|null;
  result:{kind:ModelKind;text?:string;base64?:string;mediaType?:string;generationId:string|null;providerCost:number|null}|null;
}
const MANAGER = process.env.EXPO_PUBLIC_MANAGER_URL || 'https://helixbox-manager.onrender.com';
const ASSET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAY_TO = '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
export function formatUSDC(amount:string):string {
  if (!/^\d+$/.test(amount)) return 'Unavailable';
  const value=BigInt(amount); const fraction=String(value%1000000n).padStart(6,'0').replace(/0+$/,'');
  return String(value/1000000n)+(fraction?'.'+fraction:'');
}
export async function modelRequest<T>(path:string,password?:string,body?:unknown):Promise<T> {
  const response = await fetch(`${MANAGER}/v2/models${path}`,{
    method:body===undefined?'GET':'POST',
    headers:{Accept:'application/json',...(password?{Authorization:`Bearer ${password}`} :{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(typeof data?.error==='string'?data.error:`Model service unavailable (${response.status})`);
  return data as T;
}
export async function payForModelCall(job:ModelPurchase,password:string):Promise<ModelPurchase> {
  if(!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid model purchase');
  const current=await modelRequest<ModelPurchase>(`/purchases/${job.id}`,password);
  if(current.state!=='quoted') return current;
  if(JSON.stringify(current.terms)!==JSON.stringify(job.terms)) throw new Error('The quote changed. Review a fresh quote before paying.');
  if(current.terms.expiresAt<=Date.now()) throw new Error('Quote expired. Request a new quote before paying.');
  const signer=await createSolanaPaymentSigner();
  const client=new x402Client();
  const policy={asset:ASSET,payTo:PAY_TO,maxAmount:current.terms.amount};
  client.registerPolicy((version,requirements)=>version===2?requirements.filter(item=>
    validateSolanaPayment(item,policy) && item.amount===current.terms.amount && item.extra?.memo===current.id):[]);
  client.register(SOLANA_MAINNET,new ExactSvmScheme(signer,{rpcUrl:process.env.EXPO_PUBLIC_SOLANA_RPC_URL,transactionVersions:[0]}));
  const response=await wrapFetchWithPayment(fetch,client)(`${MANAGER}/v2/models/purchases/${current.id}/pay`,{
    method:'POST',headers:{Authorization:`Bearer ${password}`,'Content-Type':'application/json'},body:'{}',
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok || result?.id!==current.id) throw new Error(result?.error || 'Payment status is uncertain. Retrieve this purchase before paying again.');
  return result as ModelPurchase;
}
export const activeModelPurchase = {
  get:(code:string)=>AsyncStorage.getItem(`helixbox:model-purchase:${code}`),
  set:(code:string,id:string)=>AsyncStorage.setItem(`helixbox:model-purchase:${code}`,id),
};
