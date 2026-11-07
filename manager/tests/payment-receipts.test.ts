import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createPaymentReceiptStore } from '../src/payment-receipts.ts';

test('receipts persist and retries do not extend access or change the session', () => {
  const sqlite = new DatabaseSync(':memory:');
  const store = createPaymentReceiptStore({ run: sql => sqlite.exec(sql), query: sql => sqlite.prepare(sql) });
  assert.equal(store.record('solana:tx', 'paired-code', 1000), 1000);
  assert.equal(store.record('solana:tx', 'paired-code', 9000), 1000);
  assert.throws(() => store.record('solana:tx', 'another-code', 1000));
  store.markActivated('solana:tx');
  assert.equal((sqlite.prepare('SELECT activated FROM solana_payment_receipts').get() as { activated: number }).activated, 1);
  sqlite.close();
});
