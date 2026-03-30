import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  buildFacilitatorRequirements,
  checkFacilitatorHealth,
} from '../facilitator.js';
import { setToolPrices } from '../pricing.js';
import { resetConfig } from '../config.js';

describe('x402 Facilitator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    setToolPrices({
      'get_ticker': 'read',
      'place_order': 'write',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('buildFacilitatorRequirements', () => {
    it('builds EVM requirements when EVM address configured', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.X402_TESTNET;

      const requirements = buildFacilitatorRequirements('get_ticker');

      expect(requirements.accepts).toHaveLength(1);
      expect(requirements.accepts[0].scheme).toBe('exact');
      expect(requirements.accepts[0].network).toBe('eip155:8453');
      expect(requirements.accepts[0].payTo).toBe('0x1234567890123456789012345678901234567890');
      expect(requirements.accepts[0].extra).toEqual({ name: 'USD Coin', version: '2' });
    });

    it('builds Solana requirements when Solana address configured', () => {
      process.env.X402_SOLANA_ADDRESS = 'SolanaAddress123';
      delete process.env.X402_TESTNET;

      const requirements = buildFacilitatorRequirements('get_ticker');

      expect(requirements.accepts).toHaveLength(1);
      expect(requirements.accepts[0].network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
      expect(requirements.accepts[0].payTo).toBe('SolanaAddress123');
      // Solana requires fee payer for PST flow
      expect(requirements.accepts[0].extra).toEqual({
        feePayer: '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4',
        description: 'x402 payment',
      });
    });

    it('builds requirements for both chains when both configured', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_SOLANA_ADDRESS = 'SolanaAddress123';
      delete process.env.X402_TESTNET;

      const requirements = buildFacilitatorRequirements('place_order');

      expect(requirements.accepts).toHaveLength(2);
      expect(requirements.accepts.map((a) => a.network)).toContain('eip155:8453');
      expect(requirements.accepts.map((a) => a.network)).toContain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    });

    it('uses testnet chains when testnet mode', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_TESTNET = 'true';

      const requirements = buildFacilitatorRequirements('get_ticker');

      expect(requirements.accepts[0].network).toBe('eip155:84532');
    });

    it('calculates correct amount from pricing', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const readRequirements = buildFacilitatorRequirements('get_ticker');
      expect(readRequirements.accepts[0].amount).toBe('1000');

      const writeRequirements = buildFacilitatorRequirements('place_order');
      expect(writeRequirements.accepts[0].amount).toBe('10000');
    });
  });

  describe('checkFacilitatorHealth', () => {
    it('returns boolean', async () => {
      const result = await checkFacilitatorHealth();
      expect(typeof result).toBe('boolean');
    });
  });
});
