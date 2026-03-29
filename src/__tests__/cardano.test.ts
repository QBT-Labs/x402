import { describe, it, expect, afterEach } from '@jest/globals';
import { randomBytes } from 'crypto';
import {
  signCardanoPayment,
  verifyCardanoPayment,
  detectNetwork,
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

  it('includes token field when provided', async () => {
    const privateKey = makePrivateKey();
    const payload = await signCardanoPayment({
      privateKey,
      fromAddress: 'addr_test1abc',
      toAddress: 'addr_test1def',
      amountLovelace: 2_000_000n,
      token: {
        policyId: 'f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12',
        assetName: '69555344',
        amount: 1_000_000n,
      },
      network: 'cardano-preprod',
    });

    expect(payload.token).toBeDefined();
    expect(payload.token?.policy_id).toBe('f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12');
    expect(payload.token?.asset_name).toBe('69555344');
    expect(payload.token?.amount).toBe('1000000');
  });
});

// ---------------------------------------------------------------------------
// verifyCardanoPayment
// ---------------------------------------------------------------------------

describe('verifyCardanoPayment', () => {
  const realDateNow = Date.now;
  afterEach(() => { Date.now = realDateNow; });

  it('accepts a valid payload', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects an expired deadline', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    // Advance clock past the deadline so verification sees it as expired
    Date.now = () => (payload.deadline + 10) * 1000;
    const result = await verifyCardanoPayment(payload, 2_000_000n);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('rejects insufficient amount', async () => {
    const privateKey = makePrivateKey();
    const payload = await makePayload(privateKey);
    const result = await verifyCardanoPayment(payload, 5_000_000n);
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
    // Tamper amount — signature no longer covers this value
    const tampered: CardanoPaymentPayload = { ...payload, amount_lovelace: '1000' };
    const result = await verifyCardanoPayment(tampered, 1n);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
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
