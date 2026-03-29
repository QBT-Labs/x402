/**
 * Cardano Chain Support
 *
 * Off-chain Ed25519 payment signing and verification.
 * Facilitator executes the ADA/token transfer; no smart contracts needed.
 *
 * IMPORTANT: Every Cardano UTxO requires a minimum ADA deposit (~1.5–2 ADA).
 * When charging in ADA, set amount_lovelace high enough to cover the UTxO min-ADA
 * requirement OR instruct users to only pay token amounts from addresses that
 * already hold enough ADA. Payments below ~2 000 000 lovelace may be unspendable.
 *
 * Supported assets:
 *   - ADA  (native, no policy_id)
 *   - iUSD (policy_id: f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12)
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from 'crypto';

export interface CardanoPaymentPayload {
  /** bech32 sender: addr1... (mainnet) or addr_test1... (preprod) */
  from_address: string;
  /** bech32 recipient */
  to_address: string;
  /** ADA amount in lovelace (1 ADA = 1 000 000 lovelace) */
  amount_lovelace: string;
  /** Optional native-asset transfer */
  token?: {
    policy_id: string;
    asset_name: string;
    amount: string;
  };
  /** Random hex (32 bytes) for replay prevention */
  nonce: string;
  /** Unix timestamp expiry */
  deadline: number;
  /** Hex Ed25519 public key — required for off-chain signature verification */
  public_key: string;
  /** Hex Ed25519 signature over the canonical JSON payload (excludes this field) */
  signature: string;
  network: 'cardano' | 'cardano-preprod';
}

/** iUSD policy ID on Cardano mainnet */
export const IUSD_POLICY_ID = 'f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic JSON string with all object keys sorted recursively.
 * The `signature` field is omitted so the same bytes are signed and verified.
 */
function canonicalJSON(obj: unknown): string {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const record = obj as Record<string, unknown>;
  const sorted = Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      if (k !== 'signature') {
        acc[k] = record[k];
      }
      return acc;
    }, {});
  // recurse into values
  const entries = Object.keys(sorted)
    .map((k) => `${JSON.stringify(k)}:${canonicalJSON(sorted[k])}`)
    .join(',');
  return `{${entries}}`;
}

function toBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Network detection
// ---------------------------------------------------------------------------

export function detectNetwork(address: string): 'cardano' | 'cardano-preprod' {
  return address.startsWith('addr_test1') ? 'cardano-preprod' : 'cardano';
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

export interface SignCardanoPaymentParams {
  /** Raw 32-byte Ed25519 private key */
  privateKey: Uint8Array;
  /** bech32 sender address (caller must provide; derivation is chain-native) */
  fromAddress: string;
  toAddress: string;
  amountLovelace: bigint;
  token?: { policyId: string; assetName: string; amount: bigint };
  network: 'cardano' | 'cardano-preprod';
}

/**
 * Sign a Cardano x402 payment payload with an Ed25519 private key.
 *
 * @example
 * const payload = await signCardanoPayment({
 *   privateKey: myEd25519Key,
 *   fromAddress: 'addr1...',
 *   toAddress: 'addr1...',
 *   amountLovelace: 2_000_000n,
 *   network: 'cardano',
 * });
 */
export async function signCardanoPayment(
  params: SignCardanoPaymentParams,
): Promise<CardanoPaymentPayload> {
  const { privateKey, fromAddress, toAddress, amountLovelace, token, network } = params;

  const nonce = toHex(randomBytes(32));
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const pubKey = ed25519.getPublicKey(privateKey);

  const partial: Omit<CardanoPaymentPayload, 'signature'> = {
    from_address: fromAddress,
    to_address: toAddress,
    amount_lovelace: amountLovelace.toString(),
    nonce,
    deadline,
    public_key: toHex(pubKey),
    network,
    ...(token
      ? {
          token: {
            policy_id: token.policyId,
            asset_name: token.assetName,
            amount: token.amount.toString(),
          },
        }
      : {}),
  };

  const message = new TextEncoder().encode(canonicalJSON(partial));
  const sig = ed25519.sign(message, privateKey);

  return { ...partial, signature: toHex(sig) };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

interface BlockfrostAddress {
  amount: Array<{ unit: string; quantity: string }>;
}

async function fetchBlockfrostBalance(
  address: string,
  network: 'cardano' | 'cardano-preprod',
  projectId: string,
): Promise<bigint | null> {
  const baseUrl =
    network === 'cardano-preprod'
      ? 'https://cardano-preprod.blockfrost.io/api/v0'
      : 'https://cardano-mainnet.blockfrost.io/api/v0';

  const res = await fetch(`${baseUrl}/addresses/${encodeURIComponent(address)}`, {
    headers: { project_id: projectId },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as BlockfrostAddress;
  const lovelace = data.amount?.find((a) => a.unit === 'lovelace');
  return lovelace ? BigInt(lovelace.quantity) : 0n;
}

/**
 * Verify a Cardano x402 payment payload.
 *
 * Checks:
 *   1. Ed25519 signature over canonical JSON
 *   2. Deadline not expired
 *   3. amount_lovelace >= expectedLovelace
 *   4. (Optional) live ADA balance via Blockfrost
 *
 * @param payment         The payload received from the client
 * @param expectedLovelace Required lovelace amount
 * @param blockfrostProjectId When provided, live balance is checked via Blockfrost REST API
 */
export async function verifyCardanoPayment(
  payment: CardanoPaymentPayload,
  expectedLovelace: bigint,
  blockfrostProjectId?: string,
): Promise<{ valid: boolean; error?: string }> {
  // 1. Signature
  try {
    const { signature, public_key, ...rest } = payment;
    // canonicalJSON already excludes 'signature'; pass the full payment object
    const message = new TextEncoder().encode(canonicalJSON(payment));
    const sigBytes = toBytes(signature);
    const pubBytes = toBytes(public_key);
    const ok = ed25519.verify(sigBytes, message, pubBytes);
    if (!ok) {
      return { valid: false, error: 'Invalid signature' };
    }
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }

  // 2. Deadline
  const now = Math.floor(Date.now() / 1000);
  if (payment.deadline <= now) {
    return { valid: false, error: 'Payment deadline expired' };
  }

  // 3. Amount
  const paidLovelace = BigInt(payment.amount_lovelace);
  if (paidLovelace < expectedLovelace) {
    return {
      valid: false,
      error: `Insufficient amount: ${paidLovelace} < ${expectedLovelace} lovelace`,
    };
  }

  // 4. Blockfrost balance check (optional)
  if (blockfrostProjectId) {
    try {
      const balance = await fetchBlockfrostBalance(
        payment.from_address,
        payment.network,
        blockfrostProjectId,
      );
      if (balance === null) {
        return { valid: false, error: 'Could not fetch balance from Blockfrost' };
      }
      if (balance < expectedLovelace) {
        return {
          valid: false,
          error: `Insufficient on-chain balance: ${balance} < ${expectedLovelace} lovelace`,
        };
      }
    } catch {
      return { valid: false, error: 'Blockfrost balance check failed' };
    }
  }

  return { valid: true };
}
