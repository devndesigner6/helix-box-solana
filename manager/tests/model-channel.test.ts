import { test, expect } from 'bun:test';
import { createKeyPairSignerFromPrivateKeyBytes, getTransactionDecoder, getBase64Encoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { buildDepositPayload,buildRefundPayload } from '@x402/svm/batch-settlement/client';
import { buildDelegatedDeposit,buildWalletChannelClose } from '../../app/lib/solana-channel.ts';

async function fixture() {
  const payer=await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1));
  const delegate=await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(2));
  return {payer,delegate,receiver:'7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy',receiverAuthorizer:'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',
    mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',feePayer:'CjNFTjvBhbJJd2B5ePPMHRLx1ELZpa8dwQgGL727eKww',tokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    blockhash:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:1000n},openSlot:123n,depositAmount:10000n,firstCharge:1000n,withdrawDelay:3600,memo:'helixbox-purchase',salt:99n};
}
test('canonical funding bytes match the pinned x402 SDK when the payer also signs vouchers',async()=>{
  const args=await fixture();const official=await buildDepositPayload(args);
  const result=await buildDelegatedDeposit({...args,authorizer:args.payer.address});
  expect(result.channelId).toBe(official.channelId);
  expect(result.payload.deposit.transaction).toBe(official.payload.deposit.transaction);
});
test('escrows funds from the wallet but binds vouchers to the separate phone authorizer',async()=>{
  const args=await fixture();const result=await buildDelegatedDeposit({...args,authorizer:args.delegate.address});
  expect(result.payload.channelConfig.payer).toBe(args.payer.address);
  expect(result.payload.channelConfig.payerAuthorizer).toBe(args.delegate.address);
  expect(result.payload.deposit.amount).toBe('10000');
  const transaction=getTransactionDecoder().decode(getBase64Encoder().encode(result.payload.deposit.transaction));
  const message=getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  expect(message.header.numSignerAccounts).toBe(2);
  expect(transaction.signatures[args.payer.address]).not.toBeNull();
  expect(transaction.signatures[args.delegate.address]).toBeUndefined();
  const open=message.instructions[2];const bytes=Buffer.from(open.data!);
  expect(bytes[0]).toBe(1);expect(bytes.readBigUInt64LE(9)).toBe(10000n);expect(bytes.readUInt32LE(17)).toBe(3600);
  expect(message.staticAccounts[open.accountIndices![4]]).toBe(args.delegate.address);
});
test('rejects unsupported asset, receiver, oversized cap and invalid grace before asking a wallet to sign',async()=>{
  const args=await fixture();let signed=false;
  const payer={address:args.payer.address,signTransactions:async()=>{signed=true;throw new Error('wallet should not open');}};
  for(const change of [{mint:'11111111111111111111111111111111'},{receiver:'11111111111111111111111111111111'},{depositAmount:100000001n},{withdrawDelay:0}]) {
    await expect(buildDelegatedDeposit({...args,payer,authorizer:args.delegate.address,...change})).rejects.toThrow();
  }
  expect(signed).toBe(false);
});
test('wallet-approved close matches the canonical SDK transaction and cannot transfer tokens',async()=>{
  const args=await fixture(),deposit=await buildDepositPayload(args);
  const official=await buildRefundPayload({payer:args.payer,feePayer:args.feePayer,channelId:deposit.channelId,channelConfig:deposit.payload.channelConfig,
    voucher:deposit.payload.voucher!,blockhash:args.blockhash,memo:'close-channel'});
  const transaction=await buildWalletChannelClose({payer:args.payer,feePayer:args.feePayer,channelId:deposit.channelId,blockhash:args.blockhash,memo:'close-channel'});
  expect(transaction).toBe(official.transaction);
  const message=getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(getBase64Encoder().encode(transaction)).messageBytes);
  expect(message.instructions).toHaveLength(2);expect([...message.instructions[0].data!]).toEqual([5]);
});

test('wallet close passes the actual pinned facilitator validator without an advertised memo',async()=>{
  const args=await fixture(),deposit=await buildDepositPayload(args);
  const {verifyRequestCloseTransaction}=await import('../node_modules/@x402/svm/dist/esm/chunk-3WM4BBCN.mjs');
  const transaction=await buildWalletChannelClose({payer:args.payer,feePayer:args.feePayer,channelId:deposit.channelId,blockhash:args.blockhash,memo:'00000000000000000000000000000001'});
  await verifyRequestCloseTransaction(transaction,{payer:args.payer.address,feePayer:args.feePayer,channelId:deposit.channelId,acceptedTransactionVersions:[0]});
  const wrong=await buildWalletChannelClose({payer:args.payer,feePayer:args.feePayer,channelId:deposit.channelId,blockhash:args.blockhash,memo:'not-a-hex-nonce'});
  await expect(verifyRequestCloseTransaction(wrong,{payer:args.payer.address,feePayer:args.feePayer,channelId:deposit.channelId,acceptedTransactionVersions:[0]})).rejects.toThrow('hexadecimal');
});
