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
 *   - ADA   (native, no policy_id)
 *   - iUSD  (policy_id: f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12)
 *   - USDM  (policy_id: c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad)
 *   - DJED  (policy_id: 8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61)
 *   - USDCx (policy_id: 1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34)
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

// ---------------------------------------------------------------------------
// Known token constants
// ---------------------------------------------------------------------------

/** iUSD — Indigo Protocol synthetic USD */
export const IUSD_POLICY_ID = 'f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12';

/** USDM — Mehen / Moneta fiat-backed stablecoin (CIP-68 format) */
export const USDM_POLICY_ID = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad';

/** DJED — COTI/IOG ADA-overcollateralized stablecoin */
export const DJED_POLICY_ID = '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61';

/**
 * USDCx — Circle xReserve 1:1 USDC-backed token (launched 2026-02-18).
 * Mainnet fingerprint:  asset1e7eewpjw8ua3f2gpfx7y34ww9vjl63hayn80kl
 * Preprod fingerprint:  asset1ejelsh8crza8dyghxzsjhkjqutzr7q3dnregng
 */
export const USDCX_POLICY_ID = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34';

export interface KnownToken {
  symbol: string;
  policyId: string;
  /** Hex-encoded asset name */
  assetNameHex: string;
  decimals: number;
}

/**
 * Registry of known Cardano stablecoins supported by x402.
 * Key is the Blockfrost unit string: policy_id + asset_name_hex.
 */
export const KNOWN_CARDANO_TOKENS: Record<string, KnownToken> = {
  // iUSD – asset name hex: "iUSD" = 69555344
  [`${IUSD_POLICY_ID}69555344`]: {
    symbol: 'iUSD',
    policyId: IUSD_POLICY_ID,
    assetNameHex: '69555344',
    decimals: 6,
  },
  // USDM – CIP-68 reference token prefix 0014df10 + "USDM" (5553444d)
  [`${USDM_POLICY_ID}0014df105553444d`]: {
    symbol: 'USDM',
    policyId: USDM_POLICY_ID,
    assetNameHex: '0014df105553444d',
    decimals: 6,
  },
  // DJED – "DjedMicroUSD" = 446a65644d6963726f555344
  [`${DJED_POLICY_ID}446a65644d6963726f555344`]: {
    symbol: 'DJED',
    policyId: DJED_POLICY_ID,
    assetNameHex: '446a65644d6963726f555344',
    decimals: 6,
  },
  // USDCx – "USDCx" = 5553444378
  [`${USDCX_POLICY_ID}5553444378`]: {
    symbol: 'USDCx',
    policyId: USDCX_POLICY_ID,
    assetNameHex: '5553444378',
    decimals: 6,
  },
};

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

/**
 * Fetch all asset balances for an address from Blockfrost.
 * Returns a map of unit → quantity (lovelace + all native assets), or null on failure.
 */
async function fetchBlockfrostAmounts(
  address: string,
  network: 'cardano' | 'cardano-preprod',
  projectId: string,
): Promise<Map<string, bigint> | null> {
  const baseUrl =
    network === 'cardano-preprod'
      ? 'https://cardano-preprod.blockfrost.io/api/v0'
      : 'https://cardano-mainnet.blockfrost.io/api/v0';

  const res = await fetch(`${baseUrl}/addresses/${encodeURIComponent(address)}`, {
    headers: { project_id: projectId },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as BlockfrostAddress;
  const balances = new Map<string, bigint>();
  for (const entry of data.amount ?? []) {
    balances.set(entry.unit, BigInt(entry.quantity));
  }
  return balances;
}

/**
 * Verify a Cardano x402 payment payload.
 *
 * Checks:
 *   1. Ed25519 signature over canonical JSON
 *   2. Deadline not expired
 *   3. amount_lovelace >= expectedLovelace
 *   4. (Optional) live on-chain balance via Blockfrost REST API
 *      - ADA payments: lovelace balance >= expectedLovelace
 *      - Token payments: native-asset balance >= token.amount AND
 *        lovelace balance >= expectedLovelace (covers UTxO min-ADA)
 *
 * IMPORTANT: Every Cardano UTxO requires ~1.5–2 ADA (1 500 000–2 000 000 lovelace).
 * For token payments the expectedLovelace parameter should be set to at least
 * 2 000 000 to ensure the payer holds enough ADA to cover the UTxO deposit.
 *
 * @param payment              Payload received from the client
 * @param expectedLovelace     Required lovelace (min-ADA for token payments)
 * @param blockfrostProjectId  When provided, live balance is verified via Blockfrost
 */
export async function verifyCardanoPayment(
  payment: CardanoPaymentPayload,
  expectedLovelace: bigint,
  blockfrostProjectId?: string,
): Promise<{ valid: boolean; error?: string }> {
  // 1. Signature
  try {
    const message = new TextEncoder().encode(canonicalJSON(payment));
    const sigBytes = toBytes(payment.signature);
    const pubBytes = toBytes(payment.public_key);
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

  // 3. Amount (lovelace — covers ADA payments and UTxO min-ADA for token payments)
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
      const balances = await fetchBlockfrostAmounts(
        payment.from_address,
        payment.network,
        blockfrostProjectId,
      );
      if (balances === null) {
        return { valid: false, error: 'Could not fetch balance from Blockfrost' };
      }

      // Always verify the address holds enough ADA for UTxO min-ADA
      const lovelaceBalance = balances.get('lovelace') ?? 0n;
      if (lovelaceBalance < expectedLovelace) {
        return {
          valid: false,
          error: `Insufficient on-chain ADA: ${lovelaceBalance} < ${expectedLovelace} lovelace`,
        };
      }

      // For token payments, also verify the native-asset balance
      if (payment.token) {
        const unit = payment.token.policy_id + payment.token.asset_name;
        const tokenBalance = balances.get(unit) ?? 0n;
        const requiredTokenAmount = BigInt(payment.token.amount);
        if (tokenBalance < requiredTokenAmount) {
          return {
            valid: false,
            error: `Insufficient on-chain token balance: ${tokenBalance} < ${requiredTokenAmount} (unit: ${unit})`,
          };
        }
      }
    } catch {
      return { valid: false, error: 'Blockfrost balance check failed' };
    }
  }

  return { valid: true };
}
