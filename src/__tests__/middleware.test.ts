import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { withX402, checkPayment } from '../middleware/mcp.js';
import { setToolPrices } from '../pricing.js';

describe('x402 Middleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    setToolPrices({
      'get_ticker': 'read',
      'place_order': 'write',
      'free_tool': 'free',
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockHandler = () => {
    const calls: unknown[] = [];
    const handler = async (params: unknown) => {
      calls.push(params);
      return { content: [{ type: 'text', text: '{"result": "success"}' }] };
    };
    return { handler, calls };
  };

  describe('withX402', () => {
    it('passes through when x402 is disabled', async () => {
      delete process.env.X402_EVM_ADDRESS;
      delete process.env.X402_SOLANA_ADDRESS;

      const { handler, calls } = createMockHandler();
      const wrapped = withX402('get_ticker', handler);
      const result = await wrapped({ exchange: 'mexc', symbol: 'BTC/USDT' });

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('passes through for free tier tools', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { handler, calls } = createMockHandler();
      const wrapped = withX402('free_tool', handler);
      const result = await wrapped({});

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('returns 402 when no payment provided for paid tool', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const { handler } = createMockHandler();
      const wrapped = withX402('get_ticker', handler);
      const result = await wrapped({ exchange: 'mexc', symbol: 'BTC/USDT' });

      const response = JSON.parse(result.content[0].text);
      expect(response.code).toBe(402);
      expect(response.error).toBe('Payment Required');
      expect(response.tool).toBe('get_ticker');
      expect(response.accepts).toBeDefined();
      expect(response.accepts.length).toBeGreaterThan(0);
    });

    it('includes correct payment requirements in 402 response', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.X402_SOLANA_ADDRESS = 'SolanaAddress123';

      const { handler } = createMockHandler();
      const wrapped = withX402('get_ticker', handler);
      const result = await wrapped({});

      const response = JSON.parse(result.content[0].text);
      expect(response.accepts).toHaveLength(2);
      expect(response.accepts[0].network).toBe('eip155:8453');
      expect(response.accepts[1].network).toBe('solana:mainnet');
    });

    it('executes handler when valid payment provided', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const validPayment = {
        x402Version: 1,
        payload: {
          authorization: {
            from: '0xaaaa',
            to: '0x1234567890123456789012345678901234567890',
            value: '10000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: '0x' + '00'.repeat(32),
          },
          signature: '0x' + 'ab'.repeat(65),
        },
        accepted: {
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amount: '10000',
        },
      };
      const paymentSignature = Buffer.from(JSON.stringify(validPayment)).toString('base64');

      const { handler, calls } = createMockHandler();
      const wrapped = withX402('get_ticker', handler);
      const result = await wrapped({
        exchange: 'mexc',
        symbol: 'BTC/USDT',
        paymentSignature,
      });

      expect(calls.length).toBe(1);
      expect(result.content[0].text).toContain('success');
    });

    it('returns error for invalid payment', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const invalidPayment = {
        x402Version: 1,
        payload: {
          authorization: {
            from: '0xaaaa',
            to: '0xwrongaddress',
            value: '10000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: '0x' + '00'.repeat(32),
          },
          signature: '0x' + 'ab'.repeat(65),
        },
        accepted: {
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amount: '10000',
        },
      };
      const paymentSignature = Buffer.from(JSON.stringify(invalidPayment)).toString('base64');

      const { handler } = createMockHandler();
      const wrapped = withX402('get_ticker', handler);
      const result = await wrapped({ paymentSignature });

      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('Payment Verification Failed');
      expect(response.reason).toContain('recipient');
    });
  });

  describe('checkPayment', () => {
    it('returns null when x402 is disabled', async () => {
      delete process.env.X402_EVM_ADDRESS;
      delete process.env.X402_SOLANA_ADDRESS;

      const result = await checkPayment('get_ticker');
      expect(result).toBeNull();
    });

    it('returns null for free tools', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const result = await checkPayment('free_tool');
      expect(result).toBeNull();
    });

    it('returns 402 response when no payment', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const result = await checkPayment('get_ticker');
      expect(result).not.toBeNull();

      const response = JSON.parse(result!.content[0].text);
      expect(response.code).toBe(402);
    });

    it('returns null for valid payment', async () => {
      process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';

      const validPayment = {
        x402Version: 1,
        payload: {
          authorization: {
            from: '0xaaaa',
            to: '0x1234567890123456789012345678901234567890',
            value: '10000',
            validAfter: '0',
            validBefore: String(Math.floor(Date.now() / 1000) + 3600),
            nonce: '0x' + '00'.repeat(32),
          },
          signature: '0x' + 'ab'.repeat(65),
        },
        accepted: {
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amount: '10000',
        },
      };
      const paymentSignature = Buffer.from(JSON.stringify(validPayment)).toString('base64');

      const result = await checkPayment('get_ticker', paymentSignature);
      expect(result).toBeNull();
    });
  });
});
