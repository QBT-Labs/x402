/**
 * Cardano adapter tests.
 *
 * @lucid-evolution/lucid is mocked via jest.unstable_mockModule so its heavy
 * WASM dependencies (libsodium) are never loaded. The module under test uses
 * dynamic import() internally, which picks up the mock automatically.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Shared mock state — mutated by individual tests
// ---------------------------------------------------------------------------

const MOCK_CBOR    = 'deadbeef01020304';
const MOCK_TX_HASH = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

// CML output list that tests populate before each assertion
let mockCmlOutputs: Array<{
  address: string;
  lovelace: bigint;
  /** unit → amount for native assets */
  tokenAmounts?: Map<string, bigint>;
}> = [];

function buildMockCmlTx() {
  return {
    body: () => ({
      outputs: () => ({
        len: () => mockCmlOutputs.length,
        get: (i: number) => {
          const o = mockCmlOutputs[i];
          return {
            address: () => ({ to_bech32: (_prefix: unknown) => o.address }),
            amount: () => ({
              coin: () => o.lovelace,
              multi_asset: () => {
                if (!o.tokenAmounts || o.tokenAmounts.size === 0) return null;
                // For unit tests each output has at most one token type
                const tokenValue = [...o.tokenAmounts.values()][0] ?? 0n;
                return {
                  get: (_policy: unknown, _asset: unknown) => tokenValue,
                };
              },
            }),
          };
        },
      }),
    }),
  };
}

// Stable mock function references used in both the mock factory and test assertions
const mockToCBOR      = jest.fn<() => string>().mockReturnValue(MOCK_CBOR);
const mockComplete2   = jest.fn<() => Promise<{ toCBOR: () => string }>>()
  .mockResolvedValue({ toCBOR: mockToCBOR });
const mockWithWallet  = jest.fn().mockReturnValue({ complete: mockComplete2 });
const mockComplete1   = jest.fn<() => Promise<{ sign: { withWallet: () => unknown } }>>()
  .mockResolvedValue({ sign: { withWallet: mockWithWallet } });
const mockPayToAddress = jest.fn().mockReturnValue({ complete: mockComplete1 });
const mockNewTx        = jest.fn().mockReturnValue({ pay: { ToAddress: mockPayToAddress } });
const mockFromSeed     = jest.fn();

const mockLucidInstance = {
  newTx: mockNewTx,
  selectWallet: { fromSeed: mockFromSeed },
};
const mockLucid      = jest.fn<() => Promise<typeof mockLucidInstance>>()
  .mockResolvedValue(mockLucidInstance);
const mockBlockfrost = jest.fn();

const mockFromCborHex     = jest.fn(() => buildMockCmlTx());
const mockScriptHashFromHex = jest.fn().mockReturnValue({});
const mockAssetNameFromHex  = jest.fn().mockReturnValue({});

// ---------------------------------------------------------------------------
// Register mock BEFORE importing the module under test
// ---------------------------------------------------------------------------
jest.unstable_mockModule('@lucid-evolution/lucid', () => ({
  Lucid:      mockLucid,
  Blockfrost: mockBlockfrost,
  CML: {
    Transaction: { from_cbor_hex: mockFromCborHex },
    ScriptHash:  { from_hex: mockScriptHashFromHex },
    AssetName:   { from_hex: mockAssetNameFromHex },
  },
}));

// Dynamic import AFTER mock registration — picks up the mocked Lucid
const {
  signCardanoPayment,
  verifyCardanoPayment,
  detectNetwork,
  IUSD_POLICY_ID,
  USDM_POLICY_ID,
  DJED_POLICY_ID,
  USDCX_POLICY_ID,
  USDM_ASSET_HEX,
  DJED_ASSET_HEX,
  USDCX_ASSET_HEX,
  KNOWN_CARDANO_TOKENS,
  MIN_ADA_LOVELACE,
} = await import('../chains/cardano.js');

// ---------------------------------------------------------------------------
const RECIPIENT = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n8yslh0wxj0he7f6jw0ungfyzfzs72ux9sfaz398jnkqvqpfq3';

beforeEach(() => {
  jest.clearAllMocks();
  mockCmlOutputs = [];
  // Re-apply default return values after clearAllMocks
  mockToCBOR.mockReturnValue(MOCK_CBOR);
  mockComplete2.mockResolvedValue({ toCBOR: mockToCBOR });
  mockWithWallet.mockReturnValue({ complete: mockComplete2 });
  mockComplete1.mockResolvedValue({ sign: { withWallet: mockWithWallet } });
  mockPayToAddress.mockReturnValue({ complete: mockComplete1 });
  mockNewTx.mockReturnValue({ pay: { ToAddress: mockPayToAddress } });
  mockLucid.mockResolvedValue(mockLucidInstance);
  mockFromCborHex.mockImplementation(() => buildMockCmlTx());
  mockScriptHashFromHex.mockReturnValue({});
  mockAssetNameFromHex.mockReturnValue({});
});

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

describe('token constants', () => {
  it('all policy IDs are 56 hex chars (28 bytes)', () => {
    expect(IUSD_POLICY_ID).toHaveLength(56);
    expect(USDM_POLICY_ID).toHaveLength(56);
    expect(DJED_POLICY_ID).toHaveLength(56);
    expect(USDCX_POLICY_ID).toHaveLength(56);
  });

  it('KNOWN_CARDANO_TOKENS contains all 4 stablecoins', () => {
    const symbols = Object.values(KNOWN_CARDANO_TOKENS).map((t) => t.symbol);
    expect(symbols).toContain('iUSD');
    expect(symbols).toContain('USDM');
    expect(symbols).toContain('DJED');
    expect(symbols).toContain('USDCx');
  });

  it('KNOWN_CARDANO_TOKENS keys equal policyId + assetNameHex', () => {
    for (const [key, token] of Object.entries(KNOWN_CARDANO_TOKENS)) {
      expect(key).toBe(token.policyId + token.assetNameHex);
    }
  });

  it('all known tokens have decimals: 6', () => {
    for (const token of Object.values(KNOWN_CARDANO_TOKENS)) {
      expect(token.decimals).toBe(6);
    }
  });

  it('USDM uses CIP-68 asset name prefix 0014df10', () => {
    expect(USDM_ASSET_HEX.startsWith('0014df10')).toBe(true);
  });

  it('DJED asset name decodes to DjedMicroUSD', () => {
    expect(Buffer.from(DJED_ASSET_HEX, 'hex').toString('utf8')).toBe('DjedMicroUSD');
  });

  it('USDCx asset name decodes to USDCx', () => {
    expect(Buffer.from(USDCX_ASSET_HEX, 'hex').toString('utf8')).toBe('USDCx');
  });

  it('MIN_ADA_LOVELACE is 2_000_000n', () => {
    expect(MIN_ADA_LOVELACE).toBe(2_000_000n);
  });
});

// ---------------------------------------------------------------------------
// detectNetwork
// ---------------------------------------------------------------------------

describe('detectNetwork', () => {
  it('detects preprod from addr_test1 prefix', () => {
    expect(detectNetwork('addr_test1abc')).toBe('cardano-preprod');
  });

  it('detects mainnet from addr1 prefix', () => {
    expect(detectNetwork('addr1abc')).toBe('cardano');
  });

  it('defaults to mainnet for unknown prefixes', () => {
    expect(detectNetwork('unknown')).toBe('cardano');
  });
});

// ---------------------------------------------------------------------------
// signCardanoPayment
// ---------------------------------------------------------------------------

describe('signCardanoPayment', () => {
  const BASE = {
    seed: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    toAddress: RECIPIENT,
    amount: 5_000_000n,
    blockfrostProjectId: 'mainnetXXXX',
  };

  it('returns payload with the signed tx CBOR', async () => {
    const payload = await signCardanoPayment(BASE);
    expect(payload.transaction).toBe(MOCK_CBOR);
  });

  it('initialises Lucid with Mainnet by default', async () => {
    await signCardanoPayment(BASE);
    expect(mockLucid).toHaveBeenCalledWith(expect.anything(), 'Mainnet');
  });

  it('initialises Lucid with Preprod when specified', async () => {
    await signCardanoPayment({ ...BASE, network: 'Preprod' });
    expect(mockLucid).toHaveBeenCalledWith(expect.anything(), 'Preprod');
  });

  it('selects wallet from seed phrase', async () => {
    await signCardanoPayment(BASE);
    expect(mockFromSeed).toHaveBeenCalledWith(BASE.seed);
  });

  it('pays ADA using lovelace asset key', async () => {
    await signCardanoPayment({ ...BASE, token: 'ADA' });
    expect(mockPayToAddress).toHaveBeenCalledWith(RECIPIENT, { lovelace: 5_000_000n });
  });

  it('pays USDM with token unit and min-ADA alongside', async () => {
    await signCardanoPayment({ ...BASE, token: 'USDM', amount: 10_000_000n });
    const [addr, assets] = (mockPayToAddress as jest.Mock).mock.calls[0] as [string, Record<string, bigint>];
    expect(addr).toBe(RECIPIENT);
    expect(assets['lovelace']).toBe(MIN_ADA_LOVELACE);
    expect(assets[`${USDM_POLICY_ID}${USDM_ASSET_HEX}`]).toBe(10_000_000n);
  });

  it('pays DJED with token unit and min-ADA alongside', async () => {
    await signCardanoPayment({ ...BASE, token: 'DJED', amount: 20_000_000n });
    const [, assets] = (mockPayToAddress as jest.Mock).mock.calls[0] as [string, Record<string, bigint>];
    expect(assets['lovelace']).toBe(MIN_ADA_LOVELACE);
    expect(assets[`${DJED_POLICY_ID}${DJED_ASSET_HEX}`]).toBe(20_000_000n);
  });

  it('chains newTx → pay.ToAddress → complete → sign.withWallet → complete → toCBOR', async () => {
    await signCardanoPayment(BASE);
    expect(mockNewTx).toHaveBeenCalled();
    expect(mockPayToAddress).toHaveBeenCalled();
    expect(mockComplete1).toHaveBeenCalled();
    expect(mockWithWallet).toHaveBeenCalled();
    expect(mockComplete2).toHaveBeenCalled();
    expect(mockToCBOR).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// verifyCardanoPayment
// ---------------------------------------------------------------------------

describe('verifyCardanoPayment', () => {
  const PAYLOAD = { transaction: MOCK_CBOR };

  it('returns INVALID_CBOR when CBOR cannot be parsed', async () => {
    mockFromCborHex.mockImplementationOnce(() => { throw new Error('bad cbor'); });
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INVALID_CBOR');
  });

  it('returns OUTPUT_MISMATCH when outputs list is empty', async () => {
    mockCmlOutputs = [];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUTPUT_MISMATCH');
  });

  it('returns OUTPUT_MISMATCH when output goes to wrong address', async () => {
    mockCmlOutputs = [{ address: 'addr1wrongaddress', lovelace: 5_000_000n }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUTPUT_MISMATCH');
  });

  it('returns OUTPUT_MISMATCH when ADA output is below expected', async () => {
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: 1_000_000n }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUTPUT_MISMATCH');
  });

  it('accepts valid ADA payment (exact amount)', async () => {
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: 2_000_000n }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts valid ADA payment (surplus)', async () => {
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: 10_000_000n }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 2_000_000n);
    expect(result.valid).toBe(true);
  });

  it('accepts valid USDM token payment', async () => {
    const unit = `${USDM_POLICY_ID}${USDM_ASSET_HEX}`;
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: MIN_ADA_LOVELACE, tokenAmounts: new Map([[unit, 5_000_000n]]) }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'USDM');
    expect(result.valid).toBe(true);
  });

  it('rejects USDM payment with insufficient token amount', async () => {
    const unit = `${USDM_POLICY_ID}${USDM_ASSET_HEX}`;
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: MIN_ADA_LOVELACE, tokenAmounts: new Map([[unit, 1_000_000n]]) }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'USDM');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUTPUT_MISMATCH');
  });

  it('rejects DJED payment when lovelace is below min-ADA', async () => {
    const unit = `${DJED_POLICY_ID}${DJED_ASSET_HEX}`;
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: 1_000_000n, tokenAmounts: new Map([[unit, 10_000_000n]]) }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 10_000_000n, 'DJED');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('OUTPUT_MISMATCH');
  });

  it('accepts valid DJED payment with sufficient lovelace and token amount', async () => {
    const unit = `${DJED_POLICY_ID}${DJED_ASSET_HEX}`;
    mockCmlOutputs = [{ address: RECIPIENT, lovelace: MIN_ADA_LOVELACE, tokenAmounts: new Map([[unit, 10_000_000n]]) }];
    const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 10_000_000n, 'DJED');
    expect(result.valid).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Blockfrost submission
  // -------------------------------------------------------------------------

  describe('Blockfrost submission', () => {
    const realFetch = global.fetch;

    beforeEach(() => {
      mockCmlOutputs = [{ address: RECIPIENT, lovelace: 5_000_000n }];
    });

    afterEach(() => {
      global.fetch = realFetch;
    });

    it('submits tx and returns txHash on success', async () => {
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
        new Response(`"${MOCK_TX_HASH}"`, { status: 200 }),
      );
      const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'ADA', 'proj123');
      expect(result.valid).toBe(true);
      expect(result.txHash).toBe(MOCK_TX_HASH);
    });

    it('posts to the correct Mainnet Blockfrost endpoint with project_id header', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit = {};
      global.fetch = jest.fn<typeof fetch>().mockImplementation(async (input, init) => {
        capturedUrl  = input as string;
        capturedInit = init ?? {};
        return new Response(`"${MOCK_TX_HASH}"`, { status: 200 });
      });
      await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'ADA', 'proj123', 'Mainnet');
      expect(capturedUrl).toContain('cardano-mainnet.blockfrost.io');
      expect(capturedUrl).toContain('/tx/submit');
      expect((capturedInit.headers as Record<string, string>)['project_id']).toBe('proj123');
      expect(capturedInit.method).toBe('POST');
    });

    it('posts to the correct Preprod Blockfrost endpoint', async () => {
      let capturedUrl = '';
      global.fetch = jest.fn<typeof fetch>().mockImplementation(async (input) => {
        capturedUrl = input as string;
        return new Response(`"${MOCK_TX_HASH}"`, { status: 200 });
      });
      await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'ADA', 'proj123', 'Preprod');
      expect(capturedUrl).toContain('cardano-preprod.blockfrost.io');
    });

    it('returns SUBMIT_FAILED on non-ok Blockfrost response', async () => {
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
        new Response('{"error":"invalid tx"}', { status: 400 }),
      );
      const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'ADA', 'proj123');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/SUBMIT_FAILED/);
    });

    it('returns SUBMIT_ERROR when fetch throws', async () => {
      global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('network down'));
      const result = await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n, 'ADA', 'proj123');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/SUBMIT_ERROR/);
    });

    it('does not call fetch when blockfrostProjectId is absent', async () => {
      const mockFetch = jest.fn<typeof fetch>();
      global.fetch = mockFetch;
      await verifyCardanoPayment(PAYLOAD, RECIPIENT, 5_000_000n);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
