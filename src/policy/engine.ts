/**
 * Policy Engine
 * Enforces spending rules before signing transactions
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type {
  PolicyConfig,
  PolicyRules,
  PolicyCheckResult,
  TransactionRecord,
  AmountLimit,
} from './types.js';
import { POLICY_DIR, POLICY_FILE, DEFAULT_POLICY, USDC_DECIMALS } from './types.js';
import { SpendingTracker, parseUSDC, formatUSDC } from './spending.js';
import { AuditLogger } from './audit.js';

export class PolicyEngine {
  private filePath: string;
  private config: PolicyConfig;
  private spending: SpendingTracker;
  private audit: AuditLogger;

  constructor(filePath?: string) {
    const baseDir = join(homedir(), POLICY_DIR);
    this.filePath = filePath || join(baseDir, POLICY_FILE);

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.config = this.load();
    
    // Use same directory as policy file for spending and audit
    const spendingPath = join(dirname(this.filePath), 'spending.json');
    const auditPath = join(dirname(this.filePath), 'audit.log');
    
    this.spending = new SpendingTracker(spendingPath);
    this.audit = new AuditLogger(this.config.audit, auditPath);
  }

  /**
   * Load policy config from file
   */
  private load(): PolicyConfig {
    if (!existsSync(this.filePath)) {
      // Create default policy (deep copy to avoid mutating the constant)
      this.config = JSON.parse(JSON.stringify(DEFAULT_POLICY));
      this.save();
      return this.config;
    }
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      // Return a deep copy to avoid mutating the constant
      return JSON.parse(JSON.stringify(DEFAULT_POLICY));
    }
  }

  /**
   * Save policy config to file
   */
  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Check if a transaction is allowed by policy
   */
  async check(tx: {
    to: string;
    amount: string;
    chainId: number;
    tool?: string;
  }): Promise<PolicyCheckResult> {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const rules = this.config.rules;
    const amount = BigInt(tx.amount);

    // 1. Check per-transaction limit
    if (rules.maxSpendPerTx) {
      const max = this.parseLimit(rules.maxSpendPerTx);
      if (amount > max) {
        const reason = `Amount ${formatUSDC(amount)} exceeds max per tx ${formatUSDC(max)}`;
        this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
        return { allowed: false, reason };
      }
    }

    // 2. Check hourly limit
    if (rules.maxSpendPerHour) {
      const hourlyTotal = this.spending.getHourlyTotal();
      const max = this.parseLimit(rules.maxSpendPerHour);
      if (hourlyTotal + amount > max) {
        const reason = `Would exceed hourly limit of ${formatUSDC(max)} (current: ${formatUSDC(hourlyTotal)})`;
        this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
        return { allowed: false, reason };
      }
    }

    // 3. Check daily limit
    if (rules.maxSpendPerDay) {
      const dailyTotal = this.spending.getDailyTotal();
      const max = this.parseLimit(rules.maxSpendPerDay);
      if (dailyTotal + amount > max) {
        const reason = `Would exceed daily limit of ${formatUSDC(max)} (current: ${formatUSDC(dailyTotal)})`;
        this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
        return { allowed: false, reason };
      }
    }

    // 4. Check chain allowed
    if (rules.allowedChains && rules.allowedChains.length > 0) {
      const chainStr = tx.chainId.toString();
      const chainName = getChainName(tx.chainId);
      const normalizedAllowed = rules.allowedChains.map((c) => c.toLowerCase());
      
      if (!normalizedAllowed.includes(chainStr) && !normalizedAllowed.includes(chainName.toLowerCase())) {
        const reason = `Chain ${tx.chainId} not in allowed list`;
        this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
        return { allowed: false, reason };
      }
    }

    // 5. Check blocked recipients
    if (rules.blockedRecipients?.includes(tx.to.toLowerCase())) {
      const reason = `Recipient ${tx.to} is blocked`;
      this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
      return { allowed: false, reason };
    }

    // 6. Check allowed recipients (if list is not empty, must be in it)
    if (rules.allowedRecipients && rules.allowedRecipients.length > 0) {
      const allowed = rules.allowedRecipients.map((a) => a.toLowerCase());
      if (!allowed.includes(tx.to.toLowerCase())) {
        const reason = `Recipient ${tx.to} not in allowed list`;
        this.audit.txRejected({ to: tx.to, amount: tx.amount, reason });
        return { allowed: false, reason };
      }
    }

    // 7. Check if approval needed
    if (rules.requireApprovalAbove) {
      const threshold = this.parseLimit(rules.requireApprovalAbove);
      if (amount > threshold) {
        return {
          allowed: true,
          requiresApproval: true,
        };
      }
    }

    // All checks passed
    this.audit.txAllowed({
      to: tx.to,
      amount: tx.amount,
      chainId: tx.chainId,
      tool: tx.tool,
    });

    return { allowed: true };
  }

  /**
   * Record a completed transaction
   */
  recordTransaction(tx: TransactionRecord): void {
    this.spending.record(tx);
  }

  /**
   * Get current policy config
   */
  getConfig(): PolicyConfig {
    return this.config;
  }

  /**
   * Get current rules
   */
  getRules(): PolicyRules {
    return this.config.rules;
  }

  /**
   * Update a rule
   */
  setRule<K extends keyof PolicyRules>(key: K, value: PolicyRules[K]): void {
    const oldValue = this.config.rules[key];
    this.config.rules[key] = value;
    this.save();
    this.audit.policyChange({ rule: key, oldValue, newValue: value });
  }

  /**
   * Enable/disable policy
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.save();
  }

  /**
   * Get spending summary
   */
  getSpendingSummary(): {
    today: ReturnType<SpendingTracker['getTodaySummary']>;
    weekly: ReturnType<SpendingTracker['getWeeklySummary']>;
  } {
    return {
      today: this.spending.getTodaySummary(),
      weekly: this.spending.getWeeklySummary(),
    };
  }

  /**
   * Get recent transactions
   */
  getRecentTransactions(limit?: number): TransactionRecord[] {
    return this.spending.getRecentTransactions(limit);
  }

  /**
   * Get audit log
   */
  getAuditLog(limit?: number): string[] {
    return this.audit.getRecent(limit);
  }

  /**
   * Export audit log to CSV
   */
  exportAuditCSV(): string {
    return this.audit.exportCSV();
  }

  /**
   * Reset spending counters (for testing)
   */
  resetSpending(): void {
    this.spending.reset();
  }

  /**
   * Parse amount limit to bigint
   */
  private parseLimit(limit: AmountLimit): bigint {
    return parseUSDC(limit.amount);
  }
}

/**
 * Get chain name from chain ID
 */
function getChainName(chainId: number): string {
  const chains: Record<number, string> = {
    1: 'ethereum',
    8453: 'base',
    84532: 'base-sepolia',
    42161: 'arbitrum',
    10: 'optimism',
    137: 'polygon',
  };
  return chains[chainId] || chainId.toString();
}

/**
 * Create a policy engine instance
 */
export function createPolicyEngine(filePath?: string): PolicyEngine {
  return new PolicyEngine(filePath);
}
