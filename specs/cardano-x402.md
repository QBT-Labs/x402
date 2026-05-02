# Cardano x402 Payment Scheme — Open Standard

**Version:** 1.0  
**Status:** Draft  
**Authors:** QBT Labs  
**Date:** 2026-05-02  

## Abstract

This document specifies the Cardano payment scheme for the x402 protocol — a multi-chain HTTP 402-based payment system for AI agents, MCP servers, and HTTP APIs. It defines the wire format, transaction structure, verification rules, token registry, and settlement flow for Cardano-based payments within x402.

## 1. Overview

The Cardano x402 scheme enables pay-per-call monetization using ADA and Cardano-native stablecoins. Unlike the EVM scheme (signature-only via EIP-3009) and Solana scheme (partially signed transaction), Cardano uses **fully signed transactions** built with Lucid Evolution and verified server-side via CML CBOR deserialization.

### 1.1 Design Principles

- **eUTXO-native**: Leverages Cardano's eUTXO model directly — no smart contracts required for simple payments.
- **Multi-token**: Supports ADA and four stablecoins out of the box; extensible via token registry.
- **Structural verification**: Server verifies transaction outputs without on-chain calls, enabling fast 402 resolution.
- **User-pays-gas**: Unlike EVM/Solana schemes where the facilitator covers gas, Cardano users pay ~0.17 ADA in transaction fees. This is a deliberate trade-off — Cardano's low fees make this negligible, and it avoids the complexity of a fee-payer co-signing pattern.

### 1.2 Comparison with Other x402 Schemes

| Aspect | EVM (Base) | Solana | **Cardano** |
|--------|-----------|--------|-------------|
| Pattern | Signature-only | PST (2 signatures) | Fully signed tx |
| Client library | viem | @solana/web3.js | Lucid Evolution |
| Server verification | Cryptographic | Structural + layout | CBOR structural |
| Gas model | Facilitator pays | Facilitator pays | User pays (~0.17 ADA) |
| Tokens | USDC | USDC | ADA + 4 stablecoins |
| Wire format | `authorization` + `signature` | `transaction` (base64) | `transaction` (hex CBOR) |
| Testnet | Sepolia | Devnet | Preprod |

## 2. Wire Format

### 2.1 Payment Requirements (402 Response)

When a server returns HTTP 402, it includes payment requirements for all configured chains. The Cardano-specific requirement uses the `exact_cardano` scheme:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact_cardano",
      "network": "cardano:mainnet",
      "asset": "iUSD",
      "amount": "10000",
      "payTo": "addr1q...",
      "maxTimeoutSeconds": 300
    }
  ]
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `scheme` | string | Must be `"exact_cardano"` |
| `network` | string | `"cardano:mainnet"` or `"cardano:preprod"` |
| `asset` | string | Token symbol: `"ADA"`, `"iUSD"`, `"USDM"`, `"DJED"`, or `"USDCx"` |
| `amount` | string | Required amount in on-chain units (lovelace for ADA, token units for others) |
| `payTo` | string | Recipient bech32 address |
| `maxTimeoutSeconds` | number | Maximum time for settlement |

### 2.2 Payment Payload (X-PAYMENT Header)

The client sends a base64-encoded JSON payload in the `X-PAYMENT` header:

```json
{
  "x402Version": 1,
  "payload": {
    "transaction": "84a400818258..."
  },
  "accepted": {
    "scheme": "exact_cardano",
    "network": "cardano:mainnet",
    "asset": "iUSD",
    "amount": "10000",
    "payTo": "addr1q...",
    "maxTimeoutSeconds": 300
  }
}
```

**Payload fields:**

| Field | Type | Description |
|-------|------|-------------|
| `payload.transaction` | string | Fully signed transaction as hex-encoded CBOR |

The `transaction` field contains a complete, signed Cardano transaction serialised as a hex string. It is built and signed entirely on the client side.

### 2.3 Network Detection

Network is determined from the recipient address prefix:

| Prefix | Network |
|--------|---------|
| `addr1` | `cardano:mainnet` |
| `addr_test1` | `cardano:preprod` |

## 3. Token Registry

### 3.1 Supported Tokens

| Token | Type | Policy ID | Asset Name (hex) | Decimals |
|-------|------|-----------|-------------------|----------|
| **ADA** | Native | — | `lovelace` | 6 (lovelace) |
| **iUSD** | Indigo synthetic | `f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880` | `69555344` | 6 |
| **USDM** | Mehen fiat-backed (CIP-68) | `c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad` | `0014df105553444d` | 6 |
| **DJED** | COTI/IOG overcollateralised | `8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61` | `446a65644d6963726f555344` | 6 |
| **USDCx** | Circle xReserve | `1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34` | `5553444378` | 6 |

### 3.2 Unit String Format

The Blockfrost/Lucid unit string for native tokens is: `{policyId}{assetNameHex}` (56 hex chars + asset name hex). ADA uses the string `"lovelace"`.

### 3.3 Min-ADA Requirement

All native-token UTxOs must include at least **2,000,000 lovelace** (2 ADA) to satisfy Cardano's minimum UTxO value rule. This is automatically included in token payment outputs.

### 3.4 Extending the Registry

Implementations MAY support additional Cardano native tokens by adding entries to their local registry with the same format: `{ symbol, policyId, assetNameHex, decimals }`. The `scheme` field remains `"exact_cardano"`.

## 4. Transaction Structure

### 4.1 Client-Side Construction

The client MUST:

1. Initialise Lucid Evolution with a Blockfrost provider for the target network
2. Load the wallet from a BIP-39 seed phrase (12 or 24 words)
3. Query available UTxOs and verify sufficient balance before building
4. Build a transaction with a single payment output to the merchant address:
   - **ADA payments**: Output contains `{ lovelace: amount }`
   - **Token payments**: Output contains `{ lovelace: MIN_ADA_LOVELACE, [unit]: amount }`
5. Sign the transaction with the wallet
6. Serialise to CBOR hex via `toCBOR()`

### 4.2 Balance Check

Before building, the client SHOULD check:

- **ADA payments**: `available_lovelace >= amount + 500_000` (0.5 ADA fee buffer)
- **Token payments**: `available_token_units >= amount`

If insufficient, throw a descriptive error rather than letting Lucid produce a cryptic coin selection failure.

### 4.3 Transaction Properties

- **Inputs**: Automatically selected by Lucid's coin selection
- **Outputs**: At least one output paying the required amount to the merchant
- **Fee**: Automatically calculated (~0.17 ADA typical)
- **Validity**: Default validity interval set by Lucid
- **Witnesses**: Single wallet signature (Ed25519)

## 5. Verification

### 5.1 Server-Side Verification

The server verifies payment structurally — no on-chain calls required. This enables sub-second verification:

1. **Parse CBOR**: Deserialise `payload.transaction` from hex CBOR using CML (`Transaction.from_cbor_hex`). If parsing fails → `INVALID_CBOR`.

2. **Inspect outputs**: Iterate transaction outputs looking for one that matches:
   - **Address**: Output address (bech32) matches `expectedAddress`
   - **ADA amount**: For ADA payments, `output.coin >= expectedAmount`
   - **Token amount**: For token payments:
     - `output.coin >= MIN_ADA_LOVELACE` (2 ADA)
     - Token amount in multi-asset map `>= expectedAmount` (matched by policyId + assetNameHex)

3. **Result**: If a matching output is found → `{ valid: true }`. Otherwise → `{ valid: false, error: "OUTPUT_MISMATCH" }`.

### 5.2 Verification Does NOT Check

- Transaction signatures (deferred to settlement/Blockfrost submission)
- UTxO availability (checked at submission time)
- Fee adequacy (Lucid ensures this at build time)

This is intentional: structural verification is sufficient for the 402 flow because the facilitator submits the transaction on-chain, which performs full validation.

## 6. Settlement

### 6.1 Submission via Blockfrost

After successful verification and tool execution, the facilitator submits the signed transaction:

```
POST {blockfrost_url}/tx/submit
Content-Type: application/cbor
project_id: {blockfrost_project_id}

{raw CBOR bytes}
```

The CBOR hex string is converted to raw bytes before submission.

### 6.2 Confirmation

Settlement is confirmed when the transaction appears on-chain. Implementations MAY poll via Lucid's `awaitTx(txHash)` or Blockfrost's transaction endpoint.

### 6.3 Network URLs

| Network | Blockfrost URL |
|---------|---------------|
| Mainnet | `https://cardano-mainnet.blockfrost.io/api/v0` |
| Preprod | `https://cardano-preprod.blockfrost.io/api/v0` |

## 7. Error Handling

| Error | When | Action |
|-------|------|--------|
| `INVALID_CBOR` | Transaction hex cannot be parsed | Client should rebuild and retry |
| `OUTPUT_MISMATCH` | No output matches expected recipient/amount/token | Client should verify parameters |
| `Insufficient {TOKEN} balance` | Wallet lacks funds | Client should top up or use a different token |
| Blockfrost 4xx | Transaction rejected at submission | Check UTxO availability, double-spend |
| Blockfrost 5xx | Blockfrost service error | Retry with backoff |

## 8. Security Considerations

- **No smart contracts**: Simple value transfers reduce attack surface.
- **Structural verification only**: The server does not execute arbitrary transaction logic — it only inspects outputs.
- **Min-ADA enforcement**: Token outputs must carry ≥2 ADA, preventing dust attacks.
- **Replay protection**: Cardano's eUTXO model provides inherent replay protection — once a UTxO is consumed, the transaction cannot be replayed.
- **Address validation**: Implementations MUST validate that the `payTo` address uses the correct network prefix before building transactions.

## 9. Reference Implementation

The reference implementation is available at [`@qbtlabs/x402`](https://www.npmjs.com/package/@qbtlabs/x402):

- **Client**: `src/chains/cardano.ts` — `signCardanoPayment()`
- **Server**: `src/chains/cardano.ts` — `verifyCardanoPayment()`
- **Settlement**: `src/chains/cardano.ts` — `submitCardanoTx()`
- **Types**: `src/types/cardano.types.ts` — Token registry and interfaces
- **Tests**: `src/__tests__/cardano*.test.ts` — Unit, integration, E2E, balance-check

## 10. Examples

### 10.1 Client: Pay with iUSD

```typescript
import { cardano } from '@qbtlabs/x402';

const payload = await cardano.signCardanoPayment({
  seed: 'word1 word2 ... word24',
  toAddress: 'addr1q...',
  amount: 10_000n,          // 0.01 iUSD
  token: 'iUSD',
  blockfrostProjectId: 'mainnetXXX',
});
// payload.transaction = "84a400818258..."
```

### 10.2 Server: Verify and Settle

```typescript
import { cardano } from '@qbtlabs/x402';

const { valid, error } = await cardano.verifyCardanoPayment(
  payload,
  'addr1q...',
  10_000n,
  'iUSD',
);

if (valid) {
  // Execute the tool, then settle
  const { txHash } = await cardano.submitCardanoTx(
    payload.transaction,
    'https://cardano-mainnet.blockfrost.io/api/v0',
    'mainnetXXX',
  );
}
```

### 10.3 Multi-Token Server Configuration

```typescript
import { configure, setToolPrices } from '@qbtlabs/x402';

configure({
  cardano: { address: 'addr1q...' },
  testnet: false,
});

// The 402 response will include accepts entries for all supported tokens
setToolPrices({
  get_data: 'read',     // $0.001 — payable in ADA, iUSD, USDM, DJED, or USDCx
  run_query: 'write',   // $0.01
});
```

## License

MIT © QBT Labs
