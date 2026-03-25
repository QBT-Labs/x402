/**
 * x402 Policy Module
 * Spending limits and transaction rules
 */

// Engine
export { PolicyEngine, createPolicyEngine } from './engine.js';

// Spending tracker
export { SpendingTracker, formatUSDC, parseUSDC } from './spending.js';

// Audit logger
export { AuditLogger } from './audit.js';
export type { AuditLevel, AuditEvent, AuditEntry } from './audit.js';

// Types
export type {
  PolicyConfig,
  PolicyRules,
  PolicyCheckResult,
  TransactionRecord,
  AmountLimit,
  AuditConfig,
  SpendingData,
  DailySpending,
} from './types.js';

export { DEFAULT_POLICY, POLICY_DIR, POLICY_FILE, USDC_DECIMALS } from './types.js';
