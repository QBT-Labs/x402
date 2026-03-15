import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreatePaymentFetch = jest.fn<any>();
const mockCreatePassthroughProxy = jest.fn<any>();

jest.unstable_mockModule('../transport/payment-fetch.js', () => ({
  createPaymentFetch: mockCreatePaymentFetch,
}));

jest.unstable_mockModule('../proxy/passthrough.js', () => ({
  createPassthroughProxy: mockCreatePassthroughProxy,
}));

const { createClientProxy } = await import('../proxy/client-proxy.js');

describe('createClientProxy', () => {
  const mockStop = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockFetchFn = jest.fn() as unknown as typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreatePaymentFetch.mockReturnValue(mockFetchFn);
    mockCreatePassthroughProxy.mockResolvedValue({ stop: mockStop });
  });

  it('creates payment fetch with payment options', async () => {
    const privateKey = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const;
    const onPaymentRequired = jest.fn<(url: string, amount: number) => Promise<boolean>>();
    const onPaymentSent = jest.fn<(url: string, amount: number) => void>();

    await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey,
      chainId: 8453,
      onPaymentRequired,
      onPaymentSent,
      mode: 'stdio',
    });

    expect(mockCreatePaymentFetch).toHaveBeenCalledWith({
      privateKey,
      chainId: 8453,
      onPaymentRequired,
      onPaymentSent,
    });
  });

  it('passes payment fetch to passthrough proxy', async () => {
    await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mode: 'stdio',
    });

    expect(mockCreatePassthroughProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchFn: mockFetchFn,
      }),
    );
  });

  it('passes proxy options to passthrough proxy', async () => {
    await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mode: 'stdio',
      name: 'my-proxy',
      version: '2.0.0',
      port: 3000,
    });

    expect(mockCreatePassthroughProxy).toHaveBeenCalledWith({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn,
      mode: 'stdio',
      name: 'my-proxy',
      version: '2.0.0',
      port: 3000,
    });
  });

  it('returns stop function from passthrough proxy', async () => {
    const result = await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mode: 'stdio',
    });

    expect(result.stop).toBe(mockStop);

    await result.stop();
    expect(mockStop).toHaveBeenCalled();
  });

  it('does not pass proxy-specific options to payment fetch', async () => {
    await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mode: 'stdio',
      name: 'my-proxy',
      version: '2.0.0',
      port: 3000,
    });

    const paymentFetchArgs = mockCreatePaymentFetch.mock.calls[0][0] as Record<string, unknown>;
    expect(paymentFetchArgs).not.toHaveProperty('targetUrl');
    expect(paymentFetchArgs).not.toHaveProperty('mode');
    expect(paymentFetchArgs).not.toHaveProperty('name');
    expect(paymentFetchArgs).not.toHaveProperty('version');
    expect(paymentFetchArgs).not.toHaveProperty('port');
  });

  it('works with minimal options', async () => {
    await createClientProxy({
      targetUrl: 'https://remote.example.com/mcp',
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      mode: 'stdio',
    });

    expect(mockCreatePaymentFetch).toHaveBeenCalledWith({
      privateKey: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });

    expect(mockCreatePassthroughProxy).toHaveBeenCalledWith({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn,
      mode: 'stdio',
      name: undefined,
      version: undefined,
      port: undefined,
    });
  });
});
