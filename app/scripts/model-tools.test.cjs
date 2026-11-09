const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(resolve(__dirname, '../lib/model-tools.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load({ current, result = current, challenge, fetcher, timer = setTimeout } = {}) {
  let walletOpened = 0, paid = 0;
  const module = { exports: {} };
  runInNewContext(source, {
    exports: module.exports, process, Date, AbortController, setTimeout: timer, clearTimeout,
    fetch: fetcher || (async () => Response.json(current)),
    require: name => {
      if (name === '@react-native-async-storage/async-storage') return { default: {} };
      if (name === './solana-wallet') return { SOLANA_MAINNET: 'solana:test', createSolanaPaymentSigner: async () => { walletOpened++; return {}; } };
      if (name === './solana-payment-policy.mjs') return { validateSolanaPayment: () => true };
      if (name === '@x402/svm/exact/client') return { ExactSvmScheme: class {} };
      if (name === '@x402/fetch') return {
        x402Client: class { registerPolicy(fn) { this.policy = fn; } register() {} },
        wrapFetchWithPayment: (_, client) => async () => {
          if (challenge) assert.equal(client.policy(2, [challenge]).length, 0, 'another quote must never be authorized');
          paid++; return Response.json(result);
        },
      };
      throw new Error(name);
    },
  });
  return { ...module.exports, counts: () => ({walletOpened, paid}) };
}
test('a stalled model request times out without retrying the operation', async () => {
  let requests = 0;
  const api = load({ timer: fn => setTimeout(fn, 0), fetcher: (_, options) => {
    requests++;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }});
  await assert.rejects(api.modelRequest('/mandates', 'paired', {}), /timed out.*status/i);
  assert.equal(requests, 1);
});
const job = {id:'12345678-1234-1234-1234-123456789abc',state:'quoted',terms:{amount:'1000',expiresAt:Date.now()+60000},result:null};
test('formats USDC micros without floats or fabricated prices', () => {
  const api = load();
  assert.equal(api.formatUSDC('1000'), '0.001');
  assert.equal(api.formatUSDC('250000'), '0.25');
  assert.equal(api.formatUSDC('invalid'), 'Unavailable');
});
test('wallet-return retrieval never repays a running or completed purchase', async () => {
  for (const state of ['running','completed','settlement_uncertain','provider_uncertain','refund_due']) {
    const api = load({current:{...job,state}});
    assert.equal((await api.payForModelCall(job,'paired')).state, state);
    assert.deepEqual(api.counts(), {walletOpened:0,paid:0});
  }
});
test('authorizes only the exact displayed amount and purchase identity', async () => {
  const api = load({current:job,challenge:{amount:'2000',extra:{memo:job.id}}});
  await api.payForModelCall(job,'paired');
  const wrong = load({current:job,challenge:{amount:'1000',extra:{memo:'different'}}});
  await wrong.payForModelCall(job,'paired');
});
test('a changed quote must be reviewed again before opening the wallet', async () => {
  const api = load({current:{...job,terms:{...job.terms,amount:'9000'}}});
  await assert.rejects(api.payForModelCall(job,'paired'), /changed/i);
  assert.deepEqual(api.counts(), {walletOpened:0,paid:0});
});
