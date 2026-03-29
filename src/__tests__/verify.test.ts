import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { parsePaymentHeader, verifyPayment, type PaymentPayload } from '../verify.js';
import { verifyPayment as verifyEvmPayment } from '../chains/evm.js';
import {
  verifyPayment as verifySolanaPayment,
  type SolanaPaymentPayload,
} from '../chains/solana.js';
import { resetConfig } from '../config.js';
import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

// ---------------------------------------------------------------------------
// Deterministic test keypairs (fixed seeds for reproducibility)
// ---------------------------------------------------------------------------
const merchantKeypair = Keypair.fromSeed(Buffer.alloc(32).fill(0x01));
const clientKeypair = Keypair.fromSeed(Buffer.alloc(32).fill(0x02));
const facilitatorKeypair = Keypair.fromSeed(Buffer.alloc(32).fill(0x03));

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Any valid base58 32-byte value works as blockhash for unit tests (not submitted)
const FAKE_BLOCKHASH = new PublicKey(Buffer.alloc(32).fill(0x01)).toBase58();

/**
 * Build a partially-signed test PST without hitting the network.
 * Includes the full x402-required instruction layout:
 *   [0] ComputeUnitLimit, [1] ComputeUnitPrice, [2] TransferChecked, [3] Memo
 */
function buildTestPST(
  amount: bigint,
  destOwner: PublicKey = merchantKeypair.publicKey,
): SolanaPaymentPayload {
  const sourceATA = getAssociatedTokenAddressSync(USDC_MINT, clientKeypair.publicKey);
  const destATA = getAssociatedTokenAddressSync(USDC_MINT, destOwner);

  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(
      sourceATA,
      USDC_MINT,
      destATA,
      clientKeypair.publicKey,
      amount,
      6,
    ),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from('deadbeefcafebabe0011223344556677', 'utf-8'),
    }),
  ];

  const message = new TransactionMessage({
    payerKey: facilitatorKeypair.publicKey,
    recentBlockhash: FAKE_BLOCKHASH,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([clientKeypair]);

  return {
    transaction: Buffer.from(tx.serialize()).toString('base64'),
  };
}

// Build the canonical valid payload once at module level
const validSolanaInner = buildTestPST(10000n);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('x402 Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.X402_EVM_ADDRESS = '0x1234567890123456789012345678901234567890';
    // Use the actual merchant pubkey so ATA derivation matches in tests
    process.env.X402_SOLANA_ADDRESS = merchantKeypair.publicKey.toBase58();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
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
    payload: validSolanaInner,
    accepted: {
      scheme: 'exact',
      network: 'solana:mainnet',
      asset: USDC_MINT.toBase58(),
      amount: '10000',
      payTo: merchantKeypair.publicKey.toBase58(),
    },
  };

  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
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
      const invalidSig = { ...validEvmPayload.payload, signature: 'invalid' };
      const result = await verifyEvmPayment(invalidSig as any, 0.01);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature format');
    });
  });

  // -------------------------------------------------------------------------
  describe('verifySolanaPayment', () => {
    it('accepts valid PST with sufficient amount', async () => {
      const result = await verifySolanaPayment(validSolanaInner, 0.01, 'solana:mainnet');
      expect(result.valid).toBe(true);
    });

    it('rejects transaction with insufficient amount', async () => {
      // Build PST with 5000 units ($0.005) and require $0.01
      const smallPayload = buildTestPST(5000n);
      const result = await verifySolanaPayment(smallPayload, 0.01, 'solana:mainnet');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient');
    });

    it('rejects transaction with wrong destination ATA', async () => {
      // Build PST paying a different merchant
      const wrongMerchant = Keypair.fromSeed(Buffer.alloc(32).fill(0x04)).publicKey;
      const wrongPayload = buildTestPST(10000n, wrongMerchant);
      const result = await verifySolanaPayment(wrongPayload, 0.01, 'solana:mainnet');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('destination ATA');
    });

    it('rejects malformed base64 transaction', async () => {
      const badPayload: SolanaPaymentPayload = { transaction: 'not!!valid!!base64' };
      const result = await verifySolanaPayment(badPayload, 0.01, 'solana:mainnet');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('deserialization');
    });

    it('rejects transaction with wrong USDC mint', async () => {
      // Pass devnet network — mint check will fail because tx uses mainnet USDC
      const result = await verifySolanaPayment(validSolanaInner, 0.01, 'solana:devnet');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Wrong mint');
    });
  });

  // -------------------------------------------------------------------------
  describe('verifyPayment (routing)', () => {
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
