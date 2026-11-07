import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';

const network = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const payTo = process.env.X402_PAY_TO || '7sbe2WLBQxJCBmPfL2xsy7WiFzjMS147R1DUK7LHwxyy';
const facilitator = process.env.X402_FACILITATOR_URL;
if (!facilitator || new URL(facilitator).protocol !== 'https:') throw new Error('Set an HTTPS X402_FACILITATOR_URL');

async function json(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Read-only check failed (${response.status})`);
  return response.json();
}
const supported = await json(`${facilitator.replace(/\/+$/, '')}/supported`);
if (!supported.kinds?.some(item => item.x402Version === 2 && item.scheme === 'exact' && item.network === network)) {
  throw new Error('Facilitator does not advertise x402 V2 exact Solana Mainnet support');
}
console.log('PASS: facilitator advertises x402 V2 exact Solana Mainnet');
const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
async function call(method, params) {
  const result = await json(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (result.error || !Object.hasOwn(result, 'result')) throw new Error('Solana RPC returned an error');
  return result.result;
}
if (await call('getGenesisHash', []) !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('RPC is not Solana Mainnet');
const accounts = await call('getTokenAccountsByOwner', [payTo, { mint }, { encoding: 'jsonParsed' }]);
const encodeAddress = getAddressEncoder();
const [associatedAccount] = await getProgramDerivedAddress({
  programAddress: address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  seeds: [encodeAddress.encode(address(payTo)), encodeAddress.encode(address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')), encodeAddress.encode(address(mint))],
});
if (!Array.isArray(accounts.value) || !accounts.value.some(({ pubkey, account }) => pubkey === associatedAccount &&
  account?.data?.parsed?.info?.mint === mint && account.data.parsed.info.owner === payTo && account.data.parsed.info.state === 'initialized')) {
  throw new Error('Receiving wallet has no initialized USDC token account. Wallet-approved setup is required before accepting payments.');
}
console.log('PASS: receiver has an initialized native USDC associated token account. No payment was sent.');
