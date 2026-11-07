import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceCredential } from '../src/assemble-session.ts';

test('free workspace credentials reuse the existing secret and expire with pairing, not paid access', () => {
  const session = { password: 'paired-secret', expiresAt: 10000, paidUntil: 1000 };
  assert.deepEqual(workspaceCredential(session, () => { throw new Error('must not rotate'); }, 2000), {
    password: 'paired-secret', expiresAt: 10000,
  });
});

test('new free workspaces get credentials without a payment and expired codes cannot renew', () => {
  assert.deepEqual(workspaceCredential({ password: null, expiresAt: 10000 }, () => 'new-secret', 2000), {
    password: 'new-secret', expiresAt: 10000,
  });
  assert.equal(workspaceCredential({ password: 'old', expiresAt: 2000 }, () => 'new', 2000), null);
});
