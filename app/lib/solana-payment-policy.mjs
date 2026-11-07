const MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export function validateSolanaPayment(requirement, policy) {
  if (!requirement || !policy || requirement.network !== MAINNET || requirement.scheme !== 'exact' ||
      typeof policy.asset !== 'string' || !policy.asset || requirement.asset !== policy.asset ||
      typeof policy.payTo !== 'string' || !policy.payTo || requirement.payTo !== policy.payTo ||
      typeof requirement.amount !== 'string' || !/^[1-9]\d*$/.test(requirement.amount) ||
      typeof policy.maxAmount !== 'string' || !/^[1-9]\d*$/.test(policy.maxAmount)) return false;
  return BigInt(requirement.amount) <= BigInt(policy.maxAmount);
}
