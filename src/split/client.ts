/**
 * Split Execution Payment Client
 *
 * Handles the two-step payment flow for split execution:
 *   1. POST to Worker's /verify-payment → get 402 with requirements
 *   2. Sign EIP-3009 using x402 client primitives → retry → get JWT
 *
 * Reuses signPayment() and buildPaymentPayload() from x402 core.
 * Wallet private key never leaves the local machine.
 */

import { signPayment, buildPaymentPayload, buildPaymentPayloadFromSignature } from '../client.js';
import { verifyJWT, clearPublicKeyCache } from './jwt.js';
import type { JWTClaims, SplitClientOptions, PaymentRequirements } from './types.js';

export interface SplitClient {
  /** Request a payment JWT from the Worker (handles 402 flow automatically). */
  requestJWT(options: { exchange: string; tool: string }): Promise<{ jwt: string }>;
  /** Verify a JWT from the Worker. */
  verifyJWT(token: string): Promise<JWTClaims>;
  /** Clear the cached JWT public key. */
  clearKeyCache(): void;
}

/**
 * Create a split execution payment client.
 *
 * @example
 * ```typescript
 * const client = createSplitClient({
 *   privateKey: process.env.WALLET_PRIVATE_KEY as `0x${string}`,
 *   workerUrl: 'https://mcp.openmm.io',
 *   testnet: true,
 * });
 *
 * const { jwt } = await client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' });
 * const claims = await client.verifyJWT(jwt);
 * ```
 */
export function createSplitClient(options: SplitClientOptions): SplitClient {
  const { privateKey, signer, workerUrl, testnet = false } = options;
  const chainId = options.chainId ?? (testnet ? 84532 : 8453);
  const publicKeyUrl = `${workerUrl}/jwt-public-key`;

  // Validate that we have either privateKey or signer
  if (!privateKey && !signer) {
    throw new Error('Either privateKey or signer must be provided');
  }

  return {
    async requestJWT({ exchange, tool }) {
      const url = `${workerUrl}/verify-payment`;
      const body = JSON.stringify({ exchange, tool });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      // Step 1: Initial request — expect 402 with payment requirements
      const initialRes = await fetch(url, { method: 'POST', headers, body });

      if (initialRes.ok) {
        const data = await initialRes.json() as { jwt?: string };
        if (data.jwt) return { jwt: data.jwt };
        throw new Error('Worker returned 200 but no JWT');
      }

      if (initialRes.status !== 402) {
        const text = await initialRes.text();
        throw new Error(`Unexpected response from Worker (${initialRes.status}): ${text}`);
      }

      // Step 2: Parse 402 requirements
      const requirementsBody = await initialRes.json() as {
        accepts?: PaymentRequirements[];
      } & PaymentRequirements;
      const accepts: PaymentRequirements[] = requirementsBody.accepts ?? [requirementsBody];
      const req = accepts[0];
      if (!req) throw new Error('No payment requirements in 402 response');

      // Step 3: Sign EIP-3009 using x402 core client OR isolated signer
      const payTo = req.payTo as `0x${string}`;
      const amount = parseInt(req.maxAmountRequired) / 1_000_000;
      const amountWei = req.maxAmountRequired;
      const reqChainId = req.extra?.chainId ?? chainId;

      let paymentHeader: string;

      if (signer) {
        // Use isolated signer (key never leaves signer process)
        const signature = await signer.sign({
          to: payTo,
          amount: amountWei,
          chainId: reqChainId,
        });
        
        // Build payment payload with signature from signer
        paymentHeader = buildPaymentPayloadFromSignature({
          signature,
          from: signer.address,
          to: payTo,
          amount: amountWei,
          chainId: reqChainId,
        });
      } else {
        // Use direct private key (legacy mode)
        const signed = await signPayment({
          privateKey: privateKey!,
          to: payTo,
          amount,
          chainId: reqChainId,
          validForSeconds: 300,
        });
        paymentHeader = buildPaymentPayload(signed);
      }

      // Step 4: Retry with X-PAYMENT header → get JWT
      const paidRes = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'X-PAYMENT': paymentHeader },
        body,
      });

      if (!paidRes.ok) {
        const text = await paidRes.text();
        throw new Error(`Payment failed (${paidRes.status}): ${text}`);
      }

      const data = await paidRes.json() as { jwt?: string };
      if (!data.jwt) throw new Error('Worker accepted payment but returned no JWT');

      return { jwt: data.jwt };
    },

    verifyJWT(token: string) {
      return verifyJWT(token, publicKeyUrl);
    },

    clearKeyCache() {
      clearPublicKeyCache();
    },
  };
}
