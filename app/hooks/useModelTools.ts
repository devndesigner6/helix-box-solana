import { useConnection, type StoredSession } from '@/contexts/ConnectionContext';
import { activeModelPurchase, modelRequest, payForModelCall, type ModelCatalog, type ModelPurchase, type ToolModel } from '@/lib/model-tools';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

interface PrivateState {key:string;purchase:ModelPurchase|null;history:ModelPurchase[];paired:boolean;error:string|null;busy:boolean}
interface OwnerScope {key:string;revision:number;session:StoredSession}
const empty=(key:string):PrivateState=>({key,purchase:null,history:[],paired:false,error:null,busy:false});

export function useModelTools() {
  const {sessionCode,getStoredSession,getPairedSessions}=useConnection();
  const key=sessionCode??'@latest';
  const keyRef=useRef(key);keyRef.current=key;
  const revision=useRef(0);
  const session=useRef<OwnerScope|null>(null);
  const locked=useRef<symbol|null>(null);
  const [privateState,setPrivate]=useState<PrivateState>(()=>empty(key));
  const [catalog,setCatalog]=useState<ModelCatalog|null>(null);
  const [catalogError,setCatalogError]=useState<string|null>(null);
  const [catalogBusy,setCatalogBusy]=useState(false);
  const isCurrent=useCallback((scope:Pick<OwnerScope,'key'|'revision'>)=>scope.key===keyRef.current&&scope.revision===revision.current,[]);
  const update=useCallback((scope:Pick<OwnerScope,'key'|'revision'>,patch:Partial<PrivateState>)=>{
    if(isCurrent(scope))setPrivate(previous=>previous.key===scope.key?{...previous,...patch}:{...empty(scope.key),...patch});
  },[isCurrent]);
  const recover=useCallback(async(scope:OwnerScope)=>{
    const id=await activeModelPurchase.get(scope.session.sessionCode??'legacy');
    const [purchase,history]=await Promise.all([
      id?modelRequest<ModelPurchase>(`/purchases/${id}`,scope.session.sessionPassword):Promise.resolve(null),
      modelRequest<{purchases:ModelPurchase[]}>('/purchases',scope.session.sessionPassword),
    ]);
    update(scope,{purchase,history:history.purchases});
  },[update]);
  const refreshCatalog=useCallback(async()=>{
    setCatalogBusy(true);
    try {setCatalog(await modelRequest<ModelCatalog>(''));setCatalogError(null);}
    catch(cause){setCatalogError(cause instanceof Error?cause.message:'Live catalog unavailable');}
    finally{setCatalogBusy(false);}
  },[]);
  // Pairing identity changes never wait behind a wallet operation or catalog request.
  useEffect(()=>{
    const ticket={key,revision:++revision.current};
    session.current=null;locked.current=null;setPrivate(empty(key));
    void (async()=>{
      try {
        const stored=sessionCode?(await getPairedSessions()).find(item=>item.sessionCode===sessionCode)??null:await getStoredSession();
        if(!isCurrent(ticket)||!stored)return;
        const scope={...ticket,session:stored};session.current=scope;
        update(scope,{paired:true});await recover(scope);
      }catch(cause){update(ticket,{error:cause instanceof Error?cause.message:'Purchase recovery failed'});}
    })();
    return()=>{revision.current++;session.current=null;};
  },[key,sessionCode,getPairedSessions,getStoredSession,isCurrent,recover,update]);
  useEffect(()=>{void refreshCatalog();},[refreshCatalog]);
  const reload=useCallback(async()=>{
    const scope=session.current;
    await Promise.all([refreshCatalog(),scope?recover(scope).catch(cause=>update(scope,{error:cause instanceof Error?cause.message:'Purchase recovery failed'})):Promise.resolve()]);
  },[refreshCatalog,recover,update]);
  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void reload();});
    return()=>listener.remove();
  },[reload]);
  const act=async(action:(scope:OwnerScope)=>Promise<void>)=>{
    const scope=session.current;
    if(!scope||!isCurrent(scope)||locked.current)return;
    const token=Symbol();locked.current=token;update(scope,{busy:true,error:null});
    try{await action(scope);}
    catch(cause){update(scope,{error:cause instanceof Error?cause.message:'Model operation failed'});}
    finally{if(locked.current===token){locked.current=null;update(scope,{busy:false});}}
  };
  const current=privateState.key===key?privateState:empty(key);
  const quote=(model:ToolModel,prompt:string,maxOutputTokens:number,voice:string)=>act(async scope=>{
    const job=await modelRequest<ModelPurchase>('/quotes',scope.session.sessionPassword,{modelId:model.id,kind:model.kind,prompt,consent:true,
      ...(model.kind==='chat'?{maxOutputTokens}:{}),...(model.kind==='voice'?{voice}:{})});
    if(!isCurrent(scope))return;
    await activeModelPurchase.set(scope.session.sessionCode??'legacy',job.id);
    update(scope,{purchase:job});await recover(scope);
  });
  const pay=()=>act(async scope=>{
    if(!current.purchase)return;
    update(scope,{purchase:await payForModelCall(current.purchase,scope.session.sessionPassword)});await recover(scope);
  });
  const open=(id:string)=>act(async scope=>{
    const job=await modelRequest<ModelPurchase>(`/purchases/${id}`,scope.session.sessionPassword);
    if(!isCurrent(scope))return;
    await activeModelPurchase.set(scope.session.sessionCode??'legacy',id);update(scope,{purchase:job});
  });
  const resume=()=>act(async scope=>{
    if(!current.purchase)return;
    update(scope,{purchase:await modelRequest<ModelPurchase>(`/purchases/${current.purchase.id}/resume`,scope.session.sessionPassword,{})});await recover(scope);
  });
  return{catalog,purchase:current.purchase,history:current.history,paired:current.paired,error:current.error??catalogError,busy:current.busy||catalogBusy,reload,quote,pay,open,resume};
}
