/**
 * Split Execution Module
 *
 * Utilities for the split execution flow where payment verification
 * happens on a remote Worker and tool execution happens locally.
 *
 * @example
 * ```typescript
 * import { createSplitClient, wrapWithSplitPayment } from '@qbtlabs/x402/split';
 * ```
 */

// Client
export { createSplitClient } from './client.js';
export type { SplitClient } from './client.js';

// JWT
export { verifyJWT, fetchPublicKey, clearPublicKeyCache } from './jwt.js';

// Gate
export { wrapWithSplitPayment } from './gate.js';

// Types
export type {
  JWTClaims,
  SplitClientOptions,
  SplitPaymentGateOptions,
  PaymentRequirements,
} from './types.js';
