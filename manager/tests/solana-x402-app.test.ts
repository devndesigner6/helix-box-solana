import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createX402App } from '../src/x402-app.ts';
import { encodePaymentSignatureHeader } from '@x402/core/http';

test('validates pairing before payment and issues a Solana USDC challenge', async () => {
  const network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  const payTo = '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
  const asset = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  let settlementSucceeds = false;
  let activations = 0;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/verify') { res.end(JSON.stringify({ isValid: true, payer: payTo })); return; }
    if (req.url === '/settle') {
      res.end(JSON.stringify(settlementSucceeds
        ? { success: true, transaction: 'test-settlement', network, payer: payTo }
        : { success: false, errorReason: 'test-settlement-failed', transaction: '', network }));
      return;
    }
    res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network,
      extra: { feePayer: '11111111111111111111111111111111' } }], extensions: [], signers: {} }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const app = createX402App({
      config: { network, asset, payTo, facilitatorUrl: `http://127.0.0.1:${address.port}` },
      sessionExists: (code) => code === 'valid-code',
      redeemSession: async (code, expiresAt) => { activations++; return { code, expiresAt }; },
    });
    const request = (code: string) => app.request('http://localhost/v2/x402/cli/hour', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
    });
    assert.equal((await request('wrong-code')).status, 400);
    const response = await request('valid-code');
    assert.equal(response.status, 402);
    const header = response.headers.get('payment-required');
    assert.ok(header);
    const challenge = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    assert.ok(challenge.accepts.some((item: { network: string; asset: string; payTo: string; amount: string }) =>
      item.network === network && item.asset === asset && item.payTo === payTo && item.amount === '250000'));
    const paymentHeader = encodePaymentSignatureHeader({ x402Version: 2, resource: challenge.resource,
      accepted: challenge.accepts[0], payload: { transaction: 'test-only-payload' } });
    const paidRequest = () => app.request('http://localhost/v2/x402/cli/hour', {
      method: 'POST', headers: { 'content-type': 'application/json', 'payment-signature': paymentHeader },
      body: JSON.stringify({ code: 'valid-code' }),
    });
    assert.ok((await paidRequest()).status >= 400);
    assert.equal(activations, 0, 'Failed settlement must not activate access');
    settlementSucceeds = true;
    assert.equal((await paidRequest()).status, 200);
    assert.equal(activations, 1, 'Successful settlement activates access');
  } finally { server.close(); }
});
