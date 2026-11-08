import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('built MCP process negotiates, lists real tools and rejects an unpaired purchase without network access',()=>{
  const env={...process.env};delete env.HELIXBOX_MODEL_PASSWORD;
  const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test-client',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'helixbox_model_purchase',arguments:{purchaseId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',mandateId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}}}].map(value=>JSON.stringify(value)).join('\n')+'\n';
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../dist/ai/model-mcp.js',import.meta.url))],{input,env,encoding:'utf8',timeout:15000,maxBuffer:1000000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  const responses=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(responses.find(r=>r.id===1).result.protocolVersion,'2025-06-18');
  const tools=responses.find(r=>r.id===2).result.tools;
  assert.deepEqual(tools.map(t=>t.name),['helixbox_model_catalog','helixbox_model_mandates','helixbox_model_quote','helixbox_model_purchase','helixbox_model_status']);
  const denied=responses.find(r=>r.id===3).result;assert.equal(denied.isError,true);assert.match(denied.content[0].text,/Pair a HelixBox workspace/);
});
