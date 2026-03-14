import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  configure,
  getConfig,
  isEnabled,
  getActiveChains,
  resetConfig,
  USDC_CONTRACTS,
} from '../config.js';
import {
  setToolPrices,
  getToolPrice,
  buildPaymentRequirements,
  DEFAULT_TIERS,
} from '../pricing.js';

describe('x402 Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('isEnabled', () => {
    it('returns false when no addresses configured', () => {
      delete process.env.X402_EVM_ADDRESS;
      delete process.env.X402_SOLANA_ADDRESS;
      delete process.env.X402_CARDANO_ADDRESS;
      expect(isEnabled()).toBe(false);
    });

    it('returns true when EVM address configured', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      expect(isEnabled()).toBe(true);
    });

    it('returns true when Solana address configured', () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      expect(isEnabled()).toBe(true);
    });

    it('returns true when Cardano address configured', () => {
      process.env.X402_CARDANO_ADDRESS = 'addr1qxyz';
      expect(isEnabled()).toBe(true);
    });
  });

  describe('getActiveChains', () => {
    it('returns Base mainnet when EVM address set', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      delete process.env.X402_TESTNET;
      const chains = getActiveChains();
      expect(chains).toContain('eip155:8453');
    });

    it('returns Base Sepolia when testnet mode', () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_TESTNET = 'true';
      const chains = getActiveChains();
      expect(chains).toContain('eip155:84532');
    });

    it('returns Solana mainnet when Solana address set', () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      delete process.env.X402_TESTNET;
      const chains = getActiveChains();
      expect(chains).toContain('solana:mainnet');
    });

    it('returns Solana devnet when testnet mode', () => {
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      process.env.X402_TESTNET = 'true';
      const chains = getActiveChains();
      expect(chains).toContain('solana:devnet');
    });

    it('returns Cardano preprod when testnet mode', () => {
      process.env.X402_CARDANO_ADDRESS = 'addr1qxyz';
      process.env.X402_TESTNET = 'true';
      const chains = getActiveChains();
      expect(chains).toContain('cardano:preprod');
    });
  });

  describe('configure', () => {
    it('accepts programmatic configuration', () => {
      configure({
        evm: { address: '0xProgrammatic' },
        testnet: true,
      });
      const config = getConfig();
      expect(config.evm?.address).toBe('0xProgrammatic');
      expect(config.testnet).toBe(true);
    });
  });
});

describe('x402 Pricing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('setToolPrices', () => {
    it('sets pricing for tools with tier string', () => {
      setToolPrices({ 'test_tool': 'read' });
      const pricing = getToolPrice('test_tool');
      expect(pricing.tier).toBe('read');
      expect(pricing.price).toBe(DEFAULT_TIERS.read);
    });

    it('sets pricing for tools with custom price', () => {
      setToolPrices({ 'custom_tool': { tier: 'write', price: 0.05 } });
      const pricing = getToolPrice('custom_tool');
      expect(pricing.tier).toBe('write');
      expect(pricing.price).toBe(0.05);
    });
  });

  describe('getToolPrice', () => {
    it('returns default read tier for unknown tools', () => {
      const pricing = getToolPrice('unknown_tool');
      expect(pricing.tier).toBe('read');
      expect(pricing.price).toBe(DEFAULT_TIERS.read);
    });
  });

  describe('buildPaymentRequirements', () => {
    it('builds correct payment requirements for $0.01', () => {
      delete process.env.X402_TESTNET;
      const requirements = buildPaymentRequirements(0.01);
      expect(requirements.accepts).toHaveLength(1);
      expect(requirements.accepts[0].network).toBe('eip155:8453');
      expect(requirements.accepts[0].amount).toBe('10000');
      expect(requirements.accepts[0].asset).toBe(USDC_CONTRACTS['eip155:8453']);
    });

    it('includes both networks when both addresses set', () => {
      delete process.env.X402_TESTNET;
      process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
      const requirements = buildPaymentRequirements(0.001);
      expect(requirements.accepts).toHaveLength(2);
      expect(requirements.accepts.map((a) => a.network)).toContain('eip155:8453');
      expect(requirements.accepts.map((a) => a.network)).toContain('solana:mainnet');
    });

    it('correctly converts micro-units', () => {
      const requirements = buildPaymentRequirements(0.005);
      expect(requirements.accepts[0].amount).toBe('5000');
    });
  });
});
