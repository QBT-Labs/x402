/**
 * Universal Payment Verification
 */

import { verifyPayment as verifyEvmPayment, type EvmPaymentPayload } from './chains/evm.js';
import { verifyPayment as verifySolanaPayment, type SolanaPaymentPayload } from './chains/solana.js';
import { verifyCardanoPayment, type CardanoPaymentPayload } from './chains/cardano.js';
import { getConfig } from './config.js';

export interface PaymentPayload {
  x402Version: number;
  payload: EvmPaymentPayload | SolanaPaymentPayload | CardanoPaymentPayload;
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
    const result = await verifySolanaPayment(
      payment.payload as SolanaPaymentPayload,
      expectedAmount,
    );
    return {
      valid: result.valid,
      error: result.error,
      details: result.txSignature ? { txSignature: result.txSignature } : undefined,
    };
  }

  if (network.startsWith('cardano:')) {
    const cfg = getConfig();
    const result = await verifyCardanoPayment(
      payment.payload as CardanoPaymentPayload,
      cfg.cardano?.address ?? '',
      BigInt(Math.ceil(expectedAmount * 1_000_000)),
      'ADA',
    );
    return { valid: result.valid, error: result.error };
  }

  return { valid: false, error: `Unsupported network: ${network}` };
}
