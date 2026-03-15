/**
 * @qbtlabs/x402
 * 
 * Multi-chain payment protocol for AI agents
 * 
 * @example
 * ```typescript
 * import { configure, setToolPrices, withX402 } from '@qbtlabs/x402';
 * 
 * // Configure payment addresses
 * configure({
 *   evm: { address: '0x...' },
 *   solana: { address: 'So...' },
 *   testnet: true,
 * });
 * 
 * // Set tool pricing
 * setToolPrices({
 *   'get_ticker': 'read',    // $0.001
 *   'place_order': 'write',  // $0.01
 * });
 * 
 * // Wrap tool handlers
 * server.tool('get_ticker', schema, withX402('get_ticker', handler));
 * ```
 */

// Config
export { configure, getConfig, isEnabled, getActiveChains, resetConfig, USDC_CONTRACTS } from './config.js';
export type { X402Config, ChainConfig } from './config.js';

// Pricing
export {
  setToolPrice,
  setToolPrices,
  getToolPrice,
  buildPaymentRequirements,
  DEFAULT_TIERS,
} from './pricing.js';
export type { PricingTier, ToolPricing } from './pricing.js';

// Verification
export { parsePaymentHeader, verifyPayment } from './verify.js';
export type { PaymentPayload } from './verify.js';

// Middleware
export { withX402, checkPayment } from './middleware/mcp.js';

// Facilitator
export {
  buildFacilitatorRequirements,
  verifyWithFacilitator,
  settleWithFacilitator,
  processPayment,
  checkFacilitatorHealth,
} from './facilitator.js';

// Client (for agents)
export { signPayment, buildPaymentPayload, parsePaymentRequired } from './client.js';

// Transport
export { createPaymentFetch } from './transport/payment-fetch.js';
export type { PaymentFetchOptions } from './transport/payment-fetch.js';
export { withX402Server } from './transport/server.js';
export type { X402ServerOptions } from './transport/server.js';

// Proxy
export { createClientProxy } from './proxy/client-proxy.js';
export type { ClientProxyOptions } from './proxy/client-proxy.js';
export { createPassthroughProxy } from './proxy/passthrough.js';
export type { PassthroughProxyOptions } from './proxy/passthrough.js';

// Chain modules (for direct access)
export * as chains from './chains/index.js';
