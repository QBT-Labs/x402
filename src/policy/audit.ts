/**
 * Audit Logger
 * Records all signing operations for security auditing
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { AuditConfig } from './types.js';
import { POLICY_DIR, AUDIT_FILE } from './types.js';

export type AuditLevel = 'debug' | 'info' | 'warn' | 'error';
export type AuditEvent =
  | 'TX_ALLOWED'
  | 'TX_REJECTED'
  | 'TX_PENDING'
  | 'TX_COMPLETED'
  | 'TX_FAILED'
  | 'POLICY_CHANGE'
  | 'SIGNER_START'
  | 'SIGNER_STOP'
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE';

export interface AuditEntry {
  timestamp: string;
  level: AuditLevel;
  event: AuditEvent;
  data: Record<string, unknown>;
}

export class AuditLogger {
  private filePath: string;
  private config: AuditConfig;
  private levelPriority: Record<AuditLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: AuditConfig, filePath?: string) {
    const baseDir = join(homedir(), POLICY_DIR);
    this.filePath = filePath || config.logFile || join(baseDir, AUDIT_FILE);
    this.config = config;

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Check if logging is enabled for this level
   */
  private shouldLog(level: AuditLevel): boolean {
    if (!this.config.enabled) return false;
    const configLevel = this.config.logLevel || 'info';
    return this.levelPriority[level] >= this.levelPriority[configLevel];
  }

  /**
   * Log an event
   */
  log(level: AuditLevel, event: AuditEvent, data: Record<string, unknown> = {}): void {
    if (!this.shouldLog(level)) return;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      data,
    };

    // Format: 2026-03-24T10:30:15.123Z INFO  TX_ALLOWED    to=0x... amount=0.01 chain=base
    const dataStr = Object.entries(data)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');

    const line = `${entry.timestamp} ${level.toUpperCase().padEnd(5)} ${event.padEnd(14)} ${dataStr}\n`;

    appendFileSync(this.filePath, line, { mode: 0o600 });
  }

  /**
   * Convenience methods
   */
  debug(event: AuditEvent, data?: Record<string, unknown>): void {
    this.log('debug', event, data);
  }

  info(event: AuditEvent, data?: Record<string, unknown>): void {
    this.log('info', event, data);
  }

  warn(event: AuditEvent, data?: Record<string, unknown>): void {
    this.log('warn', event, data);
  }

  error(event: AuditEvent, data?: Record<string, unknown>): void {
    this.log('error', event, data);
  }

  /**
   * Log transaction allowed
   */
  txAllowed(data: { to: string; amount: string; chainId: number; tool?: string }): void {
    this.info('TX_ALLOWED', data);
  }

  /**
   * Log transaction rejected
   */
  txRejected(data: { to: string; amount: string; reason: string }): void {
    this.warn('TX_REJECTED', data);
  }

  /**
   * Log policy change
   */
  policyChange(data: { rule: string; oldValue: unknown; newValue: unknown }): void {
    this.info('POLICY_CHANGE', data);
  }

  /**
   * Read recent audit entries
   */
  getRecent(limit = 50): string[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit);
  }

  /**
   * Export audit log to CSV format
   */
  exportCSV(): string {
    const lines = this.getRecent(10000);
    const rows: string[] = ['timestamp,level,event,data'];

    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (match) {
        const [, timestamp, level, event, data] = match;
        rows.push(`${timestamp},${level},${event},"${data.replace(/"/g, '""')}"`);
      }
    }

    return rows.join('\n');
  }
}
