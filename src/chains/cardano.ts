/**
 * Cardano Chain Support
 *
 * Uses Lucid Evolution to build and sign transactions client-side (signCardanoPayment).
 * The payment payload carries the signed transaction as a hex CBOR string.
 * Server-side verification deserialises the CBOR via CML, inspects outputs, and
 * optionally submits via Blockfrost REST API.
 *
 * IMPORTANT — min-ADA constraint:
 *   Every Cardano UTxO requires a minimum ADA deposit of ~1.5–2 ADA
 *   (1 500 000–2 000 000 lovelace). When paying native tokens the output
 *   must include at least MIN_ADA_LOVELACE alongside the tokens or the
 *   transaction will be rejected by the node. signCardanoPayment() enforces
 *   this automatically for non-ADA payments.
 *
 * Supported tokens:
 *   - ADA   (native)
 *   - iUSD  (Indigo Protocol, policy: f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12)
 *   - USDM  (Mehen/Moneta fiat-backed, policy: c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad)
 *   - DJED  (COTI/IOG overcollateralised, policy: 8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61)
 *   - USDCx (Circle xReserve, policy: 1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34)
 */

// @lucid-evolution/lucid is loaded lazily inside async functions so that:
// 1. Tests can mock the module with jest.unstable_mockModule before importing this file
// 2. The heavy WASM initialisation only happens when actually needed

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

/** iUSD — Indigo Protocol synthetic USD */
export const IUSD_POLICY_ID = 'f66d78b4a3cb3d37afa0ec36461e51ecbbd728f7a95aea88de7d7f12';
// fromText('iUSD') = hex('iUSD') = 69555344
const IUSD_ASSET_HEX = '69555344';

/** USDM — Mehen / Moneta fiat-backed stablecoin (CIP-68 format) */
export const USDM_POLICY_ID = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad';
export const USDM_ASSET_HEX = '0014df105553444d'; // CIP-68 prefix 0014df10 + hex('USDM')

/** DJED — COTI/IOG ADA-overcollateralised stablecoin */
export const DJED_POLICY_ID = '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61';
export const DJED_ASSET_HEX = '446a65644d6963726f555344'; // hex('DjedMicroUSD')

/**
 * USDCx — Circle xReserve 1:1 USDC-backed token (launched 2026-02-18).
 * Mainnet fingerprint:  asset1e7eewpjw8ua3f2gpfx7y34ww9vjl63hayn80kl
 * Preprod fingerprint:  asset1ejelsh8crza8dyghxzsjhkjqutzr7q3dnregng
 */
export const USDCX_POLICY_ID = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34';
export const USDCX_ASSET_HEX = '5553444378'; // hex('USDCx')

export interface KnownToken {
  symbol: string;
  policyId: string;
  assetNameHex: string;
  decimals: number;
}

/**
 * Registry of known Cardano stablecoins supported by x402.
 * Key = Blockfrost/Lucid unit: policy_id + asset_name_hex.
 */
export const KNOWN_CARDANO_TOKENS: Record<string, KnownToken> = {
  [`${IUSD_POLICY_ID}${IUSD_ASSET_HEX}`]: {
    symbol: 'iUSD', policyId: IUSD_POLICY_ID, assetNameHex: IUSD_ASSET_HEX, decimals: 6,
  },
  [`${USDM_POLICY_ID}${USDM_ASSET_HEX}`]: {
    symbol: 'USDM', policyId: USDM_POLICY_ID, assetNameHex: USDM_ASSET_HEX, decimals: 6,
  },
  [`${DJED_POLICY_ID}${DJED_ASSET_HEX}`]: {
    symbol: 'DJED', policyId: DJED_POLICY_ID, assetNameHex: DJED_ASSET_HEX, decimals: 6,
  },
  [`${USDCX_POLICY_ID}${USDCX_ASSET_HEX}`]: {
    symbol: 'USDCx', policyId: USDCX_POLICY_ID, assetNameHex: USDCX_ASSET_HEX, decimals: 6,
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tokens supported by the x402 Cardano adapter */
export type CardanoToken = 'ADA' | 'iUSD' | 'USDM' | 'DJED' | 'USDCx';

/**
 * x402 Cardano payment payload.
 * The entire payload is a signed Cardano transaction in hex CBOR form, built
 * by Lucid Evolution on the client. The server deserialises it with CML to
 * verify outputs without re-building the transaction.
 */
export interface CardanoPaymentPayload {
  /** Fully-signed transaction as hex CBOR (built via Lucid Evolution) */
  transaction: string;
}

/** Minimum lovelace that must accompany any native-token UTxO */
export const MIN_ADA_LOVELACE = 2_000_000n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockfrostUrlForNetwork(network: 'Mainnet' | 'Preprod'): string {
  return network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
}

/** Returns the Lucid unit string (policy_id + asset_name_hex) for a token */
function tokenUnit(token: Exclude<CardanoToken, 'ADA'>): string {
  switch (token) {
    case 'iUSD':  return `${IUSD_POLICY_ID}${IUSD_ASSET_HEX}`;
    case 'USDM':  return `${USDM_POLICY_ID}${USDM_ASSET_HEX}`;
    case 'DJED':  return `${DJED_POLICY_ID}${DJED_ASSET_HEX}`;
    case 'USDCx': return `${USDCX_POLICY_ID}${USDCX_ASSET_HEX}`;
  }
}

// ---------------------------------------------------------------------------
// Network detection
// ---------------------------------------------------------------------------

export function detectNetwork(address: string): 'cardano' | 'cardano-preprod' {
  return address.startsWith('addr_test1') ? 'cardano-preprod' : 'cardano';
}

// ---------------------------------------------------------------------------
// signCardanoPayment — CLIENT SIDE
// ---------------------------------------------------------------------------

export interface SignCardanoPaymentParams {
  /** BIP-39 mnemonic (12 or 24 words) */
  seed: string;
  toAddress: string;
  /** Lovelace for ADA payments; native-token units for all other tokens */
  amount: bigint;
  /** Defaults to 'ADA' */
  token?: CardanoToken;
  blockfrostProjectId: string;
  /** Defaults to 'Mainnet' */
  network?: 'Mainnet' | 'Preprod';
}

/**
 * Build and sign a Cardano x402 payment transaction using Lucid Evolution.
 *
 * For native-token payments the output automatically includes MIN_ADA_LOVELACE
 * (2 ADA) alongside the tokens to satisfy the UTxO min-ADA requirement.
 *
 * @example
 * const payload = await signCardanoPayment({
 *   seed: 'word1 word2 ... word24',
 *   toAddress: 'addr1...',
 *   amount: 5_000_000n,   // 5 USDM (6 decimals)
 *   token: 'USDM',
 *   blockfrostProjectId: 'mainnetXXX',
 * });
 */
export async function signCardanoPayment(
  params: SignCardanoPaymentParams,
): Promise<CardanoPaymentPayload> {
  const {
    seed,
    toAddress,
    amount,
    token = 'ADA',
    blockfrostProjectId,
    network = 'Mainnet',
  } = params;

  // Dynamic import — allows tests to mock before this function is called
  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');

  const lucid = await Lucid(
    new Blockfrost(blockfrostUrlForNetwork(network), blockfrostProjectId),
    network,
  );
  lucid.selectWallet.fromSeed(seed);

  // Build the asset map for the output
  let assets: Record<string, bigint>;
  if (token === 'ADA') {
    assets = { lovelace: amount };
  } else {
    // Native-token payments must also carry min-ADA for UTxO viability
    assets = {
      lovelace: MIN_ADA_LOVELACE,
      [tokenUnit(token)]: amount,
    };
  }

  const txSignBuilder = await lucid
    .newTx()
    .pay.ToAddress(toAddress, assets)
    .complete();

  const txSigned = await txSignBuilder.sign.withWallet().complete();

  return { transaction: txSigned.toCBOR() };
}

// ---------------------------------------------------------------------------
// verifyCardanoPayment — SERVER SIDE
// ---------------------------------------------------------------------------

/**
 * Verify a Cardano x402 payment payload.
 *
 * Steps:
 *   1. Deserialise the CBOR hex via CML and confirm it parses as a valid transaction
 *   2. Scan outputs for one that pays ≥ expectedAmount of `token` to `expectedAddress`
 *      - For token payments also checks lovelace ≥ MIN_ADA_LOVELACE
 *   3. If blockfrostProjectId is provided, submit the transaction via Blockfrost
 *      REST API and return the txHash
 *
 * IMPORTANT: For token payments `expectedAmount` is in token units (not lovelace).
 * The min-ADA lovelace requirement is always enforced implicitly.
 *
 * @param payload             Payload from the client (contains the signed tx CBOR)
 * @param expectedAddress     Recipient bech32 address that must appear in the outputs
 * @param expectedAmount      Required amount (lovelace for ADA, token units otherwise)
 * @param token               Token being paid; defaults to 'ADA'
 * @param blockfrostProjectId When provided, the tx is submitted via Blockfrost
 * @param network             'Mainnet' | 'Preprod'; defaults to 'Mainnet'
 */
export async function verifyCardanoPayment(
  payload: CardanoPaymentPayload,
  expectedAddress: string,
  expectedAmount: bigint,
  token: CardanoToken = 'ADA',
  blockfrostProjectId?: string,
  network: 'Mainnet' | 'Preprod' = 'Mainnet',
): Promise<{ valid: boolean; txHash?: string; error?: string }> {
  // Dynamic import — allows tests to mock before this function is called
  const { CML } = await import('@lucid-evolution/lucid');

  // 1. Deserialise CBOR
  let cmlTx: ReturnType<typeof CML.Transaction.from_cbor_hex>;
  try {
    cmlTx = CML.Transaction.from_cbor_hex(payload.transaction);
  } catch {
    return { valid: false, error: 'INVALID_CBOR' };
  }

  // 2. Inspect outputs
  const outputs = cmlTx.body().outputs();
  let outputFound = false;

  for (let i = 0; i < outputs.len(); i++) {
    const output = outputs.get(i);
    const addr = output.address().to_bech32(undefined);

    if (addr !== expectedAddress) continue;

    const value = output.amount();

    if (token === 'ADA') {
      if (value.coin() >= expectedAmount) {
        outputFound = true;
        break;
      }
    } else {
      // Token payment: verify both lovelace min-ADA and native-asset amount
      if (value.coin() < MIN_ADA_LOVELACE) continue;

      const unit      = tokenUnit(token);
      const policyId  = unit.slice(0, 56);
      const assetName = unit.slice(56);

      const multiAsset = value.multi_asset();
      if (!multiAsset) continue;

      const policyHash   = CML.ScriptHash.from_hex(policyId);
      const assetNameObj = CML.AssetName.from_hex(assetName);
      const tokenAmount  = multiAsset.get(policyHash, assetNameObj) ?? 0n;

      if (tokenAmount >= expectedAmount) {
        outputFound = true;
        break;
      }
    }
  }

  if (!outputFound) {
    return { valid: false, error: 'OUTPUT_MISMATCH' };
  }

  // 3. Submit via Blockfrost (optional)
  if (blockfrostProjectId) {
    try {
      const url     = `${blockfrostUrlForNetwork(network)}/tx/submit`;
      const txBytes = Buffer.from(payload.transaction, 'hex');
      const res     = await fetch(url, {
        method: 'POST',
        headers: {
          'project_id': blockfrostProjectId,
          'Content-Type': 'application/cbor',
        },
        body: txBytes,
      });

      if (!res.ok) {
        const body = await res.text();
        return { valid: false, error: `SUBMIT_FAILED: ${body}` };
      }

      const txHash = (await res.text()).replace(/"/g, '');
      return { valid: true, txHash };
    } catch (err) {
      return { valid: false, error: `SUBMIT_ERROR: ${String(err)}` };
    }
  }

  return { valid: true };
}
