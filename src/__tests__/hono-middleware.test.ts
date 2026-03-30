import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { x402Hono } from '../middleware/hono.js';
import { setToolPrices } from '../pricing.js';
import { resetConfig } from '../config.js';

describe('Hono x402 middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    setToolPrices({
      read_data: 'read',
      write_data: 'write',
      free_data: 'free',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  function createMocks(xPayment?: string) {
    const headerFn = jest.fn().mockImplementation((name: unknown) => {
      if (name === 'x-payment') return xPayment;
      return undefined;
    });
    const jsonFn = jest.fn().mockReturnValue(new Response('{}', { status: 402 }));
    const c = {
      req: { header: headerFn },
      json: jsonFn,
    } as unknown as Parameters<ReturnType<typeof x402Hono>>[0];
    const next = jest.fn().mockReturnValue(Promise.resolve()) as unknown as Parameters<ReturnType<typeof x402Hono>>[1];
    return { c, next, jsonFn, headerFn };
  }

  function makePaymentHeader(overrides: Record<string, unknown> = {}): string {
    const payload = {
      x402Version: 1,
      payload: {
        authorization: {
          from: '0xaaaa000000000000000000000000000000000000',
          to: '0x1234567890123456789012345678901234567890',
          value: '10000',
          validAfter: '0',
          validBefore: String(Math.floor(Date.now() / 1000) + 3600),
          nonce: '0x' + '00'.repeat(32),
        },
        signature: '0x' + 'ab'.repeat(65),
      },
      accepted: {
        scheme: 'exact',
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '1000',
        payTo: '0x1234567890123456789012345678901234567890',
      },
      ...overrides,
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  describe('disabled x402', () => {
    it('calls next() without payment check when x402 is disabled', async () => {
      delete process.env.X402_EVM_ADDRESS;
      delete process.env.X402_SOLANA_ADDRESS;
      delete process.env.X402_CARDANO_ADDRESS;

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ tier: 'read' })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });
  });

  describe('free tier', () => {
    it('calls next() when price is 0', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ price: 0 })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });

    it('calls next() when tier is free', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ tier: 'free' })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });

    it('calls next() when toolName points to a free-tier tool', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ toolName: 'free_data' })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });
  });

  describe('missing payment header', () => {
    it('returns 402 with payment requirements when no x-payment header (price/tier)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ tier: 'read' })(c, next);

      expect(jsonFn).toHaveBeenCalledTimes(1);
      const [body, status] = jsonFn.mock.calls[0] as [Record<string, unknown>, number];
      expect(status).toBe(402);
      expect(body.error).toBe('Payment Required');
      expect(body.code).toBe(402);
      expect(body.accepts).toBeInstanceOf(Array);
      expect((body.accepts as unknown[]).length).toBeGreaterThan(0);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 402 with payment requirements when no x-payment header (toolName)', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ toolName: 'read_data' })(c, next);

      expect(jsonFn).toHaveBeenCalledTimes(1);
      const [body, status] = jsonFn.mock.calls[0] as [Record<string, unknown>, number];
      expect(status).toBe(402);
      expect(body.error).toBe('Payment Required');
      expect(body.accepts).toBeInstanceOf(Array);
      expect(next).not.toHaveBeenCalled();
    });

    it('includes price and message in 402 response', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { c, next, jsonFn } = createMocks();
      await x402Hono({ price: 0.005 })(c, next);

      const [body] = jsonFn.mock.calls[0] as [Record<string, unknown>, number];
      expect(body.price).toBe(0.005);
      expect(body.priceFormatted).toBe('$0.0050');
      expect(typeof body.message).toBe('string');
    });
  });

  describe('invalid payment header', () => {
    it('returns 402 when x-payment header cannot be parsed', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const invalidHeader = Buffer.from('not-valid-json').toString('base64');
      const { c, next, jsonFn } = createMocks(invalidHeader);
      await x402Hono({ tier: 'read' })(c, next);

      expect(jsonFn).toHaveBeenCalledTimes(1);
      const [body, status] = jsonFn.mock.calls[0] as [Record<string, unknown>, number];
      expect(status).toBe(402);
      expect(body.error).toBe('Invalid payment header format');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('valid payment', () => {
    it('calls next() when payment passes verification', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const header = makePaymentHeader();
      const { c, next, jsonFn } = createMocks(header);
      await x402Hono({ price: 0.001 })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });

    it('calls next() when payment passes verification with toolName', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const header = makePaymentHeader();
      const { c, next, jsonFn } = createMocks(header);
      await x402Hono({ toolName: 'read_data' })(c, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(jsonFn).not.toHaveBeenCalled();
    });
  });

  describe('invalid payment (bad recipient)', () => {
    it('returns 402 when payment recipient does not match', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const header = makePaymentHeader({
        payload: {
          authorization: {
            from: '0xaaaa000000000000000000000000000000000000',
            to: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            value: '10000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: '0x' + '00'.repeat(32),
          },
          signature: '0x' + 'ab'.repeat(65),
        },
      });

      const { c, next, jsonFn } = createMocks(header);
      await x402Hono({ price: 0.001 })(c, next);

      expect(jsonFn).toHaveBeenCalledTimes(1);
      const [, status] = jsonFn.mock.calls[0] as [Record<string, unknown>, number];
      expect(status).toBe(402);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
