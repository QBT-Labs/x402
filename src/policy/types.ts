/**
 * Policy Types
 * Configuration for spending limits and transaction rules
 */

export interface PolicyConfig {
  version: number;
  enabled: boolean;
  rules: PolicyRules;
  audit: AuditConfig;
}

export interface PolicyRules {
  /** Maximum amount per transaction */
  maxSpendPerTx?: AmountLimit;
  /** Maximum total per hour */
  maxSpendPerHour?: AmountLimit;
  /** Maximum total per day */
  maxSpendPerDay?: AmountLimit;
  /** Allowed chains (empty = all allowed) */
  allowedChains?: string[];
  /** Allowed recipient addresses (empty = all allowed) */
  allowedRecipients?: string[];
  /** Blocked recipient addresses */
  blockedRecipients?: string[];
  /** Require manual approval above this amount */
  requireApprovalAbove?: AmountLimit;
}

export interface AmountLimit {
  amount: string;
  currency: 'USDC' | 'USD';
}

export interface AuditConfig {
  enabled: boolean;
  logFile?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
}

export interface TransactionRecord {
  id: string;
  timestamp: string;
  to: string;
  amount: string;
  chainId: number;
  tool?: string;
  txHash?: string;
  status: 'pending' | 'completed' | 'failed' | 'rejected';
}

export interface SpendingData {
  [date: string]: DailySpending;
}

export interface DailySpending {
  total: string;
  currency: string;
  transactions: TransactionRecord[];
  hourly: { [hour: string]: string };
}

export const POLICY_DIR = '.x402';
export const POLICY_FILE = 'policy.json';
export const SPENDING_FILE = 'spending.json';
export const AUDIT_FILE = 'audit.log';

export const DEFAULT_POLICY: PolicyConfig = {
  version: 1,
  enabled: true,
  rules: {
    maxSpendPerTx: { amount: '10', currency: 'USDC' },
    maxSpendPerDay: { amount: '100', currency: 'USDC' },
  },
  audit: {
    enabled: true,
    logLevel: 'info',
  },
};

// USDC has 6 decimals
export const USDC_DECIMALS = 6;
