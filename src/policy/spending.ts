/**
 * Spending Tracker
 * Tracks daily and hourly spending for policy enforcement
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { SpendingData, DailySpending, TransactionRecord } from './types.js';
import { POLICY_DIR, SPENDING_FILE, USDC_DECIMALS } from './types.js';

export class SpendingTracker {
  private filePath: string;
  private data: SpendingData;

  constructor(filePath?: string) {
    const baseDir = join(homedir(), POLICY_DIR);
    this.filePath = filePath || join(baseDir, SPENDING_FILE);

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    this.data = this.load();
  }

  /**
   * Get today's date key
   */
  private getDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get current hour key
   */
  private getHourKey(): string {
    return new Date().getHours().toString().padStart(2, '0');
  }

  /**
   * Load spending data from file
   */
  private load(): SpendingData {
    if (!existsSync(this.filePath)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return {};
    }
  }

  /**
   * Save spending data to file
   */
  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Get or create today's spending record
   */
  private getToday(): DailySpending {
    const dateKey = this.getDateKey();
    if (!this.data[dateKey]) {
      this.data[dateKey] = {
        total: '0',
        currency: 'USDC',
        transactions: [],
        hourly: {},
      };
    }
    return this.data[dateKey];
  }

  /**
   * Get daily total in USDC (wei-like units)
   */
  getDailyTotal(): bigint {
    const today = this.getToday();
    return BigInt(today.total);
  }

  /**
   * Get hourly total for current hour
   */
  getHourlyTotal(): bigint {
    const today = this.getToday();
    const hourKey = this.getHourKey();
    return BigInt(today.hourly[hourKey] || '0');
  }

  /**
   * Record a transaction
   */
  record(tx: TransactionRecord): void {
    const today = this.getToday();
    const hourKey = this.getHourKey();

    // Add to transactions list
    today.transactions.push(tx);

    // Update totals
    const amount = BigInt(tx.amount);
    today.total = (BigInt(today.total) + amount).toString();
    today.hourly[hourKey] = (BigInt(today.hourly[hourKey] || '0') + amount).toString();

    this.save();
  }

  /**
   * Get spending summary for today
   */
  getTodaySummary(): {
    total: string;
    transactions: number;
    hourly: { [hour: string]: string };
  } {
    const today = this.getToday();
    return {
      total: formatUSDC(BigInt(today.total)),
      transactions: today.transactions.length,
      hourly: Object.fromEntries(
        Object.entries(today.hourly).map(([h, v]) => [h, formatUSDC(BigInt(v))])
      ),
    };
  }

  /**
   * Get weekly spending summary
   */
  getWeeklySummary(): { date: string; total: string; transactions: number }[] {
    const result: { date: string; total: string; transactions: number }[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];

      const dayData = this.data[dateKey];
      result.push({
        date: dateKey,
        total: dayData ? formatUSDC(BigInt(dayData.total)) : '$0.00',
        transactions: dayData ? dayData.transactions.length : 0,
      });
    }

    return result;
  }

  /**
   * Get recent transactions
   */
  getRecentTransactions(limit = 10): TransactionRecord[] {
    const today = this.getToday();
    return today.transactions.slice(-limit).reverse();
  }

  /**
   * Reset spending data (dangerous - for testing)
   */
  reset(): void {
    this.data = {};
    this.save();
  }
}

/**
 * Format USDC amount (6 decimals) to dollar string
 */
export function formatUSDC(amount: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const dollars = amount / divisor;
  const cents = (amount % divisor).toString().padStart(USDC_DECIMALS, '0').slice(0, 2);
  return `$${dollars}.${cents}`;
}

/**
 * Parse USDC amount from string (e.g., "10" USDC -> 10000000)
 */
export function parseUSDC(amount: string): bigint {
  const parts = amount.split('.');
  const whole = BigInt(parts[0]) * BigInt(10 ** USDC_DECIMALS);
  if (parts.length === 1) {
    return whole;
  }
  const decimals = parts[1].padEnd(USDC_DECIMALS, '0').slice(0, USDC_DECIMALS);
  return whole + BigInt(decimals);
}
