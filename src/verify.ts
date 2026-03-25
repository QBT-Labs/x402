/**
 * Universal Payment Verification
 */

import { verifyPayment as verifyEvmPayment, type EvmPaymentPayload } from './chains/evm.js';
import { verifyPayment as verifySolanaPayment, type SolanaPaymentPayload } from './chains/solana.js';

export interface PaymentPayload {
  x402Version: number;
  payload: EvmPaymentPayload | SolanaPaymentPayload;
  accepted: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  };
  resource?: {
    url: string;
  };
}

/**
 * Parse base64-encoded payment header into structured payload
 */
export function parsePaymentHeader(header: string): PaymentPayload | null {
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    return JSON.parse(decoded) as PaymentPayload;
  } catch {
    return null;
  }
}

/**
 * Verify payment based on network type.
 * Delegates to chain-specific verification.
 */
export async function verifyPayment(
  payment: PaymentPayload,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string; details?: Record<string, unknown> }> {
  const { network } = payment.accepted;

  if (network.startsWith('eip155:')) {
    const result = await verifyEvmPayment(
      payment.payload as EvmPaymentPayload,
      expectedAmount,
      network
    );
    return {
      valid: result.valid,
      error: result.error,
      details: result.signer ? { signer: result.signer } : undefined,
    };
  }

  if (network.startsWith('solana:')) {
    return verifySolanaPayment(payment.payload as SolanaPaymentPayload, expectedAmount);
  }

  if (network.startsWith('cardano:')) {
    return { valid: false, error: 'Cardano verification not yet implemented' };
  }

  return { valid: false, error: `Unsupported network: ${network}` };
}
