import assert from 'node:assert/strict';
import test from 'node:test';
import { createX402Config } from '../src/x402-payment.ts';

const recipient = '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const asset = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const env = { X402_NETWORK: network, X402_PAY_TO: recipient, X402_FACILITATOR_URL: 'https://facilitator.example' };

test('configures Solana Mainnet and native USDC', () => {
  assert.deepEqual(createX402Config(env), { network, asset, payTo: recipient, facilitatorUrl: env.X402_FACILITATOR_URL });
});
test('rejects wrong network, asset, recipient and insecure facilitator', () => {
  for (const changed of [
    { X402_NETWORK: 'eip155:1' }, { X402_ASSET_ID: 'wrong-mint' },
    { X402_PAY_TO: 'PLACEHOLDER' }, { X402_PAY_TO: '' },
    { X402_FACILITATOR_URL: 'http://example.com' }, { X402_FACILITATOR_URL: '' },
  ]) assert.throws(() => createX402Config({ ...env, ...changed }));
});
