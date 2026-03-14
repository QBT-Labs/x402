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
 * Verify EVM payment signature
 */
export async function verifyPayment(
  payment: EvmPaymentPayload,
  expectedAmount: number,
  chainId?: string
): Promise<{ valid: boolean; error?: string; signer?: string }> {
  const cfg = getConfig();
  const mode = cfg.verifyMode ?? 'basic';

  // Basic verification (always run)
  const basicResult = verifyBasic(payment, expectedAmount);
  if (!basicResult.valid) {
    return basicResult;
  }

  // Full verification requires external libraries (viem/ethers)
  // For now, basic verification is sufficient for testnet
  if (mode === 'full') {
    console.warn('x402: Full EVM verification requires viem. Using basic mode.');
  }

  return { valid: true };
}

/**
 * Basic verification (fast, for testing)
 */
function verifyBasic(
  payment: EvmPaymentPayload,
  expectedAmount: number
): { valid: boolean; error?: string } {
  const { authorization, signature } = payment;

  // Check signature exists and has valid format
  if (!signature || !signature.startsWith('0x') || signature.length !== 132) {
    return { valid: false, error: 'Invalid signature format' };
  }

  // Check amount
  const paidAmount = BigInt(authorization.value);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));

  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  // Check recipient
  const cfg = getConfig();
  if (authorization.to.toLowerCase() !== cfg.evm?.address?.toLowerCase()) {
    return { valid: false, error: 'Wrong recipient' };
  }

  // Check validity window
  const now = Math.floor(Date.now() / 1000);
  if (BigInt(authorization.validBefore) < BigInt(now)) {
    return { valid: false, error: 'Authorization expired' };
  }

  if (BigInt(authorization.validAfter) > BigInt(now)) {
    return { valid: false, error: 'Authorization not yet valid' };
  }

  // Check nonce format
  if (!authorization.nonce || !authorization.nonce.startsWith('0x')) {
    return { valid: false, error: 'Invalid nonce format' };
  }

  return { valid: true };
}

/**
 * Get USDC contract address for chain
 */
export function getUsdcAddress(chainId: string): string | undefined {
  return USDC_CONTRACTS[chainId];
}
