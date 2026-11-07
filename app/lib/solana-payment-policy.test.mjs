import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSolanaPayment } from './solana-payment-policy.mjs';

const requirement = {
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  scheme: 'exact', asset: 'usdc', payTo: 'merchant', amount: '250000',
};
const policy = { asset: 'usdc', payTo: 'merchant', maxAmount: '250000' };

test('accepts the expected exact payment and rejects changes', () => {
  assert.equal(validateSolanaPayment(requirement, policy), true);
  for (const change of [
    { network: 'solana:other' }, { scheme: 'upto' }, { asset: 'other' },
    { payTo: 'attacker' }, { amount: '250001' }, { amount: '-1' },
    { amount: '0' }, { amount: '1.5' }, { amount: '1e3' },
  ]) assert.equal(validateSolanaPayment({ ...requirement, ...change }, policy), false);
});

test('fails closed for incomplete or malformed requirements and policy', () => {
  assert.equal(validateSolanaPayment(null, policy), false);
  assert.equal(validateSolanaPayment(requirement, null), false);
  assert.equal(validateSolanaPayment(requirement, { ...policy, payTo: '' }), false);
  assert.equal(validateSolanaPayment(requirement, { ...policy, asset: '' }), false);
  assert.equal(validateSolanaPayment(requirement, { ...policy, maxAmount: 'NaN' }), false);
  assert.equal(validateSolanaPayment({ ...requirement, amount: 250000 }, policy), false);
});
