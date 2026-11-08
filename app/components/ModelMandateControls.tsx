import {useConnection} from '@/contexts/ConnectionContext';
import {useTheme} from '@/contexts/ThemeContext';
import {modelRequest,formatUSDC,type ToolModel,type ModelPurchase} from '@/lib/model-tools';
import {createPhoneMandate,fundPhoneMandate,stopPhoneMandate,closePhoneMandate,refreshPhoneMandate,type ModelMandate} from '@/lib/model-mandates';
import {modelMandateRunnerError} from './ModelMandateRunner';
import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,Text,TextInput,View} from 'react-native';

const micros=(text:string)=>{
  if(!/^\d{1,3}(?:\.\d{1,6})?$/.test(text))throw new Error('Use a USDC amount with at most six decimal places');
  const [whole,fraction='']=text.split('.');return String(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')));
};
export default function ModelMandateControls({selected,purchase,enabled,onResult}:{selected:ToolModel|null;purchase:ModelPurchase|null;enabled:boolean;onResult:(id:string)=>void}) {
  const {colors,fonts}=useTheme(),{sessionCode,getStoredSession,getPairedSessions}=useConnection();
  const [mandates,setMandates]=useState<ModelMandate[]>([]),[allowlist,setAllowlist]=useState<ToolModel[]>([]);
  const [total,setTotal]=useState('0.10'),[perCall,setPerCall]=useState('0.02'),[calls,setCalls]=useState('5'),[minutes,setMinutes]=useState('60');
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('');
  const locked=useRef(false),epoch=useRef(0);
  const session=async()=>{
    const value=sessionCode?(await getPairedSessions()).find(s=>s.sessionCode===sessionCode):await getStoredSession();
    if(!value?.sessionCode)throw new Error('Pair a workspace first');return value;
  };
  useEffect(()=>{
    const revision=++epoch.current;setMandates([]);setError(null);
    const refresh=async()=>{
      try{const value=await session();const result=await modelRequest<{mandates:ModelMandate[]}>('/mandates',value.sessionPassword);if(epoch.current===revision)setMandates(result.mandates);}
      catch(cause){if(epoch.current===revision&&enabled)setError(cause instanceof Error?cause.message:'Mandates unavailable');}
    };
    void refresh();const timer=setInterval(()=>{if(!locked.current)void refresh();},5000);
    return()=>{epoch.current++;clearInterval(timer);};
  },[sessionCode,enabled,getPairedSessions,getStoredSession]);
  const act=async(action:(value:Awaited<ReturnType<typeof session>>)=>Promise<void>)=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError(null);setNotice('');const revision=epoch.current;
    try{const value=await session();if(epoch.current!==revision)return;await action(value);const result=await modelRequest<{mandates:ModelMandate[]}>('/mandates',value.sessionPassword);if(epoch.current===revision)setMandates(result.mandates);}
    catch(cause){if(epoch.current===revision)setError(cause instanceof Error?cause.message:'Mandate operation failed');}
    finally{locked.current=false;if(epoch.current===revision)setBusy(false);}
  };
  const text={color:colors.fg.default,fontFamily:fonts.sans.regular,fontSize:14,lineHeight:21};
  const muted={...text,color:colors.fg.muted},button={padding:12,minHeight:44,borderRadius:10,backgroundColor:colors.bg.raised};
  const field=(label:string,value:string,change:(text:string)=>void)=><View style={{gap:4}}><Text style={muted}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={next=>{change(next);setConsent(false);}} keyboardType="decimal-pad" style={{...text,...button}}/></View>;
  return <View style={{gap:12,paddingVertical:12}}>
    <Text accessibilityRole="header" style={{...text,fontFamily:fonts.sans.semibold}}>Agent spending mandate</Text>
    <Text style={muted}>Fund a capped USDC channel once for all coding tasks in this paired workspace. This phone signs purchases within your limits while HelixBox is open. This is workspace-wide, not a separate budget per agent chat.</Text>
    {!enabled?<Text style={muted}>Payments are disabled until the backend’s durable payment configuration is ready.</Text>:<>
      <Pressable accessibilityRole="button" disabled={!selected||busy||allowlist.length>=5} style={button} onPress={()=>{if(selected&&!allowlist.some(m=>m.id===selected.id&&m.kind===selected.kind))setAllowlist([...allowlist,selected]);setConsent(false);}}><Text style={text}>Add selected model to allowlist</Text></Pressable>
      {allowlist.map(model=><Pressable key={`${model.kind}:${model.id}`} accessibilityRole="button" accessibilityLabel={`Remove ${model.name} from mandate`} style={button} onPress={()=>{setAllowlist(allowlist.filter(m=>m!==model));setConsent(false);}}><Text style={text}>{model.name} · {model.kind} · remove</Text></Pressable>)}
      {!allowlist.length?<Text style={muted}>Choose a model below, then add it here. Up to five explicitly approved models.</Text>:null}
      {field('Total deposit cap (USDC)',total,setTotal)}{field('Maximum price per call (USDC)',perCall,setPerCall)}
      {field('Maximum calls',calls,setCalls)}{field('Expires after minutes (up to 1440)',minutes,setMinutes)}
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked:consent}} style={button} onPress={()=>setConsent(!consent)}><Text style={text}>{consent?'☑':'☐'} Allow my agents to send task prompts to these models and spend within these limits. Keep credentials out of prompts. Close/refund before uninstalling this app; the voucher key stays on this phone.</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy||!consent||!allowlist.length} style={{...button,opacity:consent&&allowlist.length?1:.5}} onPress={()=>void act(async value=>{
        const maxCalls=Number(calls),duration=Number(minutes);if(!Number.isInteger(maxCalls)||maxCalls<1||!Number.isInteger(duration)||duration<1||duration>1440)throw new Error('Use whole positive call and minute limits');
        await createPhoneMandate(value.sessionCode!,value.sessionPassword,{models:allowlist.map(m=>({id:m.id,kind:m.kind})),totalAmount:micros(total),perCallAmount:micros(perCall),maxCalls,expiresAt:Date.now()+duration*60000});setNotice('Limits saved. Review a model quote, then fund the first call. No deposit has been sent yet.');
      })}><Text style={text}>Approve limits · no deposit yet</Text></Pressable>
    </>}
    {busy?<ActivityIndicator accessibilityLabel="Processing mandate" color={colors.fg.muted}/>:null}
    {error||modelMandateRunnerError()?<Text accessibilityRole="alert" selectable style={text}>{error||modelMandateRunnerError()}</Text>:null}
    {notice?<Text accessibilityLiveRegion="polite" style={text}>{notice}</Text>:null}
    {mandates.map(m=><View key={m.id} style={{gap:8,paddingVertical:12}}>
      <Text style={{...text,fontFamily:fonts.sans.semibold}}>{m.state} · {formatUSDC(m.spentAmount)} / {formatUSDC(m.policy.totalAmount)} USDC · {m.usedCalls}/{m.policy.maxCalls} calls</Text>
      <Text style={muted}>{m.policy.models.map(model=>model.id).join(', ')} · expires {new Date(m.policy.expiresAt).toLocaleTimeString()}</Text>
      {m.reservedAmount!=='0'?<Text style={muted}>{formatUSDC(m.reservedAmount)} USDC held for a pending purchase. Do not fund again.</Text>:null}
      {m.channel?<Text style={muted}>Channel {m.channel.status} · settled {formatUSDC(m.channel.settledAmount)} USDC</Text>:null}
      {m.state==='pending'?<Pressable accessibilityRole="button" disabled={busy||purchase?.state!=='quoted'} style={button} onPress={()=>void act(async value=>{
        if(!purchase)throw new Error('Create a fixed model quote first');const result=await fundPhoneMandate(value.sessionCode!,value.sessionPassword,m.id,purchase);onResult(result.id);
      })}><Text style={text}>Fund {formatUSDC(m.policy.totalAmount)} USDC in MetaMask and run this quote</Text></Pressable>:null}
      {m.state!=='stopped'?<Pressable accessibilityRole="button" disabled={busy} style={button} onPress={()=>void act(async value=>{await stopPhoneMandate(value.sessionCode!,value.sessionPassword,m.id);setNotice('New purchases stopped. An already signed purchase can still finish.');})}><Text style={text}>Stop new purchases</Text></Pressable>:null}
      {m.channelId?<Pressable accessibilityRole="button" disabled={busy} style={button} onPress={()=>void act(async value=>{
        await refreshPhoneMandate(value.sessionCode!,value.sessionPassword,m.id);const result=await closePhoneMandate(value.sessionCode!,value.sessionPassword,m.id);
        setNotice(result.settlement.success?`Channel close submitted. ${result.settlement.transaction||'Refresh for the confirmed refund status.'}`:'Close not confirmed. Refresh before retrying.');
      })}><Text style={text}>Close channel and refund unspent escrow</Text></Pressable>:null}
      {m.channelId&&m.state==='stopped'?<Pressable accessibilityRole="button" disabled={busy} style={button} onPress={()=>void act(async value=>{
        const result=await closePhoneMandate(value.sessionCode!,value.sessionPassword,m.id,true);
        setNotice(result.settlement.success?'Wallet-approved close submitted. A forced close can require the one-hour grace period; refresh for the confirmed status.':'Close not confirmed. Refresh before trying again.');
      })}><Text style={text}>Retry close with wallet approval</Text></Pressable>:null}
    </View>)}
  </View>;
}
