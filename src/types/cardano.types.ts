/**
 * Types, constants and registries for the x402 Cardano adapter.
 */

// ---------------------------------------------------------------------------
// Token constants
// ---------------------------------------------------------------------------

/** iUSD — Indigo Protocol synthetic USD */
export const IUSD_POLICY_ID = 'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880';
// hex('iUSD') = 69555344
export const IUSD_ASSET_HEX = '69555344';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tokens supported by the x402 Cardano adapter */
export type CardanoToken = 'ADA' | 'iUSD' | 'USDM' | 'DJED' | 'USDCx';

/**
 * x402 Cardano payment payload.
 * Carries a fully-signed transaction in hex CBOR form, built by Lucid Evolution
 * on the client. The server deserialises it with CML to verify outputs without
 * re-building the transaction.
 */
export interface CardanoPaymentPayload {
  /** Fully-signed transaction as hex CBOR (built via Lucid Evolution) */
  transaction: string;
}

/** Minimum lovelace that must accompany any native-token UTxO */
export const MIN_ADA_LOVELACE = 2_000_000n;

/** Decimal places used by iUSD */
export const IUSD_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

export interface KnownToken {
  symbol: string;
  policyId: string;
  assetNameHex: string;
  decimals: number;
}

/**
 * Registry of known Cardano stablecoins supported by x402.
 * Key = Blockfrost/Lucid unit: policyId + assetNameHex.
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
