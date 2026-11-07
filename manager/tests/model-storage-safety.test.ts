import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {persistentModelStore,assertFinancialResetSafe} from '../src/model-storage-safety.ts';
test('a filename is not proof of persistent storage; require an actual dedicated block mount',()=>{
  const mounts='36 25 8:1 / / rw - overlay overlay rw\n37 36 8:2 / /var/data rw - ext4 /dev/sdb rw\n38 36 0:1 / /tmp rw - tmpfs tmpfs rw';
  expect(persistentModelStore('/var/data/manager.db','/var/data',mounts)).toBe(true);
  for(const [file,mount] of [['manager.db','/var/data'],['/tmp/manager.db','/tmp'],['/var/data-copy/manager.db','/var/data'],['/var/data/../tmp/m.db','/var/data'],['/var/data/manager.db','']])expect(persistentModelStore(file,mount,mounts)).toBe(false);
});
test('routine manager reset must never erase a financial ledger',()=>{
  const db=new Database(':memory:');assertFinancialResetSafe(db);
  db.run('CREATE TABLE model_purchases(id TEXT,state TEXT)');
  db.run("INSERT INTO model_purchases VALUES('paid','completed')");
  expect(()=>assertFinancialResetSafe(db)).toThrow(/ledger/);
});
