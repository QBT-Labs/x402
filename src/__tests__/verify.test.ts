import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { parsePaymentHeader, verifyPayment, PaymentPayload } from '../verify.js';
import { verifyPayment as verifyEvmPayment } from '../chains/evm.js';
import { verifyPayment as verifySolanaPayment } from '../chains/solana.js';
import { configure } from '../config.js';

describe('x402 Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    process.env.X402_SOLANA_ADDRESS = 'SoLAddressHere123456789012345678901234567890';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validEvmPayload: PaymentPayload = {
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
      scheme: 'exact',
      network: 'eip155:8453',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '10000',
      payTo: '0x1234567890123456789012345678901234567890',
    },
  };

  const validSolanaPayload: PaymentPayload = {
    x402Version: 1,
    payload: {
      signature: 'ab'.repeat(64), // 128-char hex Ed25519 signature (basic mode: format only)
      from: 'SenderPubkeyBase58Address',
      to: 'SoLAddressHere123456789012345678901234567890',
      amount: '10000',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      nonce: '00'.repeat(32),
      validBefore: Math.floor(Date.now() / 1000) + 3600,
      network: 'solana',
    },
    accepted: {
      scheme: 'exact',
      network: 'solana:mainnet',
      asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '10000',
      payTo: 'SoLAddressHere123456789012345678901234567890',
    },
  };

  describe('parsePaymentHeader', () => {
    it('parses valid base64-encoded payment', () => {
      const encoded = Buffer.from(JSON.stringify(validEvmPayload)).toString('base64');
      const parsed = parsePaymentHeader(encoded);
      expect(parsed).not.toBeNull();
      expect(parsed?.x402Version).toBe(1);
      expect(parsed?.accepted.network).toBe('eip155:8453');
    });

    it('returns null for invalid base64', () => {
      const parsed = parsePaymentHeader('not-valid-base64!!!');
      expect(parsed).toBeNull();
    });

    it('returns null for non-JSON content', () => {
      const encoded = Buffer.from('not json').toString('base64');
      const parsed = parsePaymentHeader(encoded);
      expect(parsed).toBeNull();
    });
  });

  describe('verifyEvmPayment', () => {
    it('accepts valid payment with sufficient amount', async () => {
      const result = await verifyEvmPayment(validEvmPayload.payload as any, 0.01);
      expect(result.valid).toBe(true);
    });

    it('rejects payment with insufficient amount', async () => {
      const result = await verifyEvmPayment(validEvmPayload.payload as any, 0.02);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('rejects payment to wrong recipient', async () => {
      const wrongRecipient = {
        ...validEvmPayload.payload,
        authorization: {
          ...(validEvmPayload.payload as any).authorization,
          to: '0xwrongaddress',
        },
      };
      const result = await verifyEvmPayment(wrongRecipient as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('recipient');
    });

    it('rejects expired payment', async () => {
      const expired = {
        ...validEvmPayload.payload,
        authorization: {
          ...(validEvmPayload.payload as any).authorization,
          validBefore: String(Math.floor(Date.now() / 1000) - 3600),
        },
      };
      const result = await verifyEvmPayment(expired as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('rejects payment not yet valid', async () => {
      const future = {
        ...validEvmPayload.payload,
        authorization: {
          ...(validEvmPayload.payload as any).authorization,
          validAfter: String(Math.floor(Date.now() / 1000) + 3600),
        },
      };
      const result = await verifyEvmPayment(future as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not yet valid');
    });

    it('rejects invalid signature format', async () => {
      const invalidSig = {
        ...validEvmPayload.payload,
        signature: 'invalid',
      };
      const result = await verifyEvmPayment(invalidSig as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature format');
    });
  });

  describe('verifySolanaPayment', () => {
    it('accepts valid Solana payment', async () => {
      const result = await verifySolanaPayment(validSolanaPayload.payload as any, 0.01);
      expect(result.valid).toBe(true);
    });

    it('rejects insufficient amount', async () => {
      const result = await verifySolanaPayment(validSolanaPayload.payload as any, 0.02);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('rejects wrong recipient', async () => {
      const wrongRecipient = {
        ...validSolanaPayload.payload,
        to: 'WrongAddress',
      };
      const result = await verifySolanaPayment(wrongRecipient as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('recipient');
    });
  });

  describe('verifyPayment', () => {
    it('routes EVM payments correctly', async () => {
      const result = await verifyPayment(validEvmPayload, 0.01);
      expect(result.valid).toBe(true);
    });

    it('routes Solana payments correctly', async () => {
      const result = await verifyPayment(validSolanaPayload, 0.01);
      expect(result.valid).toBe(true);
    });

    it('rejects unsupported networks', async () => {
      const unsupported = {
        ...validEvmPayload,
        accepted: { ...validEvmPayload.accepted, network: 'bitcoin:mainnet' },
      };
      const result = await verifyPayment(unsupported, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported');
    });

    it('rejects invalid Cardano payload', async () => {
      const cardano = {
        ...validEvmPayload,
        accepted: { ...validEvmPayload.accepted, network: 'cardano:mainnet' },
      };
      const result = await verifyPayment(cardano, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('INVALID_CBOR');
    });
  });
});
