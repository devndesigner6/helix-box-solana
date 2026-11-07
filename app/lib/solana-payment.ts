import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { createSolanaPaymentSigner, SOLANA_MAINNET } from './solana-wallet';
import { validateSolanaPayment } from './solana-payment-policy.mjs';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { saveWalletStatus } from './wallet-status';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAY_TO = '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const MANAGER_URL = process.env.EXPO_PUBLIC_MANAGER_URL || 'https://helixbox-manager.onrender.com';

export async function payForAgentSession(code: string, plan: 'hour' | 'week'): Promise<void> {
  if (!code.trim()) throw new Error('CLI pairing code is missing');
  const signer = await createSolanaPaymentSigner();
  const client = new x402Client();
  const policy = { asset: USDC, payTo: PAY_TO, maxAmount: plan === 'hour' ? '250000' : '2000000' };
  client.registerPolicy((version, requirements) => version === 2
    ? requirements.filter((requirement) => validateSolanaPayment(requirement, policy))
    : []);
  client.register(SOLANA_MAINNET, new ExactSvmScheme(signer, {
    rpcUrl: process.env.EXPO_PUBLIC_SOLANA_RPC_URL,
    transactionVersions: [0],
  }));
  const route = plan === 'hour' ? '/v2/x402/cli/hour' : '/v2/x402/premium/week';
  const response = await wrapFetchWithPayment(fetch, client)(`${MANAGER_URL}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Payment failed (${response.status})`);
  }
  const header = response.headers.get('payment-response');
  if (!header) throw new Error('Settlement receipt is missing. Check session status before paying again.');
  const receipt = decodePaymentResponseHeader(header);
  if (!receipt.success || receipt.network !== SOLANA_MAINNET || !receipt.transaction) {
    throw new Error('Payment settlement could not be confirmed. Check session status before paying again.');
  }
  await saveWalletStatus({ address: signer.address, network: 'Mainnet' });
}
