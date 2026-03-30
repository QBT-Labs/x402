/**
 * X402 HTTP Server Transport
 *
 * Middleware that wraps a request handler to add x402 payment gating.
 * Compatible with Web Standard Request/Response (Cloudflare Workers, Deno, etc).
 */

import { getToolPrice } from '../pricing.js';
import { parsePaymentHeader } from '../verify.js';
import { buildFacilitatorRequirements, verifyWithFacilitator, settleWithFacilitator } from '../facilitator.js';

export interface X402ServerOptions {
  /** Handler that processes the MCP request after payment is verified */
  handler: (request: Request) => Promise<Response>;
  /** Extract the tool name from a parsed JSON-RPC request body. Return null for non-tool requests. */
  extractToolName?: (body: unknown) => string | null;
}

/**
 * Default tool name extractor for MCP JSON-RPC requests.
 * Returns the tool name from tools/call requests, null for everything else.
 */
function defaultExtractToolName(body: unknown): string | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('method' in body)
  ) {
    return null;
  }

  const rpc = body as { method: string; params?: { name?: string } };

  if (rpc.method === 'tools/call' && rpc.params?.name) {
    return rpc.params.name;
  }

  return null;
}

/**
 * Create an x402 payment-gating middleware for an MCP server.
 *
 * Inspects incoming requests and:
 * - Passes free tools and non-tool requests straight through
 * - Returns 402 with payment requirements for paid tools without payment
 * - Verifies and settles payment for requests with X-PAYMENT header
 * - Returns 403 if payment verification fails
 */
export function withX402Server(options: X402ServerOptions): (request: Request) => Promise<Response> {
  const { handler, extractToolName = defaultExtractToolName } = options;

  return async (request: Request): Promise<Response> => {
    // Only intercept POST requests (JSON-RPC)
    if (request.method !== 'POST') {
      return handler(request);
    }

    // Clone request so we can read body without consuming it for the handler
    const cloned = request.clone();
    let body: unknown;

    try {
      body = await cloned.json();
    } catch {
      // Not valid JSON — pass through to handler
      return handler(request);
    }

    const toolName = extractToolName(body);

    // Non-tool requests pass through
    if (!toolName) {
      return handler(request);
    }

    const pricing = getToolPrice(toolName);

    // Free tools pass through
    if (pricing.tier === 'free' || pricing.price === 0) {
      return handler(request);
    }

    const paymentHeader = request.headers.get('X-PAYMENT');

    // No payment header → 402
    if (!paymentHeader) {
      const requirements = buildFacilitatorRequirements(toolName);
      return new Response(
        JSON.stringify({
          error: 'Payment Required',
          price: pricing.price,
          ...requirements,
        }),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Parse payment
    const payment = parsePaymentHeader(paymentHeader);
    if (!payment) {
      return new Response(
        JSON.stringify({ error: 'Invalid payment header format' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Verify payment via facilitator
    const verification = await verifyWithFacilitator(payment, toolName);
    if (!verification.valid) {
      return new Response(
        JSON.stringify({
          error: 'Payment verification failed',
          reason: verification.error,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Execute the request — settlement is fire-and-forget so a network
    // failure never blocks or crashes the response.
    const response = await handler(request);

    settleWithFacilitator(payment, toolName).catch(() => {});

    return response;
  };
}
