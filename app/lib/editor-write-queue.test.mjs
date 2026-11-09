import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueEditorWrite } from './editor-write-queue.mjs';

test('writes for one file finish in order and failures do not block later saves', async () => {
  const queue = {}, saved = [];
  let release;
  const first = enqueueEditorWrite(queue, 'file', async () => { await new Promise(resolve => { release = resolve; }); saved.push('old'); });
  await Promise.resolve();
  const second = enqueueEditorWrite(queue, 'file', async () => { saved.push('new'); });
  assert.deepEqual(saved, []);
  release(); await Promise.all([first, second]);
  assert.deepEqual(saved, ['old', 'new']);
  await assert.rejects(enqueueEditorWrite(queue, 'file', async () => { throw new Error('offline'); }));
  await enqueueEditorWrite(queue, 'file', async () => { saved.push('retry'); });
  assert.equal(saved.at(-1), 'retry');
  assert.deepEqual(queue, {});
});
