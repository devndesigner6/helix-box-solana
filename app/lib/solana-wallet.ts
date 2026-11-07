import { createMultichainClient } from '@metamask/connect-multichain';
import { address, getBase64EncodedWireTransaction, getTransactionDecoder, type TransactionPartialSigner } from '@solana/kit';
import { Buffer } from 'buffer';
import { Linking } from 'react-native';

export const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

let clientPromise: ReturnType<typeof createMultichainClient> | undefined;

function getClient() {
  if (!clientPromise) {
    clientPromise = createMultichainClient({
      dapp: { name: 'HelixBox', url: 'https://helixboxide.xyz' },
      api: { supportedNetworks: { [SOLANA_MAINNET]: process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com' } },
      mobile: { preferredOpenLink: (url: string) => Linking.openURL(url) },
    }).catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

export async function connectSolanaWallet(): Promise<string> {
  const client = await getClient();
  await client.connect([SOLANA_MAINNET], []);
  const session = await client.provider.getSession();
  const account = session?.sessionScopes?.[SOLANA_MAINNET]?.accounts?.[0];
  const address = account?.split(':').pop();
  if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new Error('MetaMask did not return a valid Solana account');
  }
  return address;
}

export async function disconnectSolanaWallet(): Promise<void> {
  const client = await getClient();
  await client.disconnect([SOLANA_MAINNET]);
}

export async function createSolanaPaymentSigner(): Promise<TransactionPartialSigner> {
  const account = address(await connectSolanaWallet());
  const client = await getClient();
  return {
    address: account,
    async signTransactions(transactions) {
      const signatures = [];
      for (const transaction of transactions) {
        const response = await client.invokeMethod({
          scope: SOLANA_MAINNET,
          request: {
            method: 'signTransaction',
            // MetaMask requires the chain inside params as well as the outer envelope.
            // https://github.com/MetaMask/solana-wallet-standard/blob/main/src/wallet.ts
            params: { account: { address: account }, transaction: getBase64EncodedWireTransaction(transaction), scope: SOLANA_MAINNET },
          },
        });
        if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.signedTransaction !== 'string') {
          throw new Error('MetaMask returned an invalid signed transaction');
        }
        const signed = getTransactionDecoder().decode(Buffer.from(response.signedTransaction, 'base64'));
        if (!Buffer.from(signed.messageBytes).equals(Buffer.from(transaction.messageBytes))) {
          throw new Error('MetaMask changed the payment transaction');
        }
        const signature = signed.signatures[account];
        if (!signature || signature.length !== 64 || signature.every((byte) => byte === 0)) {
          throw new Error('MetaMask did not sign the payment transaction');
        }
        signatures.push({ [account]: signature });
      }
      return signatures;
    },
  };
}
