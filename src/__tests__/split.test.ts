import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock fetch globally
const mockFetch = jest.fn<typeof fetch>();
(globalThis as any).fetch = mockFetch;

// Must import AFTER mocking fetch
import { createSplitClient } from '../split/client.js';
import { verifyJWT, clearPublicKeyCache } from '../split/jwt.js';
import { wrapWithSplitPayment } from '../split/gate.js';
import type { JWTClaims } from '../split/types.js';

// Helper: create a mock 402 response with payment requirements
function mock402Response() {
  return new Response(
    JSON.stringify({
      error: 'Payment Required',
      code: 402,
      accepts: [{
        scheme: 'exact',
        network: 'eip155:84532',
        maxAmountRequired: '1000',
        payTo: '0x1234567890123456789012345678901234567890',
        extra: {
          name: 'USDC',
          version: '2',
          chainId: 84532,
          verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        },
      }],
    }),
    { status: 402, headers: { 'Content-Type': 'application/json' } },
  );
}

// Helper: create a mock JWT response
function mockJWTResponse(jwt = 'header.payload.signature') {
  return new Response(
    JSON.stringify({ jwt }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('Split Execution', () => {
  const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;
  const WORKER_URL = 'https://test-worker.example.com';

  beforeEach(() => {
    mockFetch.mockReset();
    clearPublicKeyCache();
  });

  describe('createSplitClient', () => {
    it('creates a client with required options', () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      expect(client).toBeDefined();
      expect(client.requestJWT).toBeInstanceOf(Function);
      expect(client.verifyJWT).toBeInstanceOf(Function);
      expect(client.clearKeyCache).toBeInstanceOf(Function);
    });

    it('handles 200 with JWT on initial request (free tool)', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      mockFetch.mockResolvedValueOnce(mockJWTResponse('test-jwt-token'));

      const result = await client.requestJWT({ exchange: 'mexc', tool: 'list_exchanges' });
      expect(result.jwt).toBe('test-jwt-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${WORKER_URL}/verify-payment`);
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body as string)).toEqual({
        exchange: 'mexc',
        tool: 'list_exchanges',
      });
    });

    it('handles 402 → sign → retry → JWT flow', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      // First call returns 402
      mockFetch.mockResolvedValueOnce(mock402Response());
      // Second call returns JWT
      mockFetch.mockResolvedValueOnce(mockJWTResponse('paid-jwt-token'));

      const result = await client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' });
      expect(result.jwt).toBe('paid-jwt-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second call should include X-PAYMENT header
      const [, secondOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
      const headers = secondOptions.headers as Record<string, string>;
      expect(headers['X-PAYMENT']).toBeDefined();
      expect(headers['X-PAYMENT'].length).toBeGreaterThan(0);

      // X-PAYMENT should be valid base64 JSON
      const payment = JSON.parse(Buffer.from(headers['X-PAYMENT'], 'base64').toString());
      expect(payment.x402Version).toBe(2);
      expect(payment.payload.authorization).toBeDefined();
      expect(payment.payload.signature).toBeDefined();
      expect(payment.payload.authorization.to).toBe('0x1234567890123456789012345678901234567890');
    });

    it('throws on unexpected status code', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      mockFetch.mockResolvedValueOnce(
        new Response('Server Error', { status: 500 }),
      );

      await expect(
        client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' }),
      ).rejects.toThrow('Unexpected response from Worker (500)');
    });

    it('throws when 200 but no JWT', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      await expect(
        client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' }),
      ).rejects.toThrow('Worker returned 200 but no JWT');
    });

    it('throws when payment accepted but no JWT returned', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      mockFetch.mockResolvedValueOnce(mock402Response());
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      await expect(
        client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' }),
      ).rejects.toThrow('Worker accepted payment but returned no JWT');
    });

    it('throws when paid request fails', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
      });

      mockFetch.mockResolvedValueOnce(mock402Response());
      mockFetch.mockResolvedValueOnce(
        new Response('Insufficient funds', { status: 403 }),
      );

      await expect(
        client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' }),
      ).rejects.toThrow('Payment failed (403)');
    });

    it('uses correct chainId for mainnet', async () => {
      const client = createSplitClient({
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: false,
      });

      // 402 without extra (should derive chainId from testnet flag)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accepts: [{
              scheme: 'exact',
              network: 'eip155:8453',
              maxAmountRequired: '1000',
              payTo: '0x1234567890123456789012345678901234567890',
            }],
          }),
          { status: 402 },
        ),
      );
      mockFetch.mockResolvedValueOnce(mockJWTResponse('mainnet-jwt'));

      const result = await client.requestJWT({ exchange: 'mexc', tool: 'get_ticker' });
      expect(result.jwt).toBe('mainnet-jwt');

      // Payment should reference mainnet
      const [, secondOptions] = mockFetch.mock.calls[1] as [string, RequestInit];
      const headers = secondOptions.headers as Record<string, string>;
      const payment = JSON.parse(Buffer.from(headers['X-PAYMENT'], 'base64').toString());
      expect(payment.accepted.asset).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });
  });

  describe('verifyJWT', () => {
    it('rejects invalid JWT format', async () => {
      await expect(verifyJWT('not.valid', `${WORKER_URL}/jwt-public-key`))
        .rejects.toThrow('Invalid JWT: expected 3 parts');
    });

    it('rejects non-ES256 algorithm', async () => {
      const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const payload = btoa(JSON.stringify({ sub: 'test' }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = `${header}.${payload}.fakesig`;

      await expect(verifyJWT(token, `${WORKER_URL}/jwt-public-key`))
        .rejects.toThrow('Unsupported JWT algorithm: RS256');
    });
  });

  describe('clearPublicKeyCache', () => {
    it('clears without error', () => {
      expect(() => clearPublicKeyCache()).not.toThrow();
    });
  });

  describe('wrapWithSplitPayment', () => {
    it('does not wrap free tools', async () => {
      const toolCalls: Array<{ name: string; args: any[] }> = [];
      const registeredHandlers: Record<string, Function> = {};

      const mockServer = {
        tool: function (...args: any[]) {
          const name = args[0];
          const handler = args[args.length - 1];
          registeredHandlers[name] = handler;
          toolCalls.push({ name, args });
        },
      };

      wrapWithSplitPayment(mockServer as any, {
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
        freeTools: ['list_exchanges'],
      });

      // Register a free tool
      const originalHandler = jest.fn(async () => ({
        content: [{ type: 'text', text: '{"exchanges": ["mexc"]}' }],
      }));
      (mockServer as any).tool('list_exchanges', originalHandler);

      // The registered handler should be the original (not wrapped)
      const handler = registeredHandlers['list_exchanges'];
      const result = await handler({});
      expect(originalHandler).toHaveBeenCalled();
    });

    it('wraps paid tools with payment flow', () => {
      const registeredHandlers: Record<string, Function> = {};

      const mockServer = {
        tool: function (...args: any[]) {
          const name = args[0];
          const handler = args[args.length - 1];
          registeredHandlers[name] = handler;
        },
      };

      const originalHandler = jest.fn(async () => ({
        content: [{ type: 'text', text: '{"price": 100}' }],
      }));

      wrapWithSplitPayment(mockServer as any, {
        privateKey: TEST_PRIVATE_KEY,
        workerUrl: WORKER_URL,
        testnet: true,
        freeTools: ['list_exchanges'],
      });

      (mockServer as any).tool('get_ticker', { exchange: { type: 'string' } }, originalHandler);

      // The handler should be wrapped (different function)
      const handler = registeredHandlers['get_ticker'];
      expect(handler).not.toBe(originalHandler);
    });
  });
});
