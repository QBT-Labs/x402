
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock the client module before importing the module under test
const mockParsePaymentRequired = jest.fn<any>();
const mockSignPayment = jest.fn<any>();
const mockBuildPaymentPayload = jest.fn<any>();

jest.unstable_mockModule('../client.js', () => ({
  parsePaymentRequired: mockParsePaymentRequired,
  signPayment: mockSignPayment,
  buildPaymentPayload: mockBuildPaymentPayload,
}));

// Import module under test AFTER setting up mocks
const { createPaymentFetch } = await import('../transport/payment-fetch.js');

// Mock global fetch
const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

const PRIVATE_KEY = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const;

function make402Body() {
  return {
    error: 'Payment Required',
    price: 0.001,
    accepts: [{
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0xRecipientAddress1234567890123456789012',
      maxAmountRequired: '1000',
    }],
  };
}

function makeParsedRequirements() {
  return {
    price: 0.001,
    payTo: '0xRecipientAddress1234567890123456789012',
    network: 'eip155:84532',
    chainId: 84532,
  };
}

function makeSignedPayment() {
  return {
    from: '0xsender',
    to: '0xRecipientAddress1234567890123456789012',
    value: '1000',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: '0x' + '00'.repeat(32),
    signature: '0xsig',
    network: 'eip155:84532',
  };
}

function makeResponse(status: number, body?: unknown): Response {
  const bodyText = body !== undefined ? JSON.stringify(body) : '';
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(bodyText),
    headers: new Headers(),
  } as unknown as Response;
}

function setupSuccessfulPaymentMocks() {
  mockParsePaymentRequired.mockReturnValue(makeParsedRequirements());
  mockSignPayment.mockResolvedValue(makeSignedPayment());
  mockBuildPaymentPayload.mockReturnValue('base64-payment-header');
}

describe('createPaymentFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns response as-is for non-402 status', async () => {
    const okResponse = makeResponse(200, { data: 'ok' });
    mockFetch.mockResolvedValueOnce(okResponse);

    const paymentFetch = createPaymentFetch({ privateKey: PRIVATE_KEY });
    const result = await paymentFetch('https://api.example.com/data');

    expect(result).toBe(okResponse);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockParsePaymentRequired).not.toHaveBeenCalled();
  });

  it('handles 402 by signing and retrying with X-PAYMENT header', async () => {
    const body402 = make402Body();
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, body402))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const paymentFetch = createPaymentFetch({ privateKey: PRIVATE_KEY });
    const result = await paymentFetch('https://api.example.com/paid');

    expect(result).toBe(retryResponse);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockParsePaymentRequired).toHaveBeenCalledWith(body402);
    expect(mockSignPayment).toHaveBeenCalledWith({
      privateKey: PRIVATE_KEY,
      to: '0xRecipientAddress1234567890123456789012',
      amount: 0.001,
      chainId: 84532,
    });

    // Verify X-PAYMENT header on retry
    const retryCall = mockFetch.mock.calls[1];
    const retryInit = retryCall[1] as RequestInit;
    const headers = retryInit.headers as Headers;
    expect(headers.get('X-PAYMENT')).toBe('base64-payment-header');
  });

  it('throws when payment requirements cannot be parsed', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(402, { error: 'unknown' }));
    mockParsePaymentRequired.mockReturnValue(null);

    const paymentFetch = createPaymentFetch({ privateKey: PRIVATE_KEY });

    await expect(paymentFetch('https://api.example.com/bad')).rejects.toThrow(
      'Failed to parse payment requirements from 402 response',
    );
  });

  it('throws when onPaymentRequired returns false', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(402, make402Body()));
    mockParsePaymentRequired.mockReturnValue(makeParsedRequirements());

    const onPaymentRequired = jest.fn<(url: string, amount: number) => Promise<boolean>>().mockResolvedValue(false);

    const paymentFetch = createPaymentFetch({
      privateKey: PRIVATE_KEY,
      onPaymentRequired,
    });

    await expect(paymentFetch('https://api.example.com/denied')).rejects.toThrow(
      'Payment cancelled by user',
    );

    expect(onPaymentRequired).toHaveBeenCalledWith('https://api.example.com/denied', 0.001);
    expect(mockSignPayment).not.toHaveBeenCalled();
  });

  it('proceeds when onPaymentRequired returns true', async () => {
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, make402Body()))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const onPaymentRequired = jest.fn<(url: string, amount: number) => Promise<boolean>>().mockResolvedValue(true);

    const paymentFetch = createPaymentFetch({
      privateKey: PRIVATE_KEY,
      onPaymentRequired,
    });

    const result = await paymentFetch('https://api.example.com/approved');

    expect(result).toBe(retryResponse);
    expect(onPaymentRequired).toHaveBeenCalledWith('https://api.example.com/approved', 0.001);
    expect(mockSignPayment).toHaveBeenCalled();
  });

  it('calls onPaymentSent after successful retry', async () => {
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, make402Body()))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const onPaymentSent = jest.fn<(url: string, amount: number) => void>();

    const paymentFetch = createPaymentFetch({
      privateKey: PRIVATE_KEY,
      onPaymentSent,
    });

    await paymentFetch('https://api.example.com/notify');

    expect(onPaymentSent).toHaveBeenCalledWith('https://api.example.com/notify', 0.001);
  });

  it('uses provided chainId over parsed chainId', async () => {
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, make402Body()))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const paymentFetch = createPaymentFetch({
      privateKey: PRIVATE_KEY,
      chainId: 8453,
    });

    await paymentFetch('https://api.example.com/mainnet');

    expect(mockSignPayment).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 8453 }),
    );
  });

  it('preserves original request init on retry', async () => {
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, make402Body()))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const paymentFetch = createPaymentFetch({ privateKey: PRIVATE_KEY });

    await paymentFetch('https://api.example.com/data', {
      method: 'POST',
      body: JSON.stringify({ query: 'test' }),
    });

    const retryCall = mockFetch.mock.calls[1];
    const retryInit = retryCall[1] as RequestInit;
    expect(retryInit.method).toBe('POST');
    expect(retryInit.body).toBe(JSON.stringify({ query: 'test' }));
  });

  it('handles URL input correctly', async () => {
    const retryResponse = makeResponse(200, { data: 'paid' });

    mockFetch
      .mockResolvedValueOnce(makeResponse(402, make402Body()))
      .mockResolvedValueOnce(retryResponse);

    setupSuccessfulPaymentMocks();

    const onPaymentSent = jest.fn<(url: string, amount: number) => void>();

    const paymentFetch = createPaymentFetch({
      privateKey: PRIVATE_KEY,
      onPaymentSent,
    });

    const url = new URL('https://api.example.com/url-input');
    await paymentFetch(url);

    expect(onPaymentSent).toHaveBeenCalledWith('https://api.example.com/url-input', 0.001);
  });
});
