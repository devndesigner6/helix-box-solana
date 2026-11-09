import Header from '@/components/Header';
import ModelPurchaseResult from '@/components/ModelPurchaseResult';
import ModelMandateControls from '@/components/ModelMandateControls';
import { useTheme } from '@/contexts/ThemeContext';
import { useModelTools } from '@/hooks/useModelTools';
import type { ModelKind, ToolModel } from '@/lib/model-tools';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ModelTools() {
  const {colors,fonts}=useTheme();
  const router=useRouter();
  const insets=useSafeAreaInsets();
  const tools=useModelTools();
  const [kind,setKind]=useState<ModelKind>('chat');
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<ToolModel|null>(null);
  const [prompt,setPrompt]=useState('');
  const [output,setOutput]=useState('512');
  const [voice,setVoice]=useState('');
  const [consent,setConsent]=useState(false);
  const models=useMemo(()=>tools.catalog?.models.filter(item=>item.kind===kind &&
    `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()))??[],[tools.catalog,kind,search]);
  const text={color:colors.fg.default,fontFamily:fonts.sans.regular,fontSize:14,lineHeight:21};
  const muted={...text,color:colors.fg.muted};
  const input={...text,padding:12,borderRadius:10,backgroundColor:colors.bg.raised};
  const button={padding:12,minHeight:44,borderRadius:10,backgroundColor:colors.bg.raised};
  const canQuote=!tools.busy && consent && Boolean(prompt.trim()) && tools.paired && tools.catalog?.paymentsEnabled && (selected?.kind!=='voice'||Boolean(voice));
  const changeKind=(value:ModelKind)=>{setKind(value);setSelected(null);setConsent(false);};
  return <View style={{flex:1,backgroundColor:colors.bg.base}}>
    <Header title="Model tools" colors={colors} onBack={()=>router.back()}/>
    <FlatList
      keyboardShouldPersistTaps="handled"
      data={selected?[]:models}
      keyExtractor={item=>`${item.kind}:${item.id}`}
      contentContainerStyle={{padding:16,paddingBottom:Math.max(insets.bottom,16),gap:12}}
      ListHeaderComponent={<View style={{gap:12}}>
        <Text style={{...text,fontSize:18,fontFamily:fonts.sans.semibold}}>A model for the task.</Text>
        <Text style={muted}>Connect your wallet, choose models and spending limits, then approve funding in your wallet. Your paired agent can request calls within those limits while this app is open. Workspace tools remain free.</Text>
        <Text style={muted}>Your workspace and your laptop's coding agents stay free. Buy a model call directly, or approve a capped mandate for your agents.</Text>
        <Text style={muted}>{tools.catalog?.generationStatus??'Fetching the live model catalog…'}</Text>
        {!tools.paired?<Text style={muted}>Pair your laptop to create quotes and recover purchases.</Text>:null}
        {tools.paired?<ModelMandateControls selected={selected} purchase={tools.purchase} enabled={Boolean(tools.catalog?.paymentsEnabled)} onResult={id=>void tools.open(id)}/>:null}
        {tools.catalog?.warnings.map(warning=><Text key={warning} style={muted}>{warning}</Text>)}
        <View style={{flexDirection:'row',gap:8}}>{(['chat','image','voice'] as ModelKind[]).map(value=>
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:kind===value}} onPress={()=>changeKind(value)} style={{...button,flex:1,backgroundColor:kind===value?colors.bg.elevated:colors.bg.raised}}>
            <Text style={{...text,textAlign:'center'}}>{value==='voice'?'Speech':value==='chat'?'Chat':'Image'}</Text>
          </Pressable>)}</View>
        {selected?<>
          <Pressable accessibilityRole="button" style={button} onPress={()=>setSelected(null)}><Text style={text}>Change model</Text></Pressable>
          <Text style={{...text,fontFamily:fonts.sans.semibold}}>{selected.name}</Text>
          <Text selectable style={muted}>{selected.id}</Text>
          <Text style={text}>{selected.kind==='voice'?'Text to speak':'Prompt'}</Text>
          <TextInput accessibilityLabel={selected.kind==='voice'?'Text to speak':'Model prompt'} multiline value={prompt} onChangeText={value=>{setPrompt(value);setConsent(false);}} maxLength={selected.kind==='voice'?2000:8000} style={{...input,minHeight:100,textAlignVertical:'top'}}/>
          {selected.kind==='chat'?<>
            <Text style={text}>Maximum output tokens · 1 to 2048</Text>
            <TextInput accessibilityLabel="Maximum output tokens" value={output} onChangeText={setOutput} keyboardType="number-pad" style={input}/>
          </>:null}
          {selected.kind==='voice'?<>
            <Text style={text}>Voice · from this model's live voice list</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{selected.voices.map(item=>
              <Pressable key={item} accessibilityRole="radio" accessibilityState={{checked:voice===item}} style={button} onPress={()=>setVoice(item)}><Text style={text}>{voice===item?'✓ ':''}{item}</Text></Pressable>)}</View>
            {!selected.voices.length?<Text style={muted}>This model has no verified speech voices. Calls are unavailable.</Text>:null}
          </>:null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{checked:consent}} style={button} onPress={()=>setConsent(!consent)}>
            <Text style={text}>{consent?'☑':'☐'} Share only this prompt with the model provider through our backend inference service. Do not include credentials or private files.</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!canQuote}
            style={{...button,opacity:canQuote?1:0.5}}
            onPress={()=>void tools.quote(selected,prompt,Number(output),voice)}><Text style={text}>Get fixed USDC quote · no payment yet</Text></Pressable>
        </>:<>
          <TextInput accessibilityLabel="Search live models" placeholder="Search models" placeholderTextColor={colors.fg.muted} value={search} onChangeText={setSearch} style={input}/>
          <Text style={muted}>{models.length} live entries. Availability and bounded pricing are checked before payment. Listing does not guarantee a payable call.</Text>
        </>}
        {tools.busy?<ActivityIndicator accessibilityLabel="Loading model operation" color={colors.fg.muted}/>:null}
        {tools.error?<Text accessibilityRole="alert" selectable style={text}>{tools.error}</Text>:null}
        {tools.purchase?<ModelPurchaseResult key={tools.purchase.id} purchase={tools.purchase} busy={tools.busy} onPay={()=>void tools.pay()} onResume={()=>void tools.resume()} onRefresh={()=>void tools.open(tools.purchase!.id)}/>:null}
      </View>}
      ListEmptyComponent={!selected&&!tools.busy?<Text style={muted}>{tools.catalog?'No matching models.':'The live catalog could not load. No sample models are shown.'}</Text>:null}
      renderItem={({item})=><Pressable accessibilityRole="button" style={button} onPress={()=>{setSelected(item);setVoice('');setConsent(false);}}>
        <Text style={{...text,fontFamily:fonts.sans.semibold}}>{item.name}</Text>
        <Text selectable style={muted}>{item.id}</Text>
        <Text numberOfLines={2} style={muted}>{item.description}</Text>
      </Pressable>}
      ListFooterComponent={<View style={{gap:12,paddingTop:16}}>
        <Pressable accessibilityRole="button" disabled={tools.busy} style={button} onPress={()=>void tools.reload()}><Text style={text}>Refresh catalog and purchases</Text></Pressable>
        <Text style={{...text,fontFamily:fonts.sans.semibold}}>Recent purchases</Text>
        {!tools.history.length?<Text style={muted}>No purchases found for this pairing.</Text>:tools.history.map(item=>
          <Pressable accessibilityRole="button" key={item.id} style={button} disabled={tools.busy} onPress={()=>void tools.open(item.id)}>
            <Text style={text}>{item.terms.modelId} · {item.state.replace(/_/g,' ')}</Text>
          </Pressable>)}
        <Text style={muted}>Prompts and results expire after 24 hours. Receipts are retained. Uncertain settlements are held for reconciliation, never automatically charged again.</Text>
      </View>}
    />
  </View>;
}
