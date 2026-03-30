/**
 * Solana Chain Support
 *
 * SPL Token transfer verification
 */

import { getConfig } from '../config.js';

export type { SolanaPaymentPayload } from '../types/solana.types.js';
import type { SolanaPaymentPayload } from '../types/solana.types.js';

/**
 * Verify Solana SPL token payment
 */
export async function verifyPayment(
  payment: SolanaPaymentPayload,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string }> {
  const cfg = getConfig();

  const paidAmount = BigInt(payment.amount);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));

  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  if (payment.to !== cfg.solana?.address) {
    return { valid: false, error: 'Wrong recipient' };
  }

  return { valid: true };
}
