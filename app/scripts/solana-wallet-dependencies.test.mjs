import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

test('MetaMask React Native cipher peer modules resolve', () => {
  const requireFromCiphers = createRequire(import.meta.resolve('@ecies/ciphers/aes'));
  assert.ok(requireFromCiphers.resolve('@noble/ciphers/aes'));
  assert.ok(requireFromCiphers.resolve('@noble/ciphers/chacha'));
});
