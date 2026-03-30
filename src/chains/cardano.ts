/**
 * Cardano Chain Support
 *
 * Uses Lucid Evolution to build and sign transactions client-side (signCardanoPayment).
 * The payment payload carries the signed transaction as a hex CBOR string.
 * Server-side verification deserialises the CBOR via CML, inspects outputs, and
 * optionally submits via Blockfrost REST API.
 *
 * Supported tokens: ADA, iUSD, USDM, DJED, USDCx — see cardano.types.ts.
 */

// @lucid-evolution/lucid is loaded lazily inside async functions so that
// tests can mock the module before this file is imported, and so the heavy
// WASM initialisation only happens when actually needed.

export {
  IUSD_POLICY_ID,
  IUSD_ASSET_HEX,
  USDM_POLICY_ID,
  USDM_ASSET_HEX,
  DJED_POLICY_ID,
  DJED_ASSET_HEX,
  USDCX_POLICY_ID,
  USDCX_ASSET_HEX,
  MIN_ADA_LOVELACE,
  IUSD_DECIMALS,
  KNOWN_CARDANO_TOKENS,
  type CardanoToken,
  type CardanoPaymentPayload,
  type KnownToken,
} from './cardano.types.js';

import {
  IUSD_POLICY_ID,
  USDM_POLICY_ID,
  DJED_POLICY_ID,
  USDCX_POLICY_ID,
  USDM_ASSET_HEX,
  DJED_ASSET_HEX,
  USDCX_ASSET_HEX,
  MIN_ADA_LOVELACE,
  IUSD_DECIMALS,
  KNOWN_CARDANO_TOKENS,
  type CardanoToken,
  type CardanoPaymentPayload,
} from './cardano.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockfrostUrlForNetwork(network: 'Mainnet' | 'Preprod'): string {
  return network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
}

/**
 * Returns the Lucid/Blockfrost unit string for a token.
 * Format: `policyId (56 hex chars) + assetNameHex`. ADA uses `'lovelace'`.
 */
export function getTokenUnit(token: CardanoToken): string {
  switch (token) {
    case 'ADA':   return 'lovelace';
    case 'iUSD':  return `${IUSD_POLICY_ID}${Buffer.from('iUSD').toString('hex')}`;
    case 'USDM':  return `${USDM_POLICY_ID}${USDM_ASSET_HEX}`;
    case 'DJED':  return `${DJED_POLICY_ID}${DJED_ASSET_HEX}`;
    case 'USDCx': return `${USDCX_POLICY_ID}${USDCX_ASSET_HEX}`;
  }
}

export function detectNetwork(address: string): 'cardano' | 'cardano-preprod' {
  return address.startsWith('addr_test1') ? 'cardano-preprod' : 'cardano';
}

/**
 * Convert a human-readable USD amount to iUSD units.
 * @example iUSDToUnits(0.01) → 10_000n
 */
export function iUSDToUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** IUSD_DECIMALS));
}

/**
 * Convert a USD price to on-chain units for any supported Cardano token.
 * @example usdToCardanoUnits(0.01, 'iUSD') → 10_000n
 * @example usdToCardanoUnits(2.00, 'ADA')  → 2_000_000n  (lovelace)
 */
export function usdToCardanoUnits(priceUsd: number, token: CardanoToken): bigint {
  if (token === 'ADA') return BigInt(Math.round(priceUsd * 1_000_000));
  const knownToken = Object.values(KNOWN_CARDANO_TOKENS).find(t => t.symbol === token);
  const decimals = knownToken?.decimals ?? 6;
  return BigInt(Math.round(priceUsd * 10 ** decimals));
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

  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');

  const lucid = await Lucid(
    new Blockfrost(blockfrostUrlForNetwork(network), blockfrostProjectId),
    network,
  );
  lucid.selectWallet.fromSeed(seed);

  // Accumulate all UTxO assets to get wallet balances, then check before
  // attempting to build — gives a clear error instead of a cryptic Lucid one.
  const utxos = await lucid.wallet().getUtxos();
  const balances: Record<string, bigint> = {};
  for (const utxo of utxos) {
    for (const [unit, qty] of Object.entries(utxo.assets)) {
      balances[unit] = (balances[unit] ?? 0n) + qty;
    }
  }

  const unit      = getTokenUnit(token);
  const available = balances[unit] ?? 0n;
  if (token === 'ADA') {
    const required = amount + 500_000n; // 0.5 ADA buffer for fees
    if (available < required) {
      throw new Error(
        `Insufficient ADA balance: required ${required} lovelace, available ${available} lovelace`,
      );
    }
  } else {
    if (available < amount) {
      throw new Error(
        `Insufficient ${token} balance: required ${amount} units, available ${available} units`,
      );
    }
  }

  let assets: Record<string, bigint>;
  if (token === 'ADA') {
    assets = { lovelace: amount };
  } else {
    // Native-token outputs must include min-ADA or the node will reject the tx
    assets = { lovelace: MIN_ADA_LOVELACE, [getTokenUnit(token)]: amount };
  }

  const txSignBuilder = await lucid.newTx().pay.ToAddress(toAddress, assets).complete();
  const txSigned = await txSignBuilder.sign.withWallet().complete();
  return { transaction: txSigned.toCBOR() };
}

// ---------------------------------------------------------------------------
// verifyCardanoPayment — SERVER SIDE
// ---------------------------------------------------------------------------

/**
 * Verify a Cardano x402 payment payload — structural checks only, no chain calls.
 *
 * Checks:
 *   1. CBOR hex parses as a valid transaction
 *   2. At least one output pays ≥ expectedAmount of `token` to `expectedAddress`
 *      — for token payments, also enforces lovelace ≥ MIN_ADA_LOVELACE
 *
 * @param payload         Signed tx CBOR from the client
 * @param expectedAddress Recipient bech32 address that must appear in the outputs
 * @param expectedAmount  Required amount (lovelace for ADA, token units otherwise)
 * @param token           Token being paid; defaults to 'ADA'
 */
export async function verifyCardanoPayment(
  payload: CardanoPaymentPayload,
  expectedAddress: string,
  expectedAmount: bigint,
  token: CardanoToken = 'ADA',
): Promise<{ valid: boolean; error?: string }> {
  const { CML } = await import('@lucid-evolution/lucid');

  let cmlTx: ReturnType<typeof CML.Transaction.from_cbor_hex>;
  try {
    cmlTx = CML.Transaction.from_cbor_hex(payload.transaction);
  } catch {
    return { valid: false, error: 'INVALID_CBOR' };
  }

  const outputs = cmlTx.body().outputs();

  for (let i = 0; i < outputs.len(); i++) {
    const output = outputs.get(i);
    if (output.address().to_bech32(undefined) !== expectedAddress) continue;

    const value = output.amount();

    if (token === 'ADA') {
      if (value.coin() >= expectedAmount) return { valid: true };
    } else {
      if (value.coin() < MIN_ADA_LOVELACE) continue;

      const unit         = getTokenUnit(token);
      const multiAsset   = value.multi_asset();
      if (!multiAsset) continue;

      const policyHash   = CML.ScriptHash.from_hex(unit.slice(0, 56));
      const assetNameObj = CML.AssetName.from_hex(unit.slice(56));
      const tokenAmount  = multiAsset.get(policyHash, assetNameObj) ?? 0n;

      if (tokenAmount >= expectedAmount) return { valid: true };
    }
  }

  return { valid: false, error: 'OUTPUT_MISMATCH' };
}

// ---------------------------------------------------------------------------
// submitCardanoTx — FACILITATOR / SETTLEMENT
// ---------------------------------------------------------------------------

/**
 * Submit a signed Cardano transaction to the network via Blockfrost.
 *
 * Called by the facilitator after `verifyCardanoPayment` has confirmed the
 * transaction structure is correct.
 *
 * @param cborHex             Signed transaction in hex CBOR form
 * @param blockfrostUrl       Blockfrost base URL
 * @param blockfrostProjectId Blockfrost project_id header value
 * @param options.awaitConfirmation  When true, polls until the tx appears on-chain
 */
export async function submitCardanoTx(
  cborHex: string,
  blockfrostUrl: string,
  blockfrostProjectId: string,
  options?: { awaitConfirmation?: boolean },
): Promise<{ txHash: string }> {
  const res = await fetch(`${blockfrostUrl}/tx/submit`, {
    method: 'POST',
    headers: {
      'project_id': blockfrostProjectId,
      'Content-Type': 'application/cbor',
    },
    body: Buffer.from(cborHex, 'hex'),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Blockfrost submission failed (${res.status}): ${body}`);
  }

  const txHash = (await res.text()).replace(/"/g, '');

  if (options?.awaitConfirmation) {
    const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
    const network = blockfrostUrl.includes('preprod') ? 'Preprod' : 'Mainnet';
    const lucid   = await Lucid(new Blockfrost(blockfrostUrl, blockfrostProjectId), network);
    await lucid.awaitTx(txHash);
  }

  return { txHash };
}

// ---------------------------------------------------------------------------
// getCardanoWalletBalances — CLIENT SIDE
// ---------------------------------------------------------------------------

/**
 * Fetch the current token balances for a seed-based Cardano wallet.
 *
 * Returns a map from human-readable symbol → on-chain units, plus `lovelace`.
 * Useful for checking which stablecoins the wallet holds before calling
 * `signCardanoPayment`, enabling multi-token `accepts` logic.
 *
 * @example
 * const balances = await getCardanoWalletBalances({ seed, blockfrostProjectId: 'mainnetXXX' })
 * // { lovelace: 125000000n, iUSD: 0n, USDM: 500000n, DJED: 0n, USDCx: 0n }
 */
export async function getCardanoWalletBalances(options: {
  seed: string;
  blockfrostProjectId: string;
  network?: 'Mainnet' | 'Preprod';
}): Promise<Record<string, bigint>> {
  const { seed, blockfrostProjectId, network = 'Mainnet' } = options;

  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
  const lucid = await Lucid(
    new Blockfrost(blockfrostUrlForNetwork(network), blockfrostProjectId),
    network,
  );
  lucid.selectWallet.fromSeed(seed);

  const utxos = await lucid.wallet().getUtxos();

  const raw: Record<string, bigint> = {};
  for (const utxo of utxos) {
    for (const [unit, qty] of Object.entries(utxo.assets)) {
      raw[unit] = (raw[unit] ?? 0n) + qty;
    }
  }

  const totals: Record<string, bigint> = { lovelace: raw['lovelace'] ?? 0n };
  for (const [unit, token] of Object.entries(KNOWN_CARDANO_TOKENS)) {
    totals[token.symbol] = raw[unit] ?? 0n;
  }

  return totals;
}
