/**
 * Client Proxy
 *
 * High-level function that combines payment-aware fetch with the
 * MCP passthrough proxy into a single, easy-to-use entry point.
 */

import { createPaymentFetch } from '../transport/payment-fetch.js';
import { createPassthroughProxy } from './passthrough.js';
import type { PaymentFetchOptions } from '../transport/payment-fetch.js';

export interface ClientProxyOptions extends PaymentFetchOptions {
  targetUrl: string;
  mode: 'stdio' | 'http';
  port?: number;
  name?: string;
  version?: string;
}

/**
 * Create a payment-aware MCP client proxy.
 *
 * Combines `createPaymentFetch` and `createPassthroughProxy` so that
 * a single call spins up a local MCP server that mirrors a remote
 * paid MCP server, automatically handling 402 payment flows.
 */
export async function createClientProxy(
  options: ClientProxyOptions,
): Promise<{ stop: () => Promise<void> }> {
  const {
    targetUrl,
    mode,
    port,
    name,
    version,
    ...paymentOptions
  } = options;

  const fetchFn = createPaymentFetch(paymentOptions);

  return createPassthroughProxy({
    targetUrl,
    fetchFn,
    mode,
    port,
    name,
    version,
  });
}
