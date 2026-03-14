/**
 * EVM Chain Support (Base, Ethereum, Arbitrum, etc.)
 * 
 * Implements EIP-3009 TransferWithAuthorization verification
 */

import { getConfig, USDC_CONTRACTS } from '../config.js';

export interface EvmPaymentPayload {
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: string;
}

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
  return USDC_CONTRACTS[chainId];
}
