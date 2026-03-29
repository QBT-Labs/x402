import { describe, it, expect, afterEach } from '@jest/globals';
import { randomBytes } from 'crypto';
import {
  signCardanoPayment,
  verifyCardanoPayment,
  detectNetwork,
  IUSD_POLICY_ID,
  USDM_POLICY_ID,
  DJED_POLICY_ID,
  USDCX_POLICY_ID,
  KNOWN_CARDANO_TOKENS,
  type CardanoPaymentPayload,
} from '../chains/cardano.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrivateKey(): Uint8Array {
  return randomBytes(32);
}

const FROM = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n8yslh0wxj0he7f6jw0ungfyzfzs72ux9sfaz398jnkqvqpfq3';
const TO   = 'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw96yrmyjzqqng3qkqkc3hqpj2w5p3ykqm7c3qfzx';

async function makePayload(
  privateKey: Uint8Array,
  overrides: Partial<SignParams> = {},
): Promise<CardanoPaymentPayload> {
  return signCardanoPayment({
    privateKey,
    fromAddress: FROM,
    toAddress: TO,
    amountLovelace: 2_000_000n,
    network: 'cardano',
    ...overrides,
  });
}

interface SignParams {
  privateKey: Uint8Array;
  fromAddress: string;
  toAddress: string;
  amountLovelace: bigint;
  network: 'cardano' | 'cardano-preprod';
}

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

describe('token constants', () => {
  it('exports policy ID constants', () => {
    // All Cardano policy IDs are Blake2b-224 script hashes: 28 bytes = 56 hex chars
    expect(IUSD_POLICY_ID).toHaveLength(56);
    expect(USDM_POLICY_ID).toHaveLength(56);
    expect(DJED_POLICY_ID).toHaveLength(56);
    expect(USDCX_POLICY_ID).toHaveLength(56);
  });

  it('KNOWN_CARDANO_TOKENS contains all 4 tokens', () => {
    const symbols = Object.values(KNOWN_CARDANO_TOKENS).map((t) => t.symbol);
    expect(symbols).toContain('iUSD');
    expect(symbols).toContain('USDM');
    expect(symbols).toContain('DJED');
    expect(symbols).toContain('USDCx');
  });

  it('KNOWN_CARDANO_TOKENS keys are policy_id + asset_name_hex', () => {
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
    const usdm = KNOWN_CARDANO_TOKENS[`${USDM_POLICY_ID}0014df105553444d`];
    expect(usdm).toBeDefined();
    expect(usdm.assetNameHex).toBe('0014df105553444d');
  });

  it('DJED asset name hex 446a65644d6963726f555344 decodes to DjedMicroUSD', () => {
    const djed = KNOWN_CARDANO_TOKENS[`${DJED_POLICY_ID}446a65644d6963726f555344`];
    expect(djed).toBeDefined();
    const decoded = Buffer.from(djed.assetNameHex, 'hex').toString('utf8');
    expect(decoded).toBe('DjedMicroUSD');
  });

  it('USDCx asset name decodes to USDCx', () => {
    const usdcx = KNOWN_CARDANO_TOKENS[`${USDCX_POLICY_ID}5553444378`];
    expect(usdcx).toBeDefined();
    const decoded = Buffer.from(usdcx.assetNameHex, 'hex').toString('utf8');
    expect(decoded).toBe('USDCx');
  });
});

// ---------------------------------------------------------------------------
// signCardanoPayment
// ---------------------------------------------------------------------------

describe('signCardanoPayment', () => {
  it('returns a payload with all required fields', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);

    expect(payload.from_address).toBe(FROM);
    expect(payload.to_address).toBe(TO);
    expect(payload.amount_lovelace).toBe('2000000');
    expect(payload.network).toBe('cardano');
    expect(payload.nonce).toHaveLength(64); // 32 bytes → 64 hex chars
    expect(typeof payload.deadline).toBe('number');
    expect(payload.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(payload.public_key).toHaveLength(64);
  });

  it('sets deadline ~300 s in the future', async () => {
    const privateKey = makePrivateKey();
    const before = Math.floor(Date.now() / 1000);
    const payload = await makePayload(privateKey, { network: 'cardano-preprod' });
    const after = Math.floor(Date.now() / 1000);
    expect(payload.deadline).toBeGreaterThanOrEqual(before + 299);
    expect(payload.deadline).toBeLessThanOrEqual(after + 301);
  });

  it('includes iUSD token field when provided', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 2_000_000n,
      token: {
        policyId: IUSD_POLICY_ID,
        assetName: '69555344',
        amount: 1_000_000n,
      },
      network: 'cardano',
    });

    expect(payload.token).toBeDefined();
    expect(payload.token?.policy_id).toBe(IUSD_POLICY_ID);
    expect(payload.token?.asset_name).toBe('69555344');
    expect(payload.token?.amount).toBe('1000000');
  });

  it('includes USDM token field when provided', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 2_000_000n,
      token: {
        policyId: USDM_POLICY_ID,
        assetName: '0014df105553444d',
        amount: 5_000_000n,
      },
      network: 'cardano',
    });

    expect(payload.token?.policy_id).toBe(USDM_POLICY_ID);
    expect(payload.token?.asset_name).toBe('0014df105553444d');
    expect(payload.token?.amount).toBe('5000000');
  });

  it('includes DJED token field when provided', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: 'addr_test1abc',
      toAddress: 'addr_test1def',
      amountLovelace: 2_000_000n,
      token: {
        policyId: DJED_POLICY_ID,
        assetName: '446a65644d6963726f555344',
        amount: 10_000_000n,
      },
      network: 'cardano-preprod',
    });

    expect(payload.token?.policy_id).toBe(DJED_POLICY_ID);
    expect(payload.token?.asset_name).toBe('446a65644d6963726f555344');
    expect(payload.token?.amount).toBe('10000000');
    expect(payload.network).toBe('cardano-preprod');
  });
});

// ---------------------------------------------------------------------------
// verifyCardanoPayment
// ---------------------------------------------------------------------------

describe('verifyCardanoPayment', () => {
  const realDateNow = Date.now;
  afterEach(() => { Date.now = realDateNow; });

  it('accepts a valid ADA payload', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('accepts a valid USDM token payload', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 2_000_000n,
      token: {
        policyId: USDM_POLICY_ID,
        assetName: '0014df105553444d',
        amount: 5_000_000n,
      },
      network: 'cardano',
    });
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(true);
  });

  it('accepts a valid DJED token payload', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 2_000_000n,
      token: {
        policyId: DJED_POLICY_ID,
        assetName: '446a65644d6963726f555344',
        amount: 10_000_000n,
      },
      network: 'cardano',
    });
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(true);
  });

  it('rejects an expired deadline', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    Date.now = () => (payload.deadline + 10) * 1000;
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('rejects insufficient lovelace amount', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const result = await verifyCardanoPayment(payload, 5_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient');
  });

  it('rejects USDM payload with insufficient lovelace for min-ADA', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 1_000_000n, // below 2 ADA min
      token: {
        policyId: USDM_POLICY_ID,
        assetName: '0014df105553444d',
        amount: 5_000_000n,
      },
      network: 'cardano',
    });
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient');
  });

  it('rejects an invalid signature', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const tampered: CardanoPaymentPayload = {
      ...payload,
      signature: 'a'.repeat(128),
    };
    const result = await verifyCardanoPayment(tampered, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects payload where amount was tampered after signing', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const tampered: CardanoPaymentPayload = { ...payload, amount_lovelace: '1000' };
    const result = await verifyCardanoPayment(tampered, 1n);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects USDM payload where token amount was tampered after signing', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: FROM,
      toAddress: TO,
      amountLovelace: 2_000_000n,
      token: {
        policyId: USDM_POLICY_ID,
        assetName: '0014df105553444d',
        amount: 5_000_000n,
      },
      network: 'cardano',
    });
    const tampered: CardanoPaymentPayload = {
      ...payload,
      token: { ...payload.token!, amount: '999999999' },
    };
    const result = await verifyCardanoPayment(tampered, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  describe('Blockfrost balance checks', () => {
    it('passes when Blockfrost returns sufficient ADA balance', async () => {
      const privateKey = makePrivateKey();
      const payload = await makePayload(privateKey);

      // Stub fetch to return adequate lovelace balance
      const originalFetch = global.fetch;
      global.fetch = async () =>
        new Response(
          JSON.stringify({ amount: [{ unit: 'lovelace', quantity: '10000000' }] }),
          { status: 200 },
        );
      try {
        const result = await verifyCardanoPayment(payload, 2_000_000n, 'test-project-id');
        expect(result.valid).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects when Blockfrost shows insufficient ADA', async () => {
      const privateKey = makePrivateKey();
      const payload = await makePayload(privateKey);

      const originalFetch = global.fetch;
      global.fetch = async () =>
        new Response(
          JSON.stringify({ amount: [{ unit: 'lovelace', quantity: '1000000' }] }),
          { status: 200 },
        );
      try {
        const result = await verifyCardanoPayment(payload, 2_000_000n, 'test-project-id');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Insufficient on-chain ADA');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('passes USDM token payment when Blockfrost shows sufficient token + ADA balance', async () => {
      const privateKey = makePrivateKey();
      const usdmUnit = `${USDM_POLICY_ID}0014df105553444d`;
      const payload = await signCardanoPayment({
        privateKey,
        fromAddress: FROM,
        toAddress: TO,
        amountLovelace: 2_000_000n,
        token: {
          policyId: USDM_POLICY_ID,
          assetName: '0014df105553444d',
          amount: 5_000_000n,
        },
        network: 'cardano',
      });

      const originalFetch = global.fetch;
      global.fetch = async () =>
        new Response(
          JSON.stringify({
            amount: [
              { unit: 'lovelace', quantity: '5000000' },
              { unit: usdmUnit, quantity: '10000000' },
            ],
          }),
          { status: 200 },
        );
      try {
        const result = await verifyCardanoPayment(payload, 2_000_000n, 'test-project-id');
        expect(result.valid).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects DJED token payment when Blockfrost shows insufficient token balance', async () => {
      const privateKey = makePrivateKey();
      const djedUnit = `${DJED_POLICY_ID}446a65644d6963726f555344`;
      const payload = await signCardanoPayment({
        privateKey,
        fromAddress: FROM,
        toAddress: TO,
        amountLovelace: 2_000_000n,
        token: {
          policyId: DJED_POLICY_ID,
          assetName: '446a65644d6963726f555344',
          amount: 10_000_000n,
        },
        network: 'cardano',
      });

      const originalFetch = global.fetch;
      global.fetch = async () =>
        new Response(
          JSON.stringify({
            amount: [
              { unit: 'lovelace', quantity: '5000000' },
              { unit: djedUnit, quantity: '1000000' }, // only 1 DJED, need 10
            ],
          }),
          { status: 200 },
        );
      try {
        const result = await verifyCardanoPayment(payload, 2_000_000n, 'test-project-id');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Insufficient on-chain token balance');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('returns error when Blockfrost request fails', async () => {
      const privateKey = makePrivateKey();
      const payload = await makePayload(privateKey);

      const originalFetch = global.fetch;
      global.fetch = async () => new Response('{}', { status: 403 });
      try {
        const result = await verifyCardanoPayment(payload, 2_000_000n, 'bad-project-id');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Could not fetch balance');
      } finally {
        global.fetch = originalFetch;
      }
    });
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
