const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {runInNewContext}=require('node:vm');
const ts=require('typescript');
const source=ts.transpileModule(readFileSync(resolve(__dirname,'../hooks/useModelTools.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
// A deterministic hook host; only React scheduling, storage and HTTP edges are replaced.
function host({catalogFails=false,pendingQuote}={}){
  const slots=[];let cursor=0;let effects=[];let contextCode='A';let output;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const hooks={
    useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},
    useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
    useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
  };
  const sessions=['A','B'].map(code=>({sessionCode:code,sessionPassword:code,gateways:[],savedAt:0}));
  const getPairedSessions=async()=>sessions,getStoredSession=async()=>sessions.find(s=>s.sessionCode===contextCode);
  const module={exports:{}};
  runInNewContext(source,{exports:module.exports,Symbol,Promise,require(name){
    if(name==='react')return hooks;
    if(name==='react-native')return{AppState:{addEventListener:()=>({remove(){}})}};
    if(name.includes('ConnectionContext'))return{useConnection:()=>({sessionCode:contextCode,getPairedSessions,getStoredSession})};
    if(name.includes('model-tools'))return{
      activeModelPurchase:{get:async code=>code==='A'?'job-A':null,set:async()=>{}},
      modelRequest:async(path,password,body)=>{
        if(path===''){if(catalogFails)throw Error('catalog offline');return{models:[]};}
        if(path==='/quotes'&&pendingQuote)return pendingQuote.promise;
        if(path==='/purchases')return{purchases:[]};
        return{id:'job-'+password,state:'completed',result:{text:'private '+password}};
      },payForModelCall:async job=>job,
    };
    throw Error(name);
  }});
  const render=()=>{cursor=0;output=module.exports.useModelTools();const pending=effects;effects=[];pending.forEach(fn=>fn());return output;};
  const flush=async()=>{for(let i=0;i<8;i++){await new Promise(r=>setImmediate(r));render();}return output;};
  render();return{render,flush,switchTo:code=>{contextCode=code;return render();}};
}
test('catalog outage cannot prevent private purchase recovery',async()=>{
  const app=host({catalogFails:true});const output=await app.flush();
  assert.equal(output.purchase?.result.text,'private A');
});
test('a new pairing with no saved purchase immediately hides the old result',async()=>{
  const app=host();assert.equal((await app.flush()).purchase?.result.text,'private A');
  assert.equal(app.switchTo('B').purchase,null);
  assert.equal((await app.flush()).purchase,null);
});
test('switching pairing during a quote discards the old asynchronous response',async()=>{
  const pendingQuote=deferred();const app=host({pendingQuote});let output=await app.flush();
  const call=output.quote({id:'real/model',kind:'chat'},'hello',100,'');
  app.switchTo('B');await app.flush();
  pendingQuote.resolve({id:'quote-A',state:'quoted',terms:{}});await call;
  output=await app.flush();assert.equal(output.purchase,null);
  assert.equal(output.paired,true);
});
