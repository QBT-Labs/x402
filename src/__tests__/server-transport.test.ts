import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { setToolPrices } from '../pricing.js';
import { resetConfig } from '../config.js';

const mockVerifyWithFacilitator = jest.fn<any>();
const mockSettleWithFacilitator = jest.fn<any>();
const mockBuildFacilitatorRequirements = jest.fn<any>();

jest.unstable_mockModule('../facilitator.js', () => ({
  buildFacilitatorRequirements: mockBuildFacilitatorRequirements,
  verifyWithFacilitator: mockVerifyWithFacilitator,
  settleWithFacilitator: mockSettleWithFacilitator,
}));

const { withX402Server } = await import('../transport/server.js');

function makeRequest(
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  return new Request('https://mcp.example.com/mcp', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function makeRpcBody(rpcMethod: string, params?: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: rpcMethod,
    params,
  };
}

const mockHandler = jest.fn<(req: Request) => Promise<Response>>();

describe('withX402Server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    resetConfig();
    setToolPrices({
      get_ticker: 'read',
      place_order: 'write',
      free_tool: 'free',
    });
    mockHandler.mockResolvedValue(
      new Response(JSON.stringify({ result: 'ok' }), { status: 200 }),
    );
    mockBuildFacilitatorRequirements.mockReturnValue({
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        maxAmountRequired: '1000',
        payTo: '0x1234567890123456789012345678901234567890',
      }],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  it('passes GET requests straight through', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = new Request('https://mcp.example.com/mcp', { method: 'GET' });

    await wrapped(req);

    expect(mockHandler).toHaveBeenCalledWith(req);
  });

  it('passes non-JSON POST requests through', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = new Request('https://mcp.example.com/mcp', {
      method: 'POST',
      body: 'not json',
    });

    await wrapped(req);

    expect(mockHandler).toHaveBeenCalled();
  });

  it('passes non-tool RPC requests through', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest('POST', makeRpcBody('tools/list'));

    await wrapped(req);

    expect(mockHandler).toHaveBeenCalled();
  });

  it('passes free tool requests through without payment', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest('POST', makeRpcBody('tools/call', { name: 'free_tool' }));

    await wrapped(req);

    expect(mockHandler).toHaveBeenCalled();
  });

  it('returns 402 for paid tool without X-PAYMENT header', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest('POST', makeRpcBody('tools/call', { name: 'get_ticker' }));

    const response = await wrapped(req);

    expect(response.status).toBe(402);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('Payment Required');
    expect(body.price).toBe(0.001);
    expect(body.accepts).toBeDefined();
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('returns 403 for invalid payment header', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest(
      'POST',
      makeRpcBody('tools/call', { name: 'get_ticker' }),
      { 'X-PAYMENT': 'not-valid-base64!!!' },
    );

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('Invalid payment header format');
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('returns 403 when facilitator verification fails', async () => {
    mockVerifyWithFacilitator.mockResolvedValue({
      valid: false,
      error: 'Insufficient funds',
    });

    const validPayment = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { authorization: {}, signature: '0x' },
      accepted: { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000' },
    })).toString('base64');

    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest(
      'POST',
      makeRpcBody('tools/call', { name: 'get_ticker' }),
      { 'X-PAYMENT': validPayment },
    );

    const response = await wrapped(req);

    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('Payment verification failed');
    expect(body.reason).toBe('Insufficient funds');
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('executes handler and settles when payment is valid', async () => {
    mockVerifyWithFacilitator.mockResolvedValue({ valid: true });
    mockSettleWithFacilitator.mockResolvedValue({ success: true, txHash: '0xabc' });

    const validPayment = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { authorization: {}, signature: '0x' },
      accepted: { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000' },
    })).toString('base64');

    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest(
      'POST',
      makeRpcBody('tools/call', { name: 'place_order' }),
      { 'X-PAYMENT': validPayment },
    );

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalled();
    expect(mockVerifyWithFacilitator).toHaveBeenCalled();

    // Wait for fire-and-forget settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSettleWithFacilitator).toHaveBeenCalled();
  });

  it('still returns response if settlement fails', async () => {
    mockVerifyWithFacilitator.mockResolvedValue({ valid: true });
    mockSettleWithFacilitator.mockRejectedValue(new Error('network error'));

    const validPayment = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { authorization: {}, signature: '0x' },
      accepted: { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1000' },
    })).toString('base64');

    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest(
      'POST',
      makeRpcBody('tools/call', { name: 'get_ticker' }),
      { 'X-PAYMENT': validPayment },
    );

    const response = await wrapped(req);

    expect(response.status).toBe(200);
    expect(mockHandler).toHaveBeenCalled();

    // Wait for fire-and-forget settle to complete
    await new Promise((r) => setTimeout(r, 10));
  });

  it('supports custom extractToolName', async () => {
    const customExtractor = (body: unknown) => {
      const b = body as { action?: string };
      return b.action ?? null;
    };

    const wrapped = withX402Server({
      handler: mockHandler,
      extractToolName: customExtractor,
    });

    const req = makeRequest('POST', { action: 'get_ticker' });
    const response = await wrapped(req);

    expect(response.status).toBe(402);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('uses buildFacilitatorRequirements for 402 response', async () => {
    const wrapped = withX402Server({ handler: mockHandler });
    const req = makeRequest('POST', makeRpcBody('tools/call', { name: 'get_ticker' }));

    await wrapped(req);

    expect(mockBuildFacilitatorRequirements).toHaveBeenCalledWith('get_ticker');
  });
});
