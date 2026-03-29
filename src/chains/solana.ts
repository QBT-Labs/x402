/**
 * Solana Chain Support — Partially Signed Transaction (PST) pattern
 *
 * SPL tokens have no native transferWithAuthorization equivalent (unlike EVM EIP-3009).
 * x402 on Solana works via Partially Signed Transactions:
 *
 *   Client:
 *     1. Build a VersionedTransaction with 4 instructions in strict order:
 *        [ComputeLimit, ComputePrice, TransferChecked, Memo]
 *     2. Set the FACILITATOR as fee payer — the user does not need SOL for gas
 *     3. Partially sign with the client keypair only (fee payer signature is missing)
 *     4. Serialize to base64, include as X-Payment header payload
 *
 *   Facilitator (server):
 *     1. Deserialize and validate the transaction structure
 *     2. Verify the instruction layout and transfer details match payment requirements
 *     3. Add fee payer (facilitator) signature
 *     4. Submit to the Solana network and confirm
 *
 * The user's wallet must hold sufficient USDC. The facilitator covers SOL fees.
 * Wire format is compatible with the x402 standard (x402.org/facilitator and
 * facilitator.qbtlabs.io).
 */

import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  Connection,
  ComputeBudgetProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getConfig, USDC_CONTRACTS } from '../config.js';

const USDC_DECIMALS = 6;
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const RPC_MAINNET = 'https://api.mainnet-beta.solana.com';
const RPC_DEVNET = 'https://api.devnet.solana.com';

// ComputeBudget program ID (base58)
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

// Instruction discriminators
const COMPUTE_LIMIT_DISCRIMINATOR = 2;   // SetComputeUnitLimit
const COMPUTE_PRICE_DISCRIMINATOR = 3;   // SetComputeUnitPrice
const TRANSFER_CHECKED_DISCRIMINATOR = 12;
const TRANSFER_CHECKED_DATA_LEN = 10;    // [discriminator(1), amount(8 LE), decimals(1)]

// Spec constraints
const MAX_COMPUTE_UNIT_PRICE = 5_000_000n; // microlamports cap per x402 spec
const MIN_INSTRUCTIONS = 3;
const MAX_INSTRUCTIONS = 6;

export interface SolanaPaymentPayload {
  transaction: string; // base64-encoded partially-signed Solana VersionedTransaction
}

/**
 * Build and partially sign a Solana VersionedTransaction for a USDC payment.
 *
 * Instruction layout (strict order, required by x402 spec):
 *   [0] ComputeBudgetProgram.setComputeUnitLimit
 *   [1] ComputeBudgetProgram.setComputeUnitPrice
 *   [2] SPL TransferChecked (USDC transfer)
 *   [3] Memo with 16-byte random nonce (for replay protection / uniqueness)
 *
 * The facilitator is set as fee payer so the sender does not need SOL for gas.
 * Only the client signature is applied — the fee payer signature must be added
 * by the facilitator before the transaction can be submitted to the network.
 *
 * @param params.privateKey  64-byte Solana keypair (Solana convention: seed + public key)
 * @param params.to          merchant base58 pubkey (USDC recipient)
 * @param params.amount      payment amount in USD (converted to 6-decimal USDC units)
 * @param params.network     CAIP-2 or human-readable network (e.g. 'solana:mainnet')
 * @param params.feePayer    facilitator base58 pubkey — received from payment requirements
 * @param params.rpcUrl      optional RPC endpoint override
 */
export async function signSolanaPayment(params: {
  privateKey: Uint8Array;
  to: string;
  amount: number;
  network: string;
  feePayer: string;
  rpcUrl?: string;
}): Promise<SolanaPaymentPayload> {
  const { privateKey, to, amount, network, feePayer, rpcUrl } = params;

  if (privateKey.length !== 64) {
    throw new Error('privateKey must be 64 bytes (Solana keypair: seed + public key)');
  }

  const usdcMint = USDC_CONTRACTS[network];
  if (!usdcMint) {
    throw new Error(`Unsupported Solana network: ${network}`);
  }

  const isDevnet =
    network.includes('devnet') || network.includes('EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
  const rpcEndpoint = rpcUrl ?? (isDevnet ? RPC_DEVNET : RPC_MAINNET);

  const clientKeypair = Keypair.fromSecretKey(privateKey);
  const amountUnits = BigInt(Math.round(amount * 1_000_000));

  const mintPubkey = new PublicKey(usdcMint);
  const toPubkey = new PublicKey(to);
  const feePayerPubkey = new PublicKey(feePayer);

  const sourceATA = getAssociatedTokenAddressSync(mintPubkey, clientKeypair.publicKey);
  const destATA = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

  const connection = new Connection(rpcEndpoint, 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash();

  // 16-byte random nonce as hex — ensures transaction uniqueness for replay protection
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonceHex = Buffer.from(nonceBytes).toString('hex');

  // Strict instruction order per x402 spec
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(
      sourceATA,
      mintPubkey,
      destATA,
      clientKeypair.publicKey,
      amountUnits,
      USDC_DECIMALS,
    ),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(nonceHex, 'utf-8'),
    }),
  ];

  const message = new TransactionMessage({
    payerKey: feePayerPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([clientKeypair]); // partial sign — fee payer signature intentionally missing

  return {
    transaction: Buffer.from(tx.serialize()).toString('base64'),
  };
}

/**
 * Decoded fields from the TransferChecked instruction inside a PST.
 */
type DecodeResult =
  | {
      ok: true;
      source: string;
      mint: string;
      destination: string;
      authority: string;
      amount: bigint;
    }
  | { ok: false; error: string };

/**
 * Locate and decode the SPL TransferChecked instruction at a given index in a v0 transaction.
 */
function decodeTransferChecked(tx: VersionedTransaction, ixIndex: number): DecodeResult {
  const msg = tx.message as unknown as {
    staticAccountKeys?: PublicKey[];
    compiledInstructions?: Array<{
      programIdIndex: number;
      accountKeyIndexes: number[];
      data: Uint8Array;
    }>;
  };

  if (!msg.staticAccountKeys || !msg.compiledInstructions) {
    return { ok: false, error: 'Only v0 transactions are supported' };
  }

  const accountKeys = msg.staticAccountKeys;
  const instructions = msg.compiledInstructions;

  const ix = instructions[ixIndex];
  if (!ix) {
    return { ok: false, error: `No instruction at index ${ixIndex}` };
  }

  const programId = accountKeys[ix.programIdIndex];
  if (!programId?.equals(TOKEN_PROGRAM_ID)) {
    return { ok: false, error: `ix[${ixIndex}] is not SPL Token program` };
  }

  const data = Buffer.from(ix.data);
  if (data.length !== TRANSFER_CHECKED_DATA_LEN || data[0] !== TRANSFER_CHECKED_DISCRIMINATOR) {
    return {
      ok: false,
      error: `ix[${ixIndex}] is not TransferChecked (discriminator ${data[0]}, len ${data.length})`,
    };
  }

  if (ix.accountKeyIndexes.length < 4) {
    return { ok: false, error: 'TransferChecked: insufficient account indexes' };
  }

  const amount = data.readBigUInt64LE(1);
  const source = accountKeys[ix.accountKeyIndexes[0]]?.toBase58() ?? '';
  const mint = accountKeys[ix.accountKeyIndexes[1]]?.toBase58() ?? '';
  const destination = accountKeys[ix.accountKeyIndexes[2]]?.toBase58() ?? '';
  const authority = accountKeys[ix.accountKeyIndexes[3]]?.toBase58() ?? '';

  return { ok: true, source, mint, destination, authority, amount };
}

/**
 * Verify a Solana PST payment (structural validation only — no network calls).
 *
 * This function validates the PST against the payment requirements without
 * submitting to the network. Settlement (co-sign + submit) is the facilitator's
 * responsibility (x402.org/facilitator or facilitator.qbtlabs.io).
 *
 * Verification steps:
 *  1. Deserialize the base64 transaction
 *  2. Check instruction count is within bounds [3, 6]
 *  3. ix[0] must be ComputeBudgetProgram SetComputeUnitLimit
 *  4. ix[1] must be ComputeBudgetProgram SetComputeUnitPrice, price ≤ 5,000,000
 *  5. ix[2] must be SPL TransferChecked with correct mint
 *  6. Transfer amount must exactly equal the required amount (x402 'exact' scheme)
 *  7. Destination ATA must match the configured merchant address
 *
 * @param payment        The SolanaPaymentPayload from the X-Payment header
 * @param expectedAmount Expected payment amount in USD
 * @param network        CAIP-2 network identifier (e.g., 'solana:mainnet')
 */
export async function verifyPayment(
  payment: SolanaPaymentPayload,
  expectedAmount: number,
  network: string,
): Promise<{ valid: boolean; error?: string; payer?: string }> {
  const cfg = getConfig();

  // 1. Deserialize
  let tx: VersionedTransaction;
  try {
    const txBytes = Buffer.from(payment.transaction, 'base64');
    tx = VersionedTransaction.deserialize(txBytes);
  } catch {
    return { valid: false, error: 'Invalid transaction: deserialization failed' };
  }

  const msg = tx.message as unknown as {
    staticAccountKeys?: PublicKey[];
    compiledInstructions?: Array<{
      programIdIndex: number;
      accountKeyIndexes: number[];
      data: Uint8Array;
    }>;
  };

  if (!msg.staticAccountKeys || !msg.compiledInstructions) {
    return { valid: false, error: 'Only v0 transactions are supported' };
  }

  const accountKeys = msg.staticAccountKeys;
  const instructions = msg.compiledInstructions;

  // 2. Instruction count bounds check
  if (instructions.length < MIN_INSTRUCTIONS || instructions.length > MAX_INSTRUCTIONS) {
    return {
      valid: false,
      error: `Expected ${MIN_INSTRUCTIONS}-${MAX_INSTRUCTIONS} instructions, got ${instructions.length}`,
    };
  }

  // 3. ix[0] must be ComputeBudgetProgram SetComputeUnitLimit (discriminator 2)
  {
    const ix = instructions[0];
    const programId = accountKeys[ix.programIdIndex];
    if (programId?.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      return { valid: false, error: 'ix[0] must be ComputeBudgetProgram' };
    }
    const data = Buffer.from(ix.data);
    if (data[0] !== COMPUTE_LIMIT_DISCRIMINATOR) {
      return { valid: false, error: 'ix[0] must be SetComputeUnitLimit (discriminator 2)' };
    }
  }

  // 4. ix[1] must be ComputeBudgetProgram SetComputeUnitPrice (discriminator 3), price ≤ cap
  {
    const ix = instructions[1];
    const programId = accountKeys[ix.programIdIndex];
    if (programId?.toBase58() !== COMPUTE_BUDGET_PROGRAM_ID) {
      return { valid: false, error: 'ix[1] must be ComputeBudgetProgram' };
    }
    const data = Buffer.from(ix.data);
    if (data[0] !== COMPUTE_PRICE_DISCRIMINATOR) {
      return { valid: false, error: 'ix[1] must be SetComputeUnitPrice (discriminator 3)' };
    }
    if (data.length >= 9) {
      const price = data.readBigUInt64LE(1);
      if (price > MAX_COMPUTE_UNIT_PRICE) {
        return {
          valid: false,
          error: `Compute unit price ${price} exceeds cap of ${MAX_COMPUTE_UNIT_PRICE} microlamports`,
        };
      }
    }
  }

  // 5. Resolve expected USDC mint for this network
  const expectedMint = USDC_CONTRACTS[network];
  if (!expectedMint) {
    return { valid: false, error: `Unsupported Solana network: ${network}` };
  }

  // 6. ix[2] must be SPL TransferChecked with correct mint and exact amount
  const decoded = decodeTransferChecked(tx, 2);
  if (!decoded.ok) {
    return { valid: false, error: decoded.error };
  }
  const { mint: txMint, destination, amount: txAmount } = decoded;

  if (txMint !== expectedMint) {
    return { valid: false, error: `Wrong mint: expected ${expectedMint}, got ${txMint}` };
  }

  // Exact amount equality required by x402 'exact' scheme
  const requiredAmount = BigInt(Math.round(expectedAmount * 1_000_000));
  if (txAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${txAmount} < ${requiredAmount}` };
  }
  if (txAmount > requiredAmount) {
    return {
      valid: false,
      error: `Amount mismatch: expected ${requiredAmount}, got ${txAmount}`,
    };
  }

  // 7. Destination ATA must match the ATA derived from the configured merchant address
  if (!cfg.solana?.address) {
    return { valid: false, error: 'Solana address not configured' };
  }
  const expectedDestATA = getAssociatedTokenAddressSync(
    new PublicKey(expectedMint),
    new PublicKey(cfg.solana.address),
  ).toBase58();
  if (destination !== expectedDestATA) {
    return {
      valid: false,
      error: `Wrong destination ATA: expected ${expectedDestATA}, got ${destination}`,
    };
  }

  // Fee payer is always the first account key in a v0 transaction
  const payer = accountKeys[0]?.toBase58();

  return { valid: true, payer };
}
