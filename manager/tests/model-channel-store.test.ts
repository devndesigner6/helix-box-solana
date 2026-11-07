import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createChannelStore} from '../src/model-channel-store.ts';
import type {ChannelState} from '@x402/svm/batch-settlement/server';
const state=()=>({channelId:'channel-1',deposit:10000n,chargedCumulativeAmount:0n,signedMaxClaimable:0n,settled:0n,payoutWatermark:0n,status:'open',reservations:{}} as ChannelState);
test('concurrent voucher updates do not lose cumulative charges and survive store reconstruction',async()=>{
  const db=new Database(':memory:');const store=createChannelStore(db);await store.put(state());
  await Promise.all(Array.from({length:20},()=>store.update('channel-1',async current=>{
    await Promise.resolve();return {...current!,chargedCumulativeAmount:current!.chargedCumulativeAmount+100n};
  })));
  const restored=createChannelStore(db);expect((await restored.get('channel-1'))?.chargedCumulativeAmount).toBe(2000n);
  expect((await restored.list())[0].deposit).toBe(10000n);
});
test('failed mutation leaves the previous voucher state intact',async()=>{
  const store=createChannelStore(new Database(':memory:'));await store.put(state());
  await expect(store.update('channel-1',()=>{throw new Error('invalid voucher');})).rejects.toThrow();
  expect((await store.get('channel-1'))?.chargedCumulativeAmount).toBe(0n);
  await store.update('channel-1',value=>({...value!,chargedCumulativeAmount:500n}));
  expect((await store.get('channel-1'))?.chargedCumulativeAmount).toBe(500n);
});
