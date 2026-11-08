import {mkdir,lstat,realpath,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export interface ModelToolConnection {managerUrl:string;password:string}
let connection:()=>ModelToolConnection|null=()=>null;
export function configureModelTools(resolve:()=>ModelToolConnection|null){connection=resolve;}
export function modelToolConnection(){return connection();}
export async function prepareClaudeModelTools() {
  const current=connection();if(!current)return null;
  const filename=`.helixbox-mcp-${randomUUID()}.json`,file=path.join(process.cwd(),filename);
  // No credential is written to the project; Claude expands these inherited variables at launch.
  await writeFile(file,JSON.stringify({mcpServers:{helixbox:{type:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./model-mcp.js',import.meta.url))],
    env:{HELIXBOX_MODEL_MANAGER:'${HELIXBOX_MODEL_MANAGER}',HELIXBOX_MODEL_PASSWORD:'${HELIXBOX_MODEL_PASSWORD}'}}}}),{flag:'wx',mode:0o600});
  return {filename,env:{HELIXBOX_MODEL_MANAGER:current.managerUrl,HELIXBOX_MODEL_PASSWORD:current.password},cleanup:()=>unlink(file).catch(()=>{})};
}
const id=(value:unknown)=>{if(typeof value!=='string'||! /^[a-f0-9-]{36}$/.test(value))throw new Error('Invalid purchase or mandate ID');return value;};
const string=(value:unknown,max:number)=>{if(typeof value!=='string'||!value||Buffer.byteLength(value)>max)throw new Error('Invalid model tool input');return value;};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const identifier={type:'string',pattern:'^[a-f0-9-]{36}$'};
export const MODEL_TOOL_DEFINITIONS=[
  {name:'helixbox_model_catalog',description:'Discover live chat, image and speech models. Listing is free; use a quote to get a fixed USDC price.',inputSchema:schema({search:{type:'string',maxLength:100},kind:{type:'string',enum:['chat','image','voice']}})},
  {name:'helixbox_model_mandates',description:'Read this workspace user’s approved model allowlists, remaining budgets and expiry. Only active mandates can buy tools.',inputSchema:schema({})},
  {name:'helixbox_model_quote',description:'Quote a bounded model call within an active user-approved mandate. Sends only the supplied prompt to the model service. Never include secrets.',inputSchema:schema({mandateId:identifier,modelId:{type:'string',maxLength:256},kind:{type:'string',enum:['chat','image','voice']},prompt:{type:'string',maxLength:8000},maxOutputTokens:{type:'integer',minimum:1,maximum:2048},voice:{type:'string',maxLength:128}},['mandateId','modelId','kind','prompt'])},
  {name:'helixbox_model_purchase',description:'Queue an existing quote for the paired foreground phone to authorize under its mandate. No agent/server wallet key. Do not repurchase an uncertain operation; poll status.',inputSchema:schema({purchaseId:identifier,mandateId:identifier},['purchaseId','mandateId'])},
  {name:'helixbox_model_status',description:'Read the original purchase result without another payment. Completed images/audio are saved as real project artifacts. Pending means wait for the phone, not buy again.',inputSchema:schema({purchaseId:identifier},['purchaseId'])},
];
async function artifact(job:any,workspace:string) {
  const result=job.result;if(!result?.base64)return job;
  const suffix=result.kind==='image'&&result.mediaType==='image/png'?'.png':result.kind==='voice'&&result.mediaType==='audio/mpeg'?'.mp3':null;
  if(!suffix||typeof result.base64!=='string'||result.base64.length>16777216||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64))throw new Error('Invalid model artifact');
  const root=await realpath(workspace),directory=path.join(root,'.helixbox-model-results');
  await mkdir(directory,{recursive:true,mode:0o700});
  if((await lstat(directory)).isSymbolicLink()||await realpath(directory)!==directory)throw new Error('Model artifact directory cannot be a symlink');
  const file=path.join(directory,id(job.id)+suffix),bytes=Buffer.from(result.base64,'base64');
  try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    if((await lstat(file)).isSymbolicLink()||createHash('sha256').update(await readFile(file)).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Existing model artifact differs; refusing to overwrite');
  }
  const {base64,...metadata}=result;return {...job,result:{...metadata,artifactPath:file}};
}
export function createModelToolClient(resolve:()=>ModelToolConnection|null,fetcher:typeof fetch=fetch,workspace=process.cwd()) {
  async function request(route:string,body?:unknown) {
    const current=resolve();if(!current)throw new Error('Pair a HelixBox workspace first');
    const url=new URL(current.managerUrl);if(url.protocol!=='https:')throw new Error('Model tools require an HTTPS manager');
    const response=await fetcher(url.origin+'/v2/models'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${current.password}`,'Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(120000)});
    if(resolve()?.password!==current.password)throw new Error('Workspace pairing changed; discard the old result');
    const value=await response.json().catch(()=>null);if(!response.ok)throw new Error(value?.error||`Model operation failed (${response.status})`);return value;
  }
  return {async call(name:string,args:unknown):Promise<unknown> {
    if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Invalid model tool arguments');const input=args as Record<string,unknown>;
    if(!MODEL_TOOL_DEFINITIONS.some(tool=>tool.name===name))throw new Error('Unknown model tool');
    if(name==='helixbox_model_catalog') {
      if(input.kind!==undefined&&!['chat','image','voice'].includes(String(input.kind)))throw new Error('Invalid model kind');
      const search=input.search===undefined?'':string(input.search,100).toLowerCase(),catalog=await request('');
      return {paymentsEnabled:catalog.paymentsEnabled,models:catalog.models.filter((m:any)=>(!input.kind||m.kind===input.kind)&&`${m.id} ${m.name}`.toLowerCase().includes(search)).slice(0,20)};
    }
    if(name==='helixbox_model_mandates')return request('/mandates');
    if(name==='helixbox_model_quote') {
      const mandateId=id(input.mandateId),modelId=string(input.modelId,256),prompt=string(input.prompt,8000);
      const {mandates}=await request('/mandates');const mandate=mandates.find((m:any)=>m.id===mandateId&&m.state==='active'&&m.policy.expiresAt>Date.now());
      if(!mandate?.policy.models.some((m:any)=>m.id===modelId&&m.kind===input.kind))throw new Error('User has not approved this model in an active mandate');
      const quoted=await request('/quotes',{modelId,kind:input.kind,prompt,consent:true,...input.maxOutputTokens!==undefined?{maxOutputTokens:input.maxOutputTokens}:{},...input.voice!==undefined?{voice:input.voice}:{}});
      if(BigInt(quoted.terms.amount)>BigInt(mandate.policy.perCallAmount))throw new Error('Quoted price exceeds the user’s per-call cap');return quoted;
    }
    const purchaseId=id(input.purchaseId);
    if(name==='helixbox_model_purchase')return request(`/purchases/${purchaseId}/request`,{mandateId:id(input.mandateId)});
    let job=await request(`/purchases/${purchaseId}`);if(job.state==='paid')job=await request(`/purchases/${purchaseId}/resume`,{});
    return artifact(job,workspace);
  }};
}
export const modelTools=createModelToolClient(()=>connection());
