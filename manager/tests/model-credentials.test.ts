import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createModelCredentials} from '../src/model-credentials.ts';
test('workspace ownership survives reconstruction without saving raw credentials, with expiry and irreversible revocation',async()=>{
  const db=new Database(':memory:');let now=1000;
  const first=createModelCredentials(db,()=>now);
  await first.remember({passwordHash:'a'.repeat(64),code:'workspace',issuedAt:now,expiresAt:now+1000});
  const restored=createModelCredentials(db,()=>now);
  expect((await restored.active())[0].passwordHash).toBe('a'.repeat(64));
  expect(await restored.valid('a'.repeat(64))).toBe(true);
  now+=1001;expect(await restored.valid('a'.repeat(64))).toBe(false);
  await first.remember({passwordHash:'b'.repeat(64),code:'workspace',issuedAt:now,expiresAt:now+1000});
  await restored.revoke('b'.repeat(64));
  await expect(first.remember({passwordHash:'b'.repeat(64),code:'workspace',issuedAt:now,expiresAt:now+2000})).rejects.toThrow('revoked');
  expect(await first.valid('b'.repeat(64))).toBe(false);
  expect(await restored.active()).toHaveLength(0);
});
