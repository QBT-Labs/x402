/**
 * Payment-aware fetch wrapper for x402
 *
 * Wraps the standard fetch to automatically handle HTTP 402 Payment Required
 * responses by signing and attaching payment headers.
 */

import { parsePaymentRequired, signPayment, buildPaymentPayload } from '../client.js';

export interface PaymentFetchOptions {
  privateKey: `0x${string}`;
  chainId?: number;
  onPaymentRequired?: (url: string, amount: number) => Promise<boolean>;
  onPaymentSent?: (url: string, amount: number) => void;
}

/**
 * Create a fetch-compatible function that automatically handles 402 responses.
 *
 * On a 402 response, it parses payment requirements, signs the payment,
 * and retries the request with the X-PAYMENT header attached.
 */
export function createPaymentFetch(options: PaymentFetchOptions): typeof fetch {
  const { privateKey, chainId, onPaymentRequired, onPaymentSent } = options;

  return async function paymentFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(input, init);

    if (response.status !== 402) {
      return response;
    }

    const body = (await response.json()) as {
      error?: string;
      price?: number;
      accepts?: Array<{ network: string; asset: string; payTo: string; maxAmountRequired: string }>;
    };

    const requirements = parsePaymentRequired(body);
    if (!requirements) {
      throw new Error('Failed to parse payment requirements from 402 response');
    }

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

    if (onPaymentRequired) {
      const approved = await onPaymentRequired(url, requirements.price);
      if (!approved) {
        throw new Error('Payment cancelled by user');
      }
    }

    const signedPayment = await signPayment({
      privateKey,
      to: requirements.payTo as `0x${string}`,
      amount: requirements.price,
      chainId: chainId ?? requirements.chainId,
    });

    const paymentHeader = buildPaymentPayload(signedPayment);

    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set('X-PAYMENT', paymentHeader);

    const retryResponse = await fetch(input, {
      ...init,
      headers: retryHeaders,
    });

    if (onPaymentSent) {
      onPaymentSent(url, requirements.price);
    }

    return retryResponse;
  };
}
