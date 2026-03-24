/**
 * Policy Engine Tests
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { PolicyEngine } from '../policy/engine.js';
import { SpendingTracker, formatUSDC, parseUSDC } from '../policy/spending.js';

describe('Policy', () => {
  // Create a new temp dir for each test
  function createTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'x402-policy-test-'));
  }

  function cleanup(dir: string): void {
    rmSync(dir, { recursive: true, force: true });
  }

  describe('formatUSDC / parseUSDC', () => {
    it('should format USDC amounts correctly', () => {
      expect(formatUSDC(BigInt(1000000))).toBe('$1.00');
      expect(formatUSDC(BigInt(10000000))).toBe('$10.00');
      expect(formatUSDC(BigInt(1500000))).toBe('$1.50');
      expect(formatUSDC(BigInt(100))).toBe('$0.00');
    });

    it('should parse USDC amounts correctly', () => {
      expect(parseUSDC('1')).toBe(BigInt(1000000));
      expect(parseUSDC('10')).toBe(BigInt(10000000));
      expect(parseUSDC('1.5')).toBe(BigInt(1500000));
      expect(parseUSDC('0.01')).toBe(BigInt(10000));
    });
  });

  describe('SpendingTracker', () => {
    it('should track daily spending', () => {
      const tempDir = createTempDir();
      try {
        const tracker = new SpendingTracker(join(tempDir, 'spending.json'));

        tracker.record({
          id: '1',
          timestamp: new Date().toISOString(),
          to: '0x123',
          amount: '1000000', // 1 USDC
          chainId: 8453,
          status: 'completed',
        });

        expect(tracker.getDailyTotal()).toBe(BigInt(1000000));
      } finally {
        cleanup(tempDir);
      }
    });

    it('should track multiple transactions', () => {
      const tempDir = createTempDir();
      try {
        const tracker = new SpendingTracker(join(tempDir, 'spending.json'));

        tracker.record({
          id: '1',
          timestamp: new Date().toISOString(),
          to: '0x123',
          amount: '1000000',
          chainId: 8453,
          status: 'completed',
        });

        tracker.record({
          id: '2',
          timestamp: new Date().toISOString(),
          to: '0x456',
          amount: '2000000',
          chainId: 8453,
          status: 'completed',
        });

        expect(tracker.getDailyTotal()).toBe(BigInt(3000000));
      } finally {
        cleanup(tempDir);
      }
    });

    it('should get summary', () => {
      const tempDir = createTempDir();
      try {
        const tracker = new SpendingTracker(join(tempDir, 'spending.json'));

        tracker.record({
          id: '1',
          timestamp: new Date().toISOString(),
          to: '0x123',
          amount: '5000000',
          chainId: 8453,
          status: 'completed',
        });

        const summary = tracker.getTodaySummary();
        expect(summary.total).toBe('$5.00');
        expect(summary.transactions).toBe(1);
      } finally {
        cleanup(tempDir);
      }
    });
  });

  describe('PolicyEngine', () => {
    it('should allow transactions within limits', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));

        const result = await engine.check({
          to: '0x123',
          amount: '1000000', // 1 USDC
          chainId: 8453,
        });

        expect(result.allowed).toBe(true);
      } finally {
        cleanup(tempDir);
      }
    });

    it('should reject transactions exceeding per-tx limit', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        engine.setRule('maxSpendPerTx', { amount: '5', currency: 'USDC' });

        const result = await engine.check({
          to: '0x123',
          amount: '10000000', // 10 USDC
          chainId: 8453,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('exceeds max per tx');
      } finally {
        cleanup(tempDir);
      }
    });

    it('should reject transactions exceeding daily limit', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        engine.setRule('maxSpendPerDay', { amount: '5', currency: 'USDC' });

        // Record some spending first
        engine.recordTransaction({
          id: '1',
          timestamp: new Date().toISOString(),
          to: '0x123',
          amount: '4000000', // 4 USDC
          chainId: 8453,
          status: 'completed',
        });

        // This should push us over the limit
        const result = await engine.check({
          to: '0x456',
          amount: '2000000', // 2 USDC more = 6 total
          chainId: 8453,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('exceed daily limit');
      } finally {
        cleanup(tempDir);
      }
    });

    it('should reject blocked recipients', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        // Set high limits so we don't hit them
        engine.setRule('maxSpendPerDay', { amount: '1000', currency: 'USDC' });
        engine.setRule('blockedRecipients', ['0xblocked']);

        const result = await engine.check({
          to: '0xblocked',
          amount: '1000000',
          chainId: 8453,
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('blocked');
      } finally {
        cleanup(tempDir);
      }
    });

    it('should enforce allowed recipients', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        // Set high limits
        engine.setRule('maxSpendPerDay', { amount: '1000', currency: 'USDC' });
        engine.setRule('allowedRecipients', ['0xallowed1', '0xallowed2']);

        // Allowed
        const result1 = await engine.check({
          to: '0xallowed1',
          amount: '1000000',
          chainId: 8453,
        });
        expect(result1.allowed).toBe(true);

        // Not in allowed list
        const result2 = await engine.check({
          to: '0xrandom',
          amount: '1000000',
          chainId: 8453,
        });
        expect(result2.allowed).toBe(false);
        expect(result2.reason).toContain('not in allowed list');
      } finally {
        cleanup(tempDir);
      }
    });

    it('should enforce allowed chains', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        // Set high limits
        engine.setRule('maxSpendPerDay', { amount: '1000', currency: 'USDC' });
        engine.setRule('allowedChains', ['8453', 'base']);

        // Allowed (by chain ID)
        const result1 = await engine.check({
          to: '0x123',
          amount: '1000000',
          chainId: 8453,
        });
        expect(result1.allowed).toBe(true);

        // Not allowed
        const result2 = await engine.check({
          to: '0x123',
          amount: '1000000',
          chainId: 1, // Ethereum mainnet
        });
        expect(result2.allowed).toBe(false);
        expect(result2.reason).toContain('not in allowed list');
      } finally {
        cleanup(tempDir);
      }
    });

    it('should disable policy when disabled', async () => {
      const tempDir = createTempDir();
      try {
        const engine = new PolicyEngine(join(tempDir, 'policy.json'));
        engine.setRule('maxSpendPerTx', { amount: '1', currency: 'USDC' });
        engine.setEnabled(false);

        // Should be allowed even though it exceeds limit
        const result = await engine.check({
          to: '0x123',
          amount: '100000000', // 100 USDC
          chainId: 8453,
        });

        expect(result.allowed).toBe(true);
      } finally {
        cleanup(tempDir);
      }
    });
  });
});
