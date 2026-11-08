import {createModelDatabase,type ModelDatabaseInput} from './model-database.ts';

interface Credential {passwordHash:string;code:string;issuedAt:number;expiresAt:number}
export function createModelCredentials(input:ModelDatabaseInput,now=Date.now){
  const db=createModelDatabase(input),ready=db.initialize();
  return {
    async remember(value:Credential){
      await ready;
      if(!/^[a-f0-9]{64}$/.test(value.passwordHash)||!value.code||value.code.length>128||
        !Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now())throw new Error('Invalid workspace credential');
      const result=await db.run(`INSERT INTO model_workspace_credentials (password_hash,code,issued_at,expires_at) VALUES (?,?,?,?)
        ON CONFLICT(password_hash) DO UPDATE SET expires_at=excluded.expires_at
        WHERE model_workspace_credentials.revoked_at IS NULL AND model_workspace_credentials.code=excluded.code`,
        value.passwordHash,value.code,value.issuedAt,value.expiresAt);
      if(result.changes!==1)throw new Error('Workspace credential was revoked');
    },
    async valid(hash:string){await ready;return Boolean(await db.get('SELECT 1 FROM model_workspace_credentials WHERE password_hash=? AND revoked_at IS NULL AND expires_at>?',hash,now()));},
    async active():Promise<Credential[]>{
      await ready;
      return (await db.all('SELECT password_hash,code,issued_at,expires_at FROM model_workspace_credentials WHERE revoked_at IS NULL AND expires_at>?',now()))
        .map(row=>({passwordHash:row.password_hash,code:row.code,issuedAt:Number(row.issued_at),expiresAt:Number(row.expires_at)}));
    },
    async revoke(hash:string){await ready;await db.run('UPDATE model_workspace_credentials SET revoked_at=? WHERE password_hash=?',now(),hash);},
  };
}
