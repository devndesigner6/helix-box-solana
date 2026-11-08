import {test,expect} from 'bun:test';
import {createModelToolClient} from '../src/ai/model-tools.ts';
test('agent can discover and queue a bounded purchase, but never receives a signing key',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const client=createModelToolClient(()=>({managerUrl:'https://manager.example',password:'paired'}),async(url,init)=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith('/request'))return Response.json({purchase:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',state:'quoted'}});
    return Response.json({models:[{id:'lab/code',name:'Code',kind:'chat'}]});
  });
  const catalog=await client.call('helixbox_model_catalog',{kind:'chat'}) as any;expect(catalog.models[0].id).toBe('lab/code');
  const queued=await client.call('helixbox_model_purchase',{purchaseId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',mandateId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});
  expect(JSON.stringify(queued)).not.toContain('paired');
  expect(calls[1].url).toBe('https://manager.example/v2/models/purchases/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/request');
  expect(JSON.parse(String(calls[1].init?.body))).toEqual({mandateId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'});
});
test('malformed tool arguments and unpaired calls cannot make network requests',async()=>{
  let fetched=0;const fetcher=async()=>{fetched++;return Response.json({});};
  const client=createModelToolClient(()=>({managerUrl:'https://manager.example',password:'paired'}),fetcher);
  await expect(client.call('helixbox_model_purchase',{purchaseId:'../other',mandateId:'id'})).rejects.toThrow();
  await expect(client.call('unknown',{})).rejects.toThrow();
  await expect(createModelToolClient(()=>null,fetcher).call('helixbox_model_mandates',{})).rejects.toThrow();
  expect(fetched).toBe(0);
});
