# CLAUDE.md — @qbtlabs/x402

## Project overview

`@qbtlabs/x402` is a multi-chain payment protocol SDK for AI agents, MCP servers, and HTTP APIs. It enables monetisation via the x402 standard (HTTP 402 Payment Required): any tool or endpoint can gate access behind a micropayment, settled on-chain in USDC.

- **Chain status**: Base L2 (EVM) ✅ production | Solana in progress | Cardano planned
- **npm**: `@qbtlabs/x402`
- **Protocol**: x402 v1 — payment is a base64-encoded JSON header sent as `X-PAYMENT` (HTTP) or `paymentSignature` param (MCP)
- **Currency**: USDC, 6 decimal places (`1_000_000 = $1.00`)

---

## Repository structure

```
src/
├── index.ts            # Re-exports everything public
├── config.ts           # configure(), getConfig(), USDC_CONTRACTS
├── pricing.ts          # setToolPrices(), buildPaymentRequirements(), DEFAULT_TIERS
├── verify.ts           # parsePaymentHeader(), verifyPayment() — chain router
├── client.ts           # signPayment(), buildPaymentPayload(), parsePaymentRequired()
├── facilitator.ts      # verifyWithFacilitator(), settleWithFacilitator(), processPayment()
├── chains/
│   ├── evm.ts          # verifyPayment(), signEIP3009(), EvmPaymentPayload
│   └── solana.ts       # verifyPayment(), SolanaPaymentPayload (stub)
├── middleware/
│   └── mcp.ts          # withX402() tool wrapper, checkPayment()
├── transport/
│   ├── payment-fetch.ts  # createPaymentFetch() — fetch with auto 402 handling
│   ├── server.ts         # withX402Server() — Web Standard Request/Response middleware
│   └── simple-http.ts    # SimpleHTTPTransport (JSON-RPC over HTTP, no SSE)
├── proxy/
│   ├── client-proxy.ts   # createClientProxy() — payment-aware MCP proxy
│   └── passthrough.ts    # createPassthroughProxy()
├── signer/
│   ├── server.ts         # SignerServer — isolated process, holds private keys
│   ├── client.ts         # SignerClient — IPC to signer over Unix socket or subprocess
│   └── types.ts          # SignRequest, SignResponse, SignerConfig
├── vault/
│   └── crypto.ts         # Vault — AES-256-GCM encrypted key storage (PBKDF2)
├── policy/
│   └── engine.ts         # PolicyEngine — spending limits, allowlists, audit log
└── split/
    ├── client.ts         # createSplitClient()
    ├── gate.ts           # wrapWithSplitPayment()
    └── jwt.ts            # verifyJWT(), fetchPublicKey()
```

---

## Chain adapter contract

Every chain adapter lives in `src/chains/{chain}.ts` and must export:

```typescript
// Payload interface — the signed proof-of-payment
export interface {Chain}PaymentPayload {
  // chain-specific fields
}

// Server-side: validate that a payload is legitimate and covers the price
export async function verifyPayment(
  payment: {Chain}PaymentPayload,
  expectedAmount: number         // USD, e.g. 0.001
): Promise<{ valid: boolean; error?: string }>

// Client-side: sign a payment (if implementing full client support)
export async function sign{Chain}(...): Promise<...>
```

`verify.ts` is the single routing entry point — it switches on `payment.accepted.network`:

```typescript
if (network.startsWith('eip155:'))  → verifyEvmPayment()
if (network.startsWith('solana:'))  → verifySolanaPayment()
if (network.startsWith('cardano:')) → not yet implemented
```

`buildPaymentRequirements()` in `pricing.ts` reads `getActiveChains()` from `config.ts`, which is populated by `configure()`. Adding a new chain requires touching all three.

---

## Core flow

### Server side

1. `configure({ evm: { address }, testnet: true })` — sets the receiver address(es)
2. `setToolPrices({ get_ticker: 'read', place_order: 'write' })` — maps tool names to tiers
3. Wrap handlers: `server.tool('get_ticker', schema, withX402('get_ticker', handler))`
   - `withX402()` reads `paymentSignature` from MCP params
   - Returns a 402-like JSON error with `buildPaymentRequirements()` output if missing/invalid
   - **Or** use `withX402Server(handler)` for HTTP — intercepts `X-PAYMENT` header, verifies + settles via facilitator before calling `handler`

### Client side

1. `parsePaymentRequired(response)` — extracts `accepts[]` from a 402 response
2. `signPayment(requirement, privateKey)` — dispatches to the right chain signer
3. `buildPaymentPayload(signed)` — base64-encodes for the header
4. Retry with `X-PAYMENT: <base64>` header
   - `createPaymentFetch()` automates steps 1–4

### Verification routing (verify.ts)

`verifyPayment(payment, expectedAmount)`:
- Reads `payment.accepted.network` prefix
- Calls chain-specific verifier
- Returns `{ valid, error?, details? }`

---

## Pricing tiers

Defined in `src/pricing.ts`:

| Tier       | Default USD |
|------------|-------------|
| `free`     | $0.000      |
| `read`     | $0.001      |
| `analysis` | $0.005      |
| `write`    | $0.010      |

Amounts are stored as USDC micro-units: `Math.ceil(priceUsd * 1_000_000)`.

---

## USDC contract addresses

From `src/config.ts`:

| Network           | Address |
|-------------------|---------|
| `eip155:8453`     | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base mainnet) |
| `eip155:84532`    | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Base Sepolia) |
| `solana:mainnet`  | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `solana:devnet`   | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

EIP-712 domain name for USDC: `"USDC"` on Base Sepolia (`chainId 84532`), `"USD Coin"` on mainnet.

---

## Dependencies

Direct:

| Package | Purpose |
|---------|---------|
| `viem ^2.47.4` | EVM: `privateKeyToAccount`, `signTypedData` (EIP-3009) |
| `@noble/curves ^2.0.0` | Low-level elliptic curve crypto |
| `@noble/hashes ^2.0.0` | Hashing utilities |
| `@modelcontextprotocol/sdk ^1.12.0` | MCP server/transport types |

`@solana/web3.js` and `@noble/ed25519` are **not** currently in dependencies — the Solana adapter (`src/chains/solana.ts`) is a stub that verifies structure only, no cryptographic proof yet.

---

## Coding conventions

- **TypeScript strict** (`"strict": true` in tsconfig)
- **Named exports only** — no default exports anywhere
- **ESM throughout** — `"type": "module"`, `.js` extensions on all internal imports
- **Pure functions in `chains/`** — no Express/Hono/Node.js-specific deps; chain modules must be importable in Workers/Deno
- **Framework-specific code** goes in `transport/` or separate entry points
- **No `console.log`** in library code; use `console.warn` only for degraded-mode notices
- USDC amounts are always integers (micro-units, `bigint` or `string` representing bigint)
- `verifyMode: 'basic'` (default) validates structure + business rules; `'full'` adds on-chain crypto (currently warns and falls back to basic for EVM)

---

## Branch and commit rules

- Branch naming: `feat/qbt-{issue-number}-{short-description}`
- Commit style: `feat(qbt-NNN): short description`
- **Never** include "Claude" or "Co-Authored-By: Claude" in any commit message
- **Never** commit `.env`, private keys, or secrets
- Keep chain modules free of Node.js-only APIs

---

## Key Linear issues

| Issue | Topic |
|-------|-------|
| QBT-596 | Solana adapter (full cryptographic verification) |
| QBT-595 | Cardano adapter |
| QBT-597 | Docs update |
| QBT-594 | Express adapter |
| QBT-598 | MCP Proxy CLI |

---

## Binary entry points

| Command | Source |
|---------|--------|
| `x402-proxy` / `qbtlabs-x402` | `src/scripts/client-proxy.ts` |
| `x402-vault` | `src/scripts/vault-cli.ts` |
| `x402-signer` | `src/scripts/signer-cli.ts` |
| `x402-policy` | `src/scripts/policy-cli.ts` |

---

## Testing

```bash
npm test                    # jest with --experimental-vm-modules
npm run test:coverage
npm run build               # tsc → dist/
```

Tests live in `src/__tests__/`. Use real chain IDs in tests, not mocks of network state (on-chain verification paths not yet implemented anyway — stick to unit tests of payload parsing + amount checks).
