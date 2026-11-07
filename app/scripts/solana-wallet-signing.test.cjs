const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const kit = require('@solana/kit');

const network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const source = ts.transpileModule(readFileSync(resolve(__dirname, '../lib/solana-wallet.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Only the external mobile wallet is replaced; serialization and signing use Solana Kit.
function loadWallet(account, invokeMethod) {
  const client = {
    connect: async () => {},
    provider: { getSession: async () => ({ sessionScopes: { [network]: { accounts: [`${network}:${account}`] } } }) },
    invokeMethod,
  };
  const module = { exports: {} };
  runInNewContext(source, {
    exports: module.exports, process,
    require: (name) => name === '@metamask/connect-multichain'
      ? { createMultichainClient: async () => client }
      : name === 'react-native' ? { Linking: {} } : require(name),
  });
  return module.exports;
}

async function fixture() {
  const wallet = await kit.generateKeyPairSigner();
  const transaction = kit.compileTransaction(kit.setTransactionMessageLifetimeUsingBlockhash({
    blockhash: kit.blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n,
  }, kit.setTransactionMessageFeePayer(wallet.address, kit.createTransactionMessage({ version: 0 }))));
  const signed = await kit.signTransaction([wallet.keyPair], transaction);
  return { wallet, transaction, signed };
}

test('sends MetaMask the scoped sign-only request and returns its signedTransaction signature', async () => {
  const { wallet, transaction, signed } = await fixture();
  const adapter = loadWallet(wallet.address, async ({ scope, request }) => {
    assert.equal(scope, network);
    assert.equal(request.method, 'signTransaction');
    assert.equal(request.params.scope, network);
    assert.equal(request.params.account.address, wallet.address);
    assert.equal(request.params.transaction, kit.getBase64EncodedWireTransaction(transaction));
    return { signedTransaction: kit.getBase64EncodedWireTransaction(signed) };
  });
  const signer = await adapter.createSolanaPaymentSigner();
  const [signatures] = await signer.signTransactions([transaction]);
  assert.equal(signer.address, wallet.address);
  assert.deepEqual(Object.keys(signatures), [wallet.address]);
  assert.deepEqual(Buffer.from(signatures[wallet.address]), Buffer.from(signed.signatures[wallet.address]));
});

test('rejects missing or incorrectly typed signedTransaction responses', async () => {
  const { wallet, transaction } = await fixture();
  for (const response of [null, [], {}, { signedTransaction: 123 }, { transaction: 'obsolete-field' }]) {
    const signer = await loadWallet(wallet.address, async () => response).createSolanaPaymentSigner();
    await assert.rejects(signer.signTransactions([transaction]), /invalid signed transaction/);
  }
});

test('rejects a wallet response that changes the original transaction message', async () => {
  const { wallet, transaction, signed } = await fixture();
  const changed = { ...signed, messageBytes: new Uint8Array(signed.messageBytes) };
  changed.messageBytes[changed.messageBytes.length - 1] ^= 1;
  const signer = await loadWallet(wallet.address, async () => ({
    signedTransaction: kit.getBase64EncodedWireTransaction(changed),
  })).createSolanaPaymentSigner();
  await assert.rejects(signer.signTransactions([transaction]), /changed the payment transaction/);
});

test('rejects a response without the connected wallet signature', async () => {
  const { wallet, transaction } = await fixture();
  const signer = await loadWallet(wallet.address, async () => ({
    signedTransaction: kit.getBase64EncodedWireTransaction(transaction),
  })).createSolanaPaymentSigner();
  await assert.rejects(signer.signTransactions([transaction]), /did not sign the payment transaction/);
});
