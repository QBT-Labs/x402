/**
 * Solana Chain Support
 *
 * SPL Token transfer verification using Ed25519 signatures.
 *
 * IMPORTANT: Unlike EVM's EIP-3009 (gasless), Solana SPL transfers require the
 * sender to hold SOL for transaction fees. The sender must maintain a minimum SOL
 * balance (~0.002 SOL) to cover fees, in addition to their USDC balance.
 * This adapter verifies the off-chain authorization signature; actual on-chain
 * settlement still requires SOL in the sender's wallet.
 */

import { getConfig } from '../config.js';

// Public Solana RPC endpoints (used when no rpcUrl is configured)
const RPC_MAINNET = 'https://api.mainnet-beta.solana.com';
const RPC_DEVNET = 'https://api.devnet.solana.com';

export interface SolanaPaymentPayload {
  from: string;        // base58 pubkey
  to: string;          // base58 pubkey
  amount: string;      // USDC smallest unit (6 decimals)
  mint: string;        // USDC mint address
  nonce: string;       // random bytes32 hex
  validBefore: number; // unix timestamp
  signature: string;   // Ed25519 hex signature (128 hex chars = 64 bytes)
  network: 'solana' | 'solana-devnet';
}

/**
 * Build canonical payload bytes for signing/verification.
 * Format: "<from>|<to>|<amount>|<mint>|<nonce>|<validBefore>"
 */
function canonicalBytes(payload: Omit<SolanaPaymentPayload, 'signature'>): Uint8Array {
  const msg = [
    payload.from,
    payload.to,
    payload.amount,
    payload.mint,
    payload.nonce,
    payload.validBefore.toString(),
  ].join('|');
  return new TextEncoder().encode(msg);
}

/**
 * Sign a Solana USDC payment authorization with Ed25519.
 *
 * NOTE: Unlike EVM's EIP-3009, on-chain execution of an SPL transfer requires
 * the sender to hold SOL for transaction fees (~0.002 SOL minimum).
 *
 * @param params.privateKey - 64-byte Ed25519 keypair (seed + public key, Solana convention)
 * @param params.to - recipient base58 pubkey
 * @param params.amount - amount in USD, converted to USDC smallest unit (6 decimals)
 * @param params.network - target network
 */
export async function signSolanaPayment(params: {
  privateKey: Uint8Array; // 64-byte keypair
  to: string;
  amount: number; // in USD
  network: 'solana' | 'solana-devnet';
}): Promise<SolanaPaymentPayload> {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { randomBytes } = await import('crypto');

  const { privateKey, to, amount, network } = params;

  if (privateKey.length !== 64) {
    throw new Error('privateKey must be 64 bytes (Ed25519 seed + public key, Solana convention)');
  }

  // Solana keypair: first 32 bytes are the seed, last 32 are the public key
  const seed = privateKey.slice(0, 32);
  const publicKeyBytes = ed25519.getPublicKey(seed);
  const from = bytesToBase58(publicKeyBytes);

  const mint = network === 'solana'
    ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

  const amountStr = Math.ceil(amount * 1_000_000).toString();
  const nonce = randomBytes(32).toString('hex');
  const validBefore = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  const payload: Omit<SolanaPaymentPayload, 'signature'> = {
    from,
    to,
    amount: amountStr,
    mint,
    nonce,
    validBefore,
    network,
  };

  const msgBytes = canonicalBytes(payload);
  const sigBytes = ed25519.sign(msgBytes, seed);

  return { ...payload, signature: bytesToHex(sigBytes) };
}

/**
 * Verify a Solana SPL USDC payment authorization.
 *
 * Verification steps:
 * 1. Check signature format (128 hex chars)
 * 2. Check validBefore > now
 * 3. Check amount >= expectedAmount (USDC has 6 decimals)
 * 4. Check recipient matches configured address
 * 5. Full mode only: verify Ed25519 signature cryptographically
 * 6. Full mode only: check sender SPL balance via RPC >= amount
 *
 * Nonce deduplication is handled by the facilitator, not here.
 */
export async function verifyPayment(
  payment: SolanaPaymentPayload,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string }> {
  const cfg = getConfig();
  const mode = cfg.verifyMode ?? 'basic';

  // --- Signature format check ---
  if (!payment.signature || !/^[0-9a-fA-F]{128}$/.test(payment.signature)) {
    return { valid: false, error: 'Invalid signature format (expected 128-char hex)' };
  }

  // --- Nonce format check ---
  if (!payment.nonce || !/^[0-9a-fA-F]+$/.test(payment.nonce)) {
    return { valid: false, error: 'Invalid nonce format' };
  }

  // --- Expiry check ---
  const now = Math.floor(Date.now() / 1000);
  if (!payment.validBefore || payment.validBefore <= now) {
    return { valid: false, error: 'Authorization expired' };
  }

  // --- Amount check ---
  const paidAmount = BigInt(payment.amount);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));

  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  // --- Recipient check ---
  if (payment.to !== cfg.solana?.address) {
    return { valid: false, error: 'Wrong recipient' };
  }

  if (mode === 'full') {
    // --- Ed25519 cryptographic signature verification ---
    try {
      const { ed25519 } = await import('@noble/curves/ed25519.js');
      const sigBytes = hexToBytes(payment.signature);
      const pubKeyBytes = base58ToBytes(payment.from);
      const msgBytes = canonicalBytes(payment);
      const isValid = ed25519.verify(sigBytes, msgBytes, pubKeyBytes);
      if (!isValid) {
        return { valid: false, error: 'Invalid Ed25519 signature' };
      }
    } catch {
      return { valid: false, error: 'Signature verification failed' };
    }

    // --- SPL token balance check via JSON-RPC ---
    try {
      const rpcUrl = cfg.solana?.rpcUrl ??
        (payment.network === 'solana' ? RPC_MAINNET : RPC_DEVNET);
      const balance = await getSplBalance(payment.from, payment.mint, rpcUrl);
      if (balance < paidAmount) {
        return { valid: false, error: `Insufficient SPL balance: ${balance} < ${paidAmount}` };
      }
    } catch {
      // Non-fatal: if RPC is unavailable, proceed without balance check
      console.warn('x402: Solana RPC unavailable, skipping SPL balance check');
    }
  }

  return { valid: true };
}

/**
 * Query SPL token balance for an owner address via Solana JSON-RPC.
 * Sums all token accounts for the given mint.
 */
async function getSplBalance(
  owner: string,
  mint: string,
  rpcUrl: string
): Promise<bigint> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, { mint }, { encoding: 'jsonParsed' }],
    }),
  });

  type RpcResponse = {
    result?: {
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: { tokenAmount?: { amount?: string } };
            };
          };
        };
      }>;
    };
  };

  const data = (await response.json()) as RpcResponse;
  const accounts = data?.result?.value ?? [];

  let total = 0n;
  for (const acc of accounts) {
    const amount = acc?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amount) {
      total += BigInt(amount);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Base58 utilities (Solana-compatible, no checksum)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeros++;
  }

  let num = 0n;
  for (const b of bytes) {
    num = (num << 8n) | BigInt(b);
  }

  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }

  return '1'.repeat(leadingZeros) + result;
}

function base58ToBytes(str: string): Uint8Array {
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    ALPHABET_MAP[BASE58_ALPHABET[i]] = i;
  }

  let leadingZeros = 0;
  for (const char of str) {
    if (char !== '1') break;
    leadingZeros++;
  }

  let num = 0n;
  for (const char of str) {
    const val = ALPHABET_MAP[char];
    if (val === undefined) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(val);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }

  return new Uint8Array([...Array(leadingZeros).fill(0), ...bytes]);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}
