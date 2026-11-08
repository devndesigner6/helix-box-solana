import {createModelDatabase,type ModelDatabase,type ModelDatabaseInput} from './model-database.ts';
import type {ChannelState,ChannelStore} from '@x402/svm/batch-settlement/server';

const locksByDatabase=new WeakMap<ModelDatabase,Map<string,Promise<void>>>();
const encode=(state:ChannelState)=>JSON.stringify(state,(_key,value)=>typeof value==='bigint'?{$bigint:value.toString()}:value);
const decode=(text:string):ChannelState=>JSON.parse(text,(_key,value)=>value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.$bigint==='string'?BigInt(value.$bigint):value);
export function createChannelStore(input:ModelDatabaseInput):ChannelStore & {list:()=>Promise<ChannelState[]>} {
  const db=createModelDatabase(input),ready=db.initialize();
  let locks=locksByDatabase.get(db);if(!locks){locks=new Map();locksByDatabase.set(db,locks);}
  const read=async(id:string)=>{await ready;return await db.query('SELECT state,revision FROM model_channels WHERE id=?').get(id) as {state:string;revision:number}|null;};
  const exclusive=async<T>(id:string,action:()=>Promise<T>):Promise<T>=>{
    const previous=locks!.get(id)??Promise.resolve();let release!:()=>void;
    const current=previous.then(()=>new Promise<void>(resolve=>{release=resolve;}));locks!.set(id,current);
    await previous;
    try{return await action();}finally{release();if(locks!.get(id)===current)locks!.delete(id);}
  };
  return {
    async get(id){const value=await read(id);return value?decode(value.state):undefined;},
    async list(){await ready;return (await db.query('SELECT state FROM model_channels').all() as {state:string}[]).map(row=>decode(row.state));},
    async put(state){
      await ready;await exclusive(state.channelId,async()=>{await db.query('INSERT INTO model_channels(id,state) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=model_channels.revision+1').run(state.channelId,encode(state));});
    },
    async update(id,updater){
      return exclusive(id,async()=>{
        const old=await read(id),next=await updater(old?decode(old.state):undefined);
        if(next.channelId!==id)throw new Error('Cannot move a payment-channel record');
        await db.transaction(async()=>{
          if(old) {
            if((await db.query('UPDATE model_channels SET state=?,revision=revision+1 WHERE id=? AND revision=?').run(encode(next),id,old.revision)).changes!==1)throw new Error('Concurrent channel writer; retry after reconciling channel state');
          }else await db.query('INSERT INTO model_channels(id,state) VALUES (?,?)').run(id,encode(next));
        });
        return next;
      });
    },
  };
}
