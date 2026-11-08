import {SQL} from 'bun';
import {Database} from 'bun:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';

const databases=new WeakMap<Database,ModelDatabase>();
type QueryResult=any[] & {changes:number};
/** Only the model ledger uses Postgres; the existing workspace database stays unchanged. */
export class ModelDatabase {
  readonly postgres:boolean;
  private context=new AsyncLocalStorage<{client:SQL|null;active:boolean}>();
  private tail:Promise<unknown>=Promise.resolve();
  private initialized:Promise<void>|undefined;
  constructor(private source:Database|SQL){this.postgres=!(source instanceof Database);}
  private async exclusive<T>(action:()=>Promise<T>):Promise<T>{
    const previous=this.tail;let release!:()=>void;
    this.tail=new Promise<void>(r=>{release=r;});await previous;
    try{return await action();}finally{release();}
  }
  private async execute(sql:string,params:any[]):Promise<QueryResult>{
    const current=this.context.getStore();
    if(current&&!current.active)throw new Error('Financial transaction already ended');
    if(this.postgres){
      let index=0;
      // Statements are static application SQL; all caller values stay bound parameters.
      const query=sql.replace(/'(?:''|[^'])*'|\?/g,part=>part==='?'?`$${++index}`:part);
      const result=await (current?.client??this.source as SQL).unsafe(query,params);
      return Object.assign(result,{changes:result.count});
    }
    const run=async()=>{
      const stmt=(this.source as Database).query(sql);
      if(/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql))return Object.assign(stmt.all(...params),{changes:0});
      const result=stmt.run(...params);return Object.assign([],{changes:result.changes});
    };
    return current?run():this.exclusive(run);
  }
  query(sql:string){return {
    all:(...params:any[])=>this.execute(sql,params),
    get:async(...params:any[])=>((await this.execute(sql,params))[0]??null) as any,
    run:(...params:any[])=>this.execute(sql,params),
  };}
  all(sql:string,...params:any[]){return this.query(sql).all(...params);}
  get(sql:string,...params:any[]){return this.query(sql).get(...params);}
  run(sql:string,...params:any[]){return this.query(sql).run(...params);}
  async transaction<T>(action:()=>Promise<T>):Promise<T>{
    const current=this.context.getStore();
    if(current){if(!current.active)throw new Error('Financial transaction already ended');return action();}
    if(this.postgres)return (this.source as SQL).begin(async client=>{
      // Short ledger mutations serialize across processes, including PgBouncer transaction pooling.
      await client`SELECT pg_advisory_xact_lock(402071108)`;
      const context={client,active:true};
      try{return await this.context.run(context,action);}finally{context.active=false;}
    });
    return this.exclusive(async()=>{
      const db=this.source as Database;db.run('BEGIN IMMEDIATE');
      const context={client:null,active:true};
      try{const value=await this.context.run(context,action);db.run('COMMIT');return value;}
      catch(error){db.run('ROLLBACK');throw error;}finally{context.active=false;}
    });
  }
  initialize():Promise<void>{
    return this.initialized??=(async()=>{
      if(!this.postgres)await this.run('PRAGMA synchronous=FULL');
      await this.transaction(async()=>{
      await this.run(`CREATE TABLE IF NOT EXISTS model_purchases (
        id TEXT PRIMARY KEY,owner TEXT NOT NULL,terms TEXT NOT NULL,input TEXT,state TEXT NOT NULL,
        created_at BIGINT NOT NULL,fingerprint TEXT UNIQUE,payment_id TEXT UNIQUE,result TEXT,error TEXT,channel_id TEXT,fulfill_first INTEGER NOT NULL DEFAULT 0)`);
      if(this.postgres){
        await this.run('ALTER TABLE model_purchases ADD COLUMN IF NOT EXISTS channel_id TEXT');
        await this.run('ALTER TABLE model_purchases ADD COLUMN IF NOT EXISTS fulfill_first INTEGER NOT NULL DEFAULT 0');
      }else{
        const columns=await this.all('PRAGMA table_info(model_purchases)');
        if(!columns.some(row=>row.name==='channel_id'))await this.run('ALTER TABLE model_purchases ADD COLUMN channel_id TEXT');
        if(!columns.some(row=>row.name==='fulfill_first'))await this.run('ALTER TABLE model_purchases ADD COLUMN fulfill_first INTEGER NOT NULL DEFAULT 0');
      }
      await this.run('CREATE INDEX IF NOT EXISTS model_purchase_owner ON model_purchases(owner,created_at)');
      await this.run(`CREATE TABLE IF NOT EXISTS model_mandates (
        id TEXT PRIMARY KEY,owner TEXT NOT NULL,policy TEXT NOT NULL,channel_id TEXT UNIQUE,state TEXT NOT NULL,created_at BIGINT NOT NULL)`);
      await this.run(`CREATE TABLE IF NOT EXISTS model_mandate_reservations (
        id TEXT PRIMARY KEY,mandate_id TEXT NOT NULL,quote_id TEXT UNIQUE,quote TEXT NOT NULL,cumulative TEXT NOT NULL,state TEXT NOT NULL)`);
      await this.run('CREATE TABLE IF NOT EXISTS model_channels (id TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0)');
      await this.run('CREATE TABLE IF NOT EXISTS model_storage_metadata (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
      await this.run(`CREATE TABLE IF NOT EXISTS model_workspace_credentials (
        password_hash TEXT PRIMARY KEY,code TEXT NOT NULL,issued_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,revoked_at BIGINT)`);
      // An insert/delete transaction tests the role's real write permission, not just URL syntax.
      const id=crypto.randomUUID();
      await this.run('INSERT INTO model_workspace_credentials VALUES (?,?,?,?,NULL)',id,'storage-probe',Date.now(),Date.now());
      await this.run('DELETE FROM model_workspace_credentials WHERE password_hash=?',id);
      });
    })();
  }
  async close(){if(this.postgres)await (this.source as SQL).close();}
}
export type ModelDatabaseInput=Database|ModelDatabase;
export function createModelDatabase(source:ModelDatabaseInput):ModelDatabase{
  if(source instanceof ModelDatabase)return source;
  let db=databases.get(source);if(!db){db=new ModelDatabase(source);databases.set(source,db);}return db;
}
export function connectModelPostgres(url:string):ModelDatabase{
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname||!parsed.username||!parsed.password)throw new Error('Invalid model database configuration');
  // Verify the server certificate even if an incorrectly copied URL requests weaker TLS.
  return new ModelDatabase(new SQL(url,{max:5,connectionTimeout:20,idleTimeout:30,tls:{rejectUnauthorized:true}}));
}
export async function migrateModelSQLite(source:Database,target:ModelDatabase):Promise<void>{
  await target.initialize();
  await target.transaction(async()=>{
    for(const table of ['model_purchases','model_mandates','model_mandate_reservations','model_channels']){
      if(!source.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      const count=source.query(`SELECT count(*) AS n FROM ${table}`).get() as {n:number};
      if(count.n>10000)throw new Error('Legacy model ledger needs a paginated migration before enabling payments');
      const rows=source.query(`SELECT * FROM ${table}`).all() as Record<string,unknown>[];
      for(const row of rows){
        const columns=Object.keys(row);
        if(columns.some(column=>! /^[a-z_]+$/.test(column)))throw new Error('Unexpected model schema');
        await target.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO NOTHING`,...Object.values(row));
      }
    }
  });
}
export async function assertModelDataKey(db:ModelDatabase,secret:string):Promise<void>{
  if(secret.length<32)throw new Error('MODEL_DATA_KEY must contain at least 32 characters');
  await db.initialize();
  await db.transaction(async()=>{
    const fingerprint=createHash('sha256').update('helixbox-model-key-check-v1\0').update(secret).digest('hex');
    await db.run("INSERT INTO model_storage_metadata(id,value) VALUES ('data-key',?) ON CONFLICT(id) DO NOTHING",fingerprint);
    const stored=await db.get("SELECT value FROM model_storage_metadata WHERE id='data-key'");
    if(stored?.value!==fingerprint)throw new Error('MODEL_DATA_KEY changed. Restore the original key before using model payments.');
  });
}
