import { useTheme } from '@/contexts/ThemeContext';
import { formatUSDC, type ModelPurchase } from '@/lib/model-tools';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export default function ModelPurchaseResult({purchase,busy,onPay,onResume,onRefresh}:{
  purchase:ModelPurchase;busy:boolean;onPay:()=>void;onResume:()=>void;onRefresh:()=>void;
}) {
  const {colors,fonts}=useTheme();
  const [audioError,setAudioError]=useState('');
  const [playing,setPlaying]=useState(false);
  const sound=useRef<Audio.Sound|null>(null);
  const path=useRef<string|null>(null);
  useEffect(()=>()=>{
    void sound.current?.unloadAsync(); sound.current=null;
    if(path.current) void FileSystem.deleteAsync(path.current,{idempotent:true});
  },[purchase.id]);
  const text={color:colors.fg.default,fontFamily:fonts.sans.regular,fontSize:14,lineHeight:21};
  const button={padding:12,borderRadius:10,backgroundColor:colors.bg.raised,opacity:busy?.5:1};
  const play=async()=>{
    if(playing) { await sound.current?.stopAsync();setPlaying(false);return; }
    setAudioError('');
    try {
      if(!purchase.result?.base64 || !FileSystem.cacheDirectory) throw new Error('Audio is no longer available');
      await sound.current?.unloadAsync();
      path.current=`${FileSystem.cacheDirectory}helixbox-model-${purchase.id}.mp3`;
      await FileSystem.writeAsStringAsync(path.current,purchase.result.base64,{encoding:FileSystem.EncodingType.Base64});
      const created=await Audio.Sound.createAsync({uri:path.current},{shouldPlay:true},status=>{
        if(status.isLoaded && status.didJustFinish) setPlaying(false);
      });
      sound.current=created.sound;setPlaying(true);
    } catch(cause) {setPlaying(false);setAudioError(cause instanceof Error?cause.message:'Audio playback failed');}
  };
  return <View style={{gap:12,paddingVertical:16}}>
    <Text style={{...text,fontFamily:fonts.sans.semibold}}>Purchase · {purchase.state.replace(/_/g,' ')}</Text>
    <Text selectable style={text}>{purchase.terms.modelId}</Text>
    <Text style={text}>{formatUSDC(purchase.terms.amount)} USDC · Solana Mainnet</Text>
    {purchase.state==='quoted'?<>
      <Text style={text}>Fixed price for this bounded call, including a {purchase.terms.markupBps/100}% service margin and a 0.001 USDC minimum. Not token-by-token billing.</Text>
      <Text style={text}>Limits: {JSON.stringify(purchase.terms.limits)}</Text>
      <Text style={text}>Expires {new Date(purchase.terms.expiresAt).toLocaleTimeString()}. Wallet approval is required for this call.</Text>
      <Pressable accessibilityRole="button" disabled={busy || purchase.terms.expiresAt<=Date.now()} style={button} onPress={onPay}><Text style={text}>Approve {formatUSDC(purchase.terms.amount)} USDC in MetaMask</Text></Pressable>
    </>:null}
    {purchase.error?<Text selectable style={text}>{purchase.error}</Text>:null}
    {purchase.state==='paid'?<Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onResume}><Text style={text}>Resume paid call · no new payment</Text></Pressable>:null}
    {purchase.state!=='quoted'?<Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onRefresh}><Text style={text}>Refresh purchase status</Text></Pressable>:null}
    {purchase.transaction?<Text selectable style={{...text,fontSize:12}}>Settlement: {purchase.transaction}</Text>:null}
    {purchase.commitmentId?<Text selectable style={{...text,fontSize:12}}>x402 channel commitment: {purchase.commitmentId}. On-chain settlement is batched separately.</Text>:null}
    {purchase.result?.text?<Text selectable style={text}>{purchase.result.text}</Text>:null}
    {purchase.result?.kind==='image' && purchase.result.base64?<Image accessibilityLabel="Generated model output" source={{uri:`data:image/png;base64,${purchase.result.base64}`}} style={{width:'100%',height:280}} resizeMode="contain"/>:null}
    {purchase.result?.kind==='voice'?<Pressable accessibilityRole="button" style={button} onPress={()=>void play()}><Text style={text}>{playing?'Stop audio':'Play generated audio'}</Text></Pressable>:null}
    {audioError?<Text style={text}>{audioError}</Text>:null}
  </View>;
}
