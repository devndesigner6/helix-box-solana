import { randomUUID } from 'node:crypto';
import { address } from '@solana/kit';
import type { Database } from 'bun:sqlite';
import type { ModelKind } from './model-catalog.ts';

export interface MandatePolicy {
  payer:string; authorizer:string; models:{id:string;kind:ModelKind}[];
  totalAmount:string; perCallAmount:string; maxCalls:number; expiresAt:number;
}
export interface MandateQuote {id:string;modelId:string;kind:ModelKind;amount:string;expiresAt:number}
export interface ModelMandate {
  id:string; policy:MandatePolicy; channelId:string|null; state:'pending'|'active'|'stopped';
  spentAmount:string; reservedAmount:string; usedCalls:number;
}
export interface MandateReservation {
  id:string;mandateId:string;quote:MandateQuote;cumulativeAmount:string;state:'reserved'|'signed'|'completed'|'released';
}
const amount=(value:unknown):bigint=>{
  if(typeof value!=='string'||! /^(?:[1-9]\d{0,8})$/.test(value))throw new Error('Invalid mandate amount');
  return BigInt(value);
};
export function createMandateStore(db:Database,now=Date.now) {
  db.run('PRAGMA synchronous = FULL');
  db.run(`CREATE TABLE IF NOT EXISTS model_mandates (
    id TEXT PRIMARY KEY,owner TEXT NOT NULL,policy TEXT NOT NULL,channel_id TEXT UNIQUE,state TEXT NOT NULL,created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS model_mandate_reservations (
    id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,quote_id TEXT UNIQUE,quote TEXT NOT NULL,cumulative TEXT NOT NULL,state TEXT NOT NULL
  )`);
  const row=(owner:string,id:string):any=>{
    const value=db.query('SELECT * FROM model_mandates WHERE id=? AND owner=?').get(id,owner);
    if(!value)throw new Error('Mandate not found');return value;
  };
  const entries=(id:string):MandateReservation[]=>(db.query('SELECT * FROM model_mandate_reservations WHERE mandate_id=?').all(id) as any[])
    .map(r=>({id:r.id,mandateId:r.mandate_id,quote:JSON.parse(r.quote),cumulativeAmount:r.cumulative,state:r.state}));
  const view=(value:any):ModelMandate=>{
    const all=entries(value.id);let spent=0n,held=0n,used=0;
    for(const entry of all) {
      if(entry.state==='released')continue;
      used++;
      if(entry.state==='completed')spent+=BigInt(entry.quote.amount);else held+=BigInt(entry.quote.amount);
    }
    return {id:value.id,policy:JSON.parse(value.policy),channelId:value.channel_id,state:value.state,spentAmount:String(spent),reservedAmount:String(held),usedCalls:used};
  };
  const reservation=(owner:string,id:string):MandateReservation=>{
    const value=db.query('SELECT r.* FROM model_mandate_reservations r JOIN model_mandates m ON m.id=r.mandate_id WHERE r.id=? AND m.owner=?').get(id,owner) as any;
    if(!value)throw new Error('Mandate reservation not found');
    return {id:value.id,mandateId:value.mandate_id,quote:JSON.parse(value.quote),cumulativeAmount:value.cumulative,state:value.state};
  };
  return {
    create(owner:string,policy:MandatePolicy):ModelMandate {
      if(!owner||owner.length>256)throw new Error('Invalid mandate owner');
      address(policy.payer);address(policy.authorizer);
      const total=amount(policy.totalAmount),perCall=amount(policy.perCallAmount);
      if(total>100000000n||perCall>total||!Number.isSafeInteger(policy.maxCalls)||policy.maxCalls<1||policy.maxCalls>1000||
        !Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=now()||policy.expiresAt>now()+86400000||
        !Array.isArray(policy.models)||policy.models.length<1||policy.models.length>50||
        policy.models.some(m=>!m||typeof m.id!=='string'||!m.id||m.id.length>256||!['chat','image','voice'].includes(m.kind)))throw new Error('Invalid mandate limits');
      const count=db.query("SELECT count(*) AS n FROM model_mandates WHERE owner=? AND state!='stopped'").get(owner) as {n:number};
      if(count.n>=10)throw new Error('Too many open mandates; close an existing mandate first');
      const id=randomUUID();
      db.query('INSERT INTO model_mandates VALUES (?,?,?,NULL,?,?)').run(id,owner,JSON.stringify(policy),'pending',now());
      return view(row(owner,id));
    },
    get(owner:string,id:string):ModelMandate {return view(row(owner,id));},
    list(owner:string):ModelMandate[] {return (db.query('SELECT * FROM model_mandates WHERE owner=? ORDER BY created_at DESC LIMIT 50').all(owner) as any[]).map(view);},
    // Only the verified channel-deposit handler may call this, never a client-supplied activation flag.
    activate(owner:string,id:string,channelId:string):void {
      address(channelId);
      db.transaction(()=>{
        const value=row(owner,id),policy=JSON.parse(value.policy) as MandatePolicy;
        if(value.state!=='pending'||policy.expiresAt<=now())throw new Error('Mandate cannot be activated');
        db.query("UPDATE model_mandates SET state='active',channel_id=? WHERE id=? AND owner=?").run(channelId,id,owner);
      })();
    },
    stop(owner:string,id:string):void {row(owner,id);db.query("UPDATE model_mandates SET state='stopped' WHERE id=? AND owner=?").run(id,owner);},
    reserve(owner:string,id:string,quote:MandateQuote):MandateReservation {
      return db.transaction(()=>{
        const mandate=view(row(owner,id));
        const existing=db.query('SELECT id,mandate_id FROM model_mandate_reservations WHERE quote_id=?').get(quote.id) as {id:string;mandate_id:string}|null;
        if(existing) {
          if(existing.mandate_id!==id)throw new Error('Purchase already belongs to another mandate');
          const previous=reservation(owner,existing.id);
          if(JSON.stringify(previous.quote)!==JSON.stringify(quote))throw new Error('Purchase terms changed');
          return previous;
        }
        const cost=amount(quote.amount),policy=mandate.policy;
        if(typeof quote.id!=='string'||!quote.id||quote.id.length>128||!Number.isSafeInteger(quote.expiresAt)||quote.expiresAt<=now())throw new Error('Invalid or expired quote');
        if(mandate.state!=='active'||!mandate.channelId||policy.expiresAt<=now())throw new Error('Mandate is not active');
        if(!policy.models.some(m=>m.id===quote.modelId&&m.kind===quote.kind))throw new Error('Model is outside this mandate');
        if(cost>BigInt(policy.perCallAmount)||cost+BigInt(mandate.spentAmount)+BigInt(mandate.reservedAmount)>BigInt(policy.totalAmount)||mandate.usedCalls>=policy.maxCalls)throw new Error('Mandate spending limit exceeded');
        // Sequential vouchers avoid signing conflicting cumulative watermarks while a prior result is uncertain.
        if(mandate.reservedAmount!=='0')throw new Error('Previous mandate purchase needs completion or reconciliation');
        const reservationId=randomUUID(),cumulative=String(BigInt(mandate.spentAmount)+cost);
        db.query("INSERT INTO model_mandate_reservations VALUES (?,?,?,?,?,'reserved')").run(reservationId,id,quote.id,JSON.stringify(quote),cumulative);
        return reservation(owner,reservationId);
      })();
    },
    markSigned(owner:string,id:string):void {
      const value=reservation(owner,id),mandate=view(row(owner,value.mandateId));
      if(value.state!=='reserved'||mandate.state!=='active'||mandate.policy.expiresAt<=now()||value.quote.expiresAt<=now())throw new Error('Mandate authorization is no longer valid');
      db.query("UPDATE model_mandate_reservations SET state='signed' WHERE id=? AND state='reserved'").run(id);
    },
    complete(owner:string,id:string):void {
      const value=reservation(owner,id);
      if(value.state==='completed')return;
      if(value.state!=='signed')throw new Error('Purchase has not been signed');
      db.query("UPDATE model_mandate_reservations SET state='completed' WHERE id=? AND state='signed'").run(id);
    },
    release(owner:string,id:string):void {
      const value=reservation(owner,id);
      if(value.state!=='reserved')throw new Error('Signed or completed purchase cannot be released without settlement reconciliation');
      db.query("UPDATE model_mandate_reservations SET state='released' WHERE id=? AND state='reserved'").run(id);
    },
    reservation,
  };
}
