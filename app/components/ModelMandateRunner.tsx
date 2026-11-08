import {useConnection} from '@/contexts/ConnectionContext';
import {modelRequest,type ModelCatalog,type ModelPurchase} from '@/lib/model-tools';
import {authorizePhoneModelCall,refreshPhoneMandate,type ModelMandate} from '@/lib/model-mandates';
import {useEffect} from 'react';
import {AppState} from 'react-native';
import {processPhoneModelQueue} from '@/lib/model-mandate-policy.mjs';

let lastError:string|null=null;
export const modelMandateRunnerError=()=>lastError;
export default function ModelMandateRunner() {
  const {sessionCode,getPairedSessions,getStoredSession}=useConnection();
  useEffect(()=>{
    let cancelled=false,busy=false,enabled:boolean|null=null;
    const current=()=>!cancelled&&AppState.currentState==='active';
    const tick=async()=>{
      if(!current()||busy)return;busy=true;
      try {
        const session=sessionCode?(await getPairedSessions()).find(s=>s.sessionCode===sessionCode):await getStoredSession();
        if(!session?.sessionCode||!current())return;
        if(enabled===null)enabled=(await modelRequest<ModelCatalog>('')).paymentsEnabled;
        if(!enabled)return;
        const pending=await modelRequest<{requests:{mandate:ModelMandate;purchase:ModelPurchase}[]}>('/mandates/pending',session.sessionPassword);
        const {mandates}=await modelRequest<{mandates:ModelMandate[]}>('/mandates',session.sessionPassword);
        for(const mandate of mandates) {
          if(!current())return;
          try{await refreshPhoneMandate(session.sessionCode,session.sessionPassword,mandate.id,current);}
          catch(error){if(!(error instanceof Error)||(!error.message.includes('does not hold')&&!error.message.includes('another workspace')))lastError=error instanceof Error?error.message:'Model purchase recovery needs retry';}
        }
        lastError=await processPhoneModelQueue(pending.requests,request=>authorizePhoneModelCall(session.sessionCode!,session.sessionPassword,request.mandate.id,request.purchase,current),current);
      }catch(error){lastError=error instanceof Error?error.message:'Model purchases are paused';}
      finally{busy=false;}
    };
    void tick();const interval=setInterval(()=>void tick(),3000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active'){enabled=null;void tick();}});
    return()=>{cancelled=true;clearInterval(interval);listener.remove();};
  },[sessionCode,getPairedSessions,getStoredSession]);
  return null;
}
