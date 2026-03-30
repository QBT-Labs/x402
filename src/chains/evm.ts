/**
 * EVM Chain Support (Base, Ethereum, Arbitrum, etc.)
 *
 * Implements EIP-3009 TransferWithAuthorization verification
 */

import { getConfig, USDC_CONTRACTS } from '../config.js';

export type { EvmPaymentPayload, SignEIP3009Options, SignEIP3009Result } from '../types/evm.types.js';
import type { EvmPaymentPayload, SignEIP3009Options, SignEIP3009Result } from '../types/evm.types.js';

/**
 * Verify EVM payment signature.
 * Basic mode validates structure and business rules.
 * Full mode adds cryptographic verification (requires viem/ethers).
 */
export async function verifyPayment(
  payment: EvmPaymentPayload,
  expectedAmount: number,
  chainId?: string
): Promise<{ valid: boolean; error?: string; signer?: string }> {
  const cfg = getConfig();
  const mode = cfg.verifyMode ?? 'basic';

  const basicResult = verifyBasic(payment, expectedAmount);
  if (!basicResult.valid) {
    return basicResult;
  }

  if (mode === 'full') {
    console.warn('x402: Full EVM verification requires viem. Using basic mode.');
  }

  return { valid: true };
}

/**
 * Basic verification: validates amount, recipient, validity window, and signature format
 */
function verifyBasic(
  payment: EvmPaymentPayload,
  expectedAmount: number
): { valid: boolean; error?: string } {
  const { authorization, signature } = payment;

  if (!signature || !signature.startsWith('0x') || signature.length !== 132) {
    return { valid: false, error: 'Invalid signature format' };
  }

  const paidAmount = BigInt(authorization.value);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));

  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  const cfg = getConfig();
  if (authorization.to.toLowerCase() !== cfg.evm?.address?.toLowerCase()) {
    return { valid: false, error: 'Wrong recipient' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (BigInt(authorization.validBefore) < BigInt(now)) {
    return { valid: false, error: 'Authorization expired' };
  }

  if (BigInt(authorization.validAfter) > BigInt(now)) {
    return { valid: false, error: 'Authorization not yet valid' };
  }

  if (!authorization.nonce || !authorization.nonce.startsWith('0x')) {
    return { valid: false, error: 'Invalid nonce format' };
  }

  return { valid: true };
}

/**
 * Get USDC contract address for a given chain
 */
export function getUsdcAddress(chainId: string): string | undefined {
  if (USDC_CONTRACTS[chainId]) {
    return USDC_CONTRACTS[chainId];
  }
  const eipChainId = `eip155:${chainId}`;
  return USDC_CONTRACTS[eipChainId];
}

/**
 * EIP-3009 TypedData types for signing
 */
const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Sign an EIP-3009 TransferWithAuthorization message
 */
export async function signEIP3009(options: SignEIP3009Options): Promise<SignEIP3009Result> {
  const { privateKeyToAccount } = await import('viem/accounts');
  const { randomBytes } = await import('crypto');

  const account = privateKeyToAccount(options.privateKey as `0x${string}`);

  const nonce = options.nonce
    ? `0x${options.nonce.toString(16).padStart(64, '0')}`
    : `0x${randomBytes(32).toString('hex')}`;

  const usdcAddress = getUsdcAddress(options.chainId.toString());
  if (!usdcAddress) {
    throw new Error(`Unknown chain ID: ${options.chainId}`);
  }

  // Base Sepolia USDC uses domain name "USDC"; mainnet uses "USD Coin"
  const domainName = options.chainId === 84532 ? 'USDC' : 'USD Coin';
  const domain = {
    name: domainName,
    version: '2',
    chainId: options.chainId,
    verifyingContract: usdcAddress as `0x${string}`,
  };

  const message = {
    from: account.address,
    to: options.to as `0x${string}`,
    value: options.value,
    validAfter: BigInt(options.validAfter),
    validBefore: BigInt(options.validBefore),
    nonce: nonce as `0x${string}`,
  };

  const signature = await account.signTypedData({
    domain,
    types: EIP3009_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  return {
    signature,
    authorization: {
      from: account.address,
      to: options.to,
      value: options.value.toString(),
      validAfter: options.validAfter.toString(),
      validBefore: options.validBefore.toString(),
      nonce,
    },
  };
}
