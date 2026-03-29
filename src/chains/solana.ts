/**
 * Solana Chain Support — Partially Signed Transaction (PST) pattern
 *
 * SPL tokens have no native transferWithAuthorization equivalent (unlike EVM EIP-3009).
 * x402 on Solana works via Partially Signed Transactions:
 *
 *   Client:
 *     1. Build a VersionedTransaction containing an SPL TransferChecked instruction
 *     2. Set the FACILITATOR as fee payer — the user does not need SOL for gas
 *     3. Partially sign with the client keypair only (fee payer signature is missing)
 *     4. Serialize to base64, include as X-Payment header payload
 *
 *   Facilitator (server):
 *     1. Deserialize and validate the transaction structure
 *     2. Verify the transfer instruction matches payment requirements
 *     3. Add fee payer (facilitator) signature
 *     4. Submit to the Solana network and confirm
 *
 * The user's wallet must hold sufficient USDC. The facilitator covers SOL fees.
 */

import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  Connection,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getConfig } from '../config.js';

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;

const RPC_MAINNET = 'https://api.mainnet-beta.solana.com';
const RPC_DEVNET = 'https://api.devnet.solana.com';

// SPL Token instruction discriminator for TransferChecked
const TRANSFER_CHECKED_IX = 12;

// TransferChecked data is exactly 10 bytes: [discriminator(1), amount(8 LE), decimals(1)]
const TRANSFER_CHECKED_DATA_LEN = 10;

export interface SolanaPaymentPayload {
  transaction: string;  // base64-encoded partially-signed Solana VersionedTransaction
  network: 'solana' | 'solana-devnet';
  from: string;         // client base58 pubkey (token authority)
  to: string;           // merchant base58 pubkey (ATA owner)
  amount: string;       // USDC amount in smallest unit (6 decimals)
  mint: string;         // USDC mint address
}

/**
 * Build and partially sign a Solana VersionedTransaction for a USDC payment.
 *
 * The facilitator is set as fee payer so the sender does not need SOL for gas.
 * Only the client signature is applied — the fee payer signature must be added
 * by the facilitator before the transaction can be submitted to the network.
 *
 * @param params.privateKey  64-byte Solana keypair (Solana convention: seed + public key)
 * @param params.to          merchant base58 pubkey (USDC recipient)
 * @param params.amount      payment amount in USD (converted to 6-decimal USDC units)
 * @param params.network     target network
 * @param params.feePayer    facilitator base58 pubkey — received from payment requirements
 * @param params.rpcUrl      optional RPC endpoint override
 */
export async function signSolanaPayment(params: {
  privateKey: Uint8Array;
  to: string;
  amount: number;
  network: 'solana' | 'solana-devnet';
  feePayer: string;
  rpcUrl?: string;
}): Promise<SolanaPaymentPayload> {
  const { privateKey, to, amount, network, feePayer, rpcUrl } = params;

  if (privateKey.length !== 64) {
    throw new Error('privateKey must be 64 bytes (Solana keypair: seed + public key)');
  }

  const clientKeypair = Keypair.fromSecretKey(privateKey);
  const mint = network === 'solana' ? USDC_MAINNET : USDC_DEVNET;
  const amountUnits = BigInt(Math.ceil(amount * 1_000_000));

  const mintPubkey = new PublicKey(mint);
  const toPubkey = new PublicKey(to);
  const feePayerPubkey = new PublicKey(feePayer);

  // Derive the Associated Token Accounts for client → merchant
  const sourceATA = getAssociatedTokenAddressSync(mintPubkey, clientKeypair.publicKey);
  const destATA = getAssociatedTokenAddressSync(mintPubkey, toPubkey);

  const rpcEndpoint = rpcUrl ?? (network === 'solana' ? RPC_MAINNET : RPC_DEVNET);
  const connection = new Connection(rpcEndpoint, 'confirmed');
  const { blockhash } = await connection.getLatestBlockhash();

  const transferIx = createTransferCheckedInstruction(
    sourceATA,
    mintPubkey,
    destATA,
    clientKeypair.publicKey,
    amountUnits,
    USDC_DECIMALS,
  );

  const message = new TransactionMessage({
    payerKey: feePayerPubkey,
    recentBlockhash: blockhash,
    instructions: [transferIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([clientKeypair]); // partial sign — fee payer signature intentionally missing

  return {
    transaction: Buffer.from(tx.serialize()).toString('base64'),
    network,
    from: clientKeypair.publicKey.toBase58(),
    to,
    amount: amountUnits.toString(),
    mint,
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
 * Locate and decode the first SPL TransferChecked instruction in a v0 transaction.
 */
function decodeTransferChecked(tx: VersionedTransaction): DecodeResult {
  // We require v0 (versioned) transactions. Both staticAccountKeys and
  // compiledInstructions are present only on MessageV0.
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

  for (const ix of instructions) {
    const programId = accountKeys[ix.programIdIndex];
    if (!programId?.equals(TOKEN_PROGRAM_ID)) continue;

    const data = Buffer.from(ix.data);
    if (data.length !== TRANSFER_CHECKED_DATA_LEN || data[0] !== TRANSFER_CHECKED_IX) continue;

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

  return { ok: false, error: 'No TransferChecked instruction found in transaction' };
}

/**
 * Verify a Solana PST payment.
 *
 * Basic mode (no facilitator privateKey in config): validates transaction
 * structure, instruction contents, amounts, and recipient — no network calls.
 *
 * Full mode (facilitator privateKey configured): all basic checks plus
 * co-sign with facilitator keypair and submit to the Solana network.
 *
 * Verification steps:
 *  1. Deserialize the base64 transaction
 *  2. Locate the TransferChecked instruction
 *  3. Check mint = expected USDC for this network
 *  4. Check destination ATA = expected ATA derived from configured payTo address
 *  5. Check amount >= expectedAmount
 *  6. Check authority matches the claimed sender (payment.from)
 *  7. Full mode: add facilitator fee payer signature and submit to network
 */
export async function verifyPayment(
  payment: SolanaPaymentPayload,
  expectedAmount: number,
): Promise<{ valid: boolean; error?: string; txSignature?: string }> {
  const cfg = getConfig();

  // 1. Deserialize
  let tx: VersionedTransaction;
  try {
    const txBytes = Buffer.from(payment.transaction, 'base64');
    tx = VersionedTransaction.deserialize(txBytes);
  } catch {
    return { valid: false, error: 'Invalid transaction: deserialization failed' };
  }

  // 2. Locate TransferChecked instruction
  const decoded = decodeTransferChecked(tx);
  if (!decoded.ok) {
    return { valid: false, error: decoded.error };
  }
  const { mint: txMint, destination, authority, amount: txAmount } = decoded;

  // 3. Mint must be the canonical USDC for this network
  const expectedMint = payment.network === 'solana' ? USDC_MAINNET : USDC_DEVNET;
  if (txMint !== expectedMint) {
    return { valid: false, error: `Wrong mint: expected ${expectedMint}, got ${txMint}` };
  }

  // 4. Destination ATA must match the ATA derived from the configured recipient address
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

  // 5. Amount must be sufficient
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));
  if (txAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${txAmount} < ${requiredAmount}` };
  }

  // 6. Authority on the instruction must match the claimed sender
  if (authority !== payment.from) {
    return {
      valid: false,
      error: `Transaction authority does not match claimed sender`,
    };
  }

  // 7. Full mode: add fee payer signature and submit
  if (cfg.solana.privateKey) {
    return coSignAndSubmit(tx, payment, cfg.solana.privateKey, cfg.solana.rpcUrl);
  }

  // Basic mode: structural validation only (no network submission)
  return { valid: true };
}

/**
 * Add the facilitator's fee payer signature and submit the transaction to Solana.
 */
async function coSignAndSubmit(
  tx: VersionedTransaction,
  payment: SolanaPaymentPayload,
  facilitatorPrivateKey: Uint8Array,
  rpcUrl?: string,
): Promise<{ valid: boolean; error?: string; txSignature?: string }> {
  try {
    const facilitatorKeypair = Keypair.fromSecretKey(facilitatorPrivateKey);
    tx.sign([facilitatorKeypair]);

    const endpoint = rpcUrl ?? (payment.network === 'solana' ? RPC_MAINNET : RPC_DEVNET);
    const connection = new Connection(endpoint, 'confirmed');

    const txSignature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // confirmTransaction string-form is deprecated in web3.js v1 but functionally correct
    await connection.confirmTransaction(txSignature, 'confirmed');

    return { valid: true, txSignature };
  } catch (err) {
    return {
      valid: false,
      error: `Settlement failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
