/**
 * Types and interfaces for the x402 Solana adapter.
 */

export interface SolanaPaymentPayload {
  signature: string;
  from: string;
  to: string;
  amount: string;
  mint: string;
}
