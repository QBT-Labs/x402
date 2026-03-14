/**
 * Solana Chain Support
 * 
 * SPL Token transfer verification
 */

import { getConfig } from '../config.js';

export interface SolanaPaymentPayload {
  signature: string;
  from: string;
  to: string;
  amount: string;
  mint: string;
}

/**
 * Verify Solana payment
 */
export async function verifyPayment(
  payment: SolanaPaymentPayload,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string }> {
  const cfg = getConfig();

  // Check amount
  const paidAmount = BigInt(payment.amount);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));

  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  // Check recipient
  if (payment.to !== cfg.solana?.address) {
    return { valid: false, error: 'Wrong recipient' };
  }

  // TODO: Verify transaction signature on-chain
  // This requires @solana/web3.js which we keep as optional

  return { valid: true };
}
