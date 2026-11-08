import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createModelDatabase,migrateModelSQLite,assertModelDataKey} from '../src/model-database.ts';

test('financial transactions roll back across stores and serialize competing writers',async()=>{
  const raw=new Database(':memory:'),db=createModelDatabase(raw);
  await db.run('CREATE TABLE balances (id TEXT PRIMARY KEY, amount INTEGER NOT NULL)');
  await db.run('INSERT INTO balances VALUES (?,?)','wallet',10);
  await expect(db.transaction(async()=>{
    await db.run('UPDATE balances SET amount=0 WHERE id=?','wallet');
    await db.transaction(async()=>{throw new Error('interrupted receipt');});
  })).rejects.toThrow('interrupted receipt');
  expect((await db.get('SELECT amount FROM balances WHERE id=?','wallet'))?.amount).toBe(10);
  await Promise.all(Array.from({length:10},()=>db.transaction(async()=>{
    const row=await db.get('SELECT amount FROM balances WHERE id=?','wallet');
    await Promise.resolve();
    await db.run('UPDATE balances SET amount=? WHERE id=?',row!.amount-1,'wallet');
  })));
  expect((await db.get('SELECT amount FROM balances WHERE id=?','wallet'))?.amount).toBe(0);
});

test('queries outside a transaction cannot accidentally join a transaction that later rolls back',async()=>{
  const raw=new Database(':memory:'),db=createModelDatabase(raw);
  await db.run('CREATE TABLE ledger (id TEXT PRIMARY KEY)');
  let entered!:()=>void,release!:()=>void;
  const start=new Promise<void>(r=>{entered=r;}),wait=new Promise<void>(r=>{release=r;});
  const failed=db.transaction(async()=>{await db.run('INSERT INTO ledger VALUES (?)','rolled-back');entered();await wait;throw new Error('rollback');});
  await start;
  const independent=db.run('INSERT INTO ledger VALUES (?)','committed');
  release();await expect(failed).rejects.toThrow('rollback');await independent;
  expect((await db.all('SELECT id FROM ledger')).map(r=>r.id)).toEqual(['committed']);
});

test('switching durable storage preserves legacy receipts without overwriting newer channel state',async()=>{
  const source=new Database(':memory:'),old=createModelDatabase(source),target=createModelDatabase(new Database(':memory:'));
  await old.initialize();await target.initialize();
  await old.run('INSERT INTO model_channels(id,state) VALUES (?,?)','old-channel','old');
  await migrateModelSQLite(source,target);
  expect((await target.get('SELECT state FROM model_channels WHERE id=?','old-channel')).state).toBe('old');
  await target.run('UPDATE model_channels SET state=? WHERE id=?','newer','old-channel');
  await migrateModelSQLite(source,target);
  expect((await target.get('SELECT state FROM model_channels WHERE id=?','old-channel')).state).toBe('newer');
});
test('a deployment cannot silently change the key that encrypts results and authorizes channel closes',async()=>{
  const db=createModelDatabase(new Database(':memory:'));await db.initialize();
  await assertModelDataKey(db,'a'.repeat(32));await assertModelDataKey(db,'a'.repeat(32));
  await expect(assertModelDataKey(db,'b'.repeat(32))).rejects.toThrow('MODEL_DATA_KEY');
  expect(JSON.stringify(await db.all('SELECT * FROM model_storage_metadata'))).not.toContain('a'.repeat(32));
});
