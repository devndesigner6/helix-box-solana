import {
  AccountRole,address,blockhash,appendTransactionMessageInstructions,compileTransaction,createTransactionMessage,
  getAddressEncoder,getArrayEncoder,getBase64EncodedWireTransaction,getProgramDerivedAddress,getPublicKeyFromAddress,
  getStructEncoder,getU8Encoder,getU16Encoder,getU32Encoder,getU64Encoder,pipe,setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,verifySignature,type TransactionPartialSigner,
} from '@solana/kit';
import { encodeReceiverBindingMemo,findPaymentChannelPda } from '@x402/svm';

export const MODEL_USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const MODEL_RECEIVER='7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const PROGRAM=address('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const ASSOCIATED=address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO=address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const COMPUTE=address('ComputeBudget111111111111111111111111111111');
const utf8=(value:string)=>new TextEncoder().encode(value);
const recipientEncoder=getStructEncoder([['recipient',getAddressEncoder()],['bps',getU16Encoder()]]);
const openEncoder=getStructEncoder([
  ['discriminator',getU8Encoder()],['salt',getU64Encoder()],['deposit',getU64Encoder()],['gracePeriod',getU32Encoder()],
  ['openSlot',getU64Encoder()],['recipients',getArrayEncoder(recipientEncoder)],
]);
export interface DelegatedDepositArgs {
  payer:TransactionPartialSigner;authorizer:string;receiver:string;receiverAuthorizer:string;mint:string;feePayer:string;tokenProgram:string;
  blockhash:{blockhash:string;lastValidBlockHeight:bigint};openSlot:bigint;depositAmount:bigint;firstCharge:bigint;withdrawDelay:number;memo:string;salt:bigint;
}
/** Canonical x402 2.30 / payment-channels open, with an independent client authorizer.
 * The public SDK helper couples the payer and voucher key; the program itself has separate accounts.
 * https://github.com/solana-foundation/payment-channels and x402 scheme_batch_settlement_svm.md
 */
export async function buildDelegatedDeposit(args:DelegatedDepositArgs) {
  if(args.mint!==MODEL_USDC||args.receiver!==MODEL_RECEIVER||args.tokenProgram!==TOKEN||
    args.depositAmount<10000n||args.depositAmount>100000000n||args.firstCharge<=0n||args.firstCharge>args.depositAmount||
    !Number.isSafeInteger(args.withdrawDelay)||args.withdrawDelay<900||args.withdrawDelay>86400||
    args.openSlot<0n||args.openSlot>BigInt(Number.MAX_SAFE_INTEGER)||args.salt<0n||args.salt>18446744073709551615n||
    !args.memo||utf8(args.memo).length>128)throw new Error('Invalid channel funding policy');
  const payer=args.payer.address,feePayer=address(args.feePayer),mint=address(args.mint),authorizer=address(args.authorizer);
  address(args.receiverAuthorizer);
  const channelId=await findPaymentChannelPda({payer,payee:feePayer,mint,authorizedSigner:authorizer,salt:args.salt,openSlot:args.openSlot});
  const bytes=getAddressEncoder();
  const ata=async(owner:string)=>(await getProgramDerivedAddress({programAddress:ASSOCIATED,seeds:[bytes.encode(address(owner)),bytes.encode(address(TOKEN)),bytes.encode(mint)]}))[0];
  const [eventAuthority]=await getProgramDerivedAddress({programAddress:PROGRAM,seeds:[utf8('event_authority')]});
  const account=(value:string,role:AccountRole)=>({address:address(value),role});
  const open={programAddress:PROGRAM,accounts:[
    account(payer,AccountRole.WRITABLE_SIGNER),account(feePayer,AccountRole.WRITABLE_SIGNER),account(feePayer,AccountRole.READONLY),
    account(mint,AccountRole.READONLY),account(authorizer,AccountRole.READONLY),account(channelId,AccountRole.WRITABLE),
    account(await ata(payer),AccountRole.WRITABLE),account(await ata(channelId),AccountRole.WRITABLE),account(TOKEN,AccountRole.READONLY),
    account('11111111111111111111111111111111',AccountRole.READONLY),account('SysvarRent111111111111111111111111111111111',AccountRole.READONLY),
    account(ASSOCIATED,AccountRole.READONLY),account(eventAuthority,AccountRole.READONLY),account(PROGRAM,AccountRole.READONLY),
  ],data:openEncoder.encode({discriminator:1,salt:args.salt,deposit:args.depositAmount,gracePeriod:args.withdrawDelay,openSlot:args.openSlot,recipients:[{recipient:address(args.receiver),bps:10000}]})};
  const limit=new Uint8Array(5);limit[0]=2;new DataView(limit.buffer).setUint32(1,200000,true);
  const price=new Uint8Array(9);price[0]=3;new DataView(price.buffer).setBigUint64(1,1n,true);
  const message=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayer(feePayer,m),
    m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash(args.blockhash.blockhash),lastValidBlockHeight:args.blockhash.lastValidBlockHeight},m),
    m=>appendTransactionMessageInstructions([
      {programAddress:COMPUTE,accounts:[],data:limit},{programAddress:COMPUTE,accounts:[],data:price},open,
      {programAddress:MEMO,accounts:[],data:utf8(args.memo)},{programAddress:MEMO,accounts:[],data:utf8(encodeReceiverBindingMemo(args.receiverAuthorizer))},
    ],m));
  const unsigned=compileTransaction(message);
  const [signatures]=await args.payer.signTransactions([unsigned]);
  const signature=signatures?.[payer];
  if(!signature||Object.keys(signatures).some(key=>key!==payer)||!await verifySignature(await getPublicKeyFromAddress(payer),signature,unsigned.messageBytes))throw new Error('Wallet did not sign the canonical channel deposit');
  const transaction=getBase64EncodedWireTransaction({...unsigned,signatures:{...unsigned.signatures,[payer]:signature}});
  if(transaction.length>1644)throw new Error('Channel deposit exceeds Solana transaction size');
  return {channelId,payload:{type:'deposit' as const,channelConfig:{payer,payerAuthorizer:authorizer,receiver:args.receiver,receiverAuthorizer:args.receiverAuthorizer,
    token:mint,salt:args.salt.toString(),openSlot:Number(args.openSlot),withdrawDelay:args.withdrawDelay},deposit:{amount:args.depositAmount.toString(),transaction}}};
}
