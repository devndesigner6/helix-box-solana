import { assertIsAddress } from '@solana/kit';
import type { Network } from '@x402/core/types';

const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const USDC = {
  [MAINNET]: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  [DEVNET]: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

export const CLI_HOURLY_PRICE_USDC = '$0.25';
export const PREMIUM_WEEKLY_PRICE_USDC = '$2.00';
export const AGENT_SESSION_1HOUR_PRICE_USDC = '$0.25';
export const CODEX_AGENT_PRICE_USDC = '$0.25';
export const CLI_HOURLY_ROUTE = '/v2/x402/cli/hour';
export const PREMIUM_WEEKLY_ROUTE = '/v2/x402/premium/week';
export const AGENT_SESSION_1HOUR_ROUTE = '/v2/x402/agent-session-1hour';
export const CODEX_AGENT_ROUTE = '/v2/x402/codex-agent';

export interface X402Config {
  network: Network;
  asset: string;
  payTo: string;
  facilitatorUrl: string;
}

export function createX402Config(env: Record<string, string | undefined> = process.env): X402Config {
  const network = env.X402_NETWORK || MAINNET;
  if (network !== MAINNET && network !== DEVNET) throw new Error('X402_NETWORK must be Solana Mainnet or Devnet');
  const asset = USDC[network];
  if (env.X402_ASSET_ID && env.X402_ASSET_ID !== asset) throw new Error('X402_ASSET_ID must be native USDC for the selected network');
  const payTo = (env.X402_PAY_TO || '').trim();
  try { assertIsAddress(payTo); } catch { throw new Error('X402_PAY_TO must be a valid Solana address'); }
  let facilitator: URL;
  try { facilitator = new URL(env.X402_FACILITATOR_URL || ''); }
  catch { throw new Error('X402_FACILITATOR_URL must be an HTTPS URL'); }
  if (facilitator.protocol !== 'https:' || facilitator.username || facilitator.password) {
    throw new Error('X402_FACILITATOR_URL must be an HTTPS URL without credentials');
  }
  return { network: network as Network, asset, payTo, facilitatorUrl: facilitator.toString().replace(/\/+$/, '') };
}
