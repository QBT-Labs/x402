# Skill: Add a Chain Adapter to @qbtlabs/x402

This playbook walks through adding a new chain (e.g. Cardano, Aptos, Sui) to `@qbtlabs/x402`. Follow every step in order — the chain won't wire up correctly if any step is skipped.

Reference implementation: `src/chains/evm.ts` (EIP-3009 / Base L2).

---

## Step 1 — Create `src/chains/{chainname}.ts`

### 1a. Define the payload interface

The payload is what the client sends as proof of payment. It must be serialisable to JSON (goes into the base64 `X-PAYMENT` header).

```typescript
// src/chains/cardano.ts
export interface CardanoPaymentPayload {
  txHash: string;       // on-chain transaction hash
  from: string;         // sender address
  to: string;           // recipient address
  amount: string;       // USDC micro-units as decimal string (6 decimals)
  policyId: string;     // USDC policy ID on Cardano
}
```

Model this on `EvmPaymentPayload` (in `src/chains/evm.ts`) and `SolanaPaymentPayload` (in `src/chains/solana.ts`).

### 1b. Implement `verifyPayment()`

```typescript
import { getConfig } from '../config.js';

export async function verifyPayment(
  payment: CardanoPaymentPayload,
  expectedAmount: number       // USD, e.g. 0.001
): Promise<{ valid: boolean; error?: string }> {
  const cfg = getConfig();

  // 1. Amount check (USDC has 6 decimals)
  const paidAmount = BigInt(payment.amount);
  const requiredAmount = BigInt(Math.ceil(expectedAmount * 1_000_000));
  if (paidAmount < requiredAmount) {
    return { valid: false, error: `Insufficient: ${paidAmount} < ${requiredAmount}` };
  }

  // 2. Recipient check
  if (payment.to !== cfg.cardano?.address) {
    return { valid: false, error: 'Wrong recipient' };
  }

  // 3. Cryptographic verification (optional in 'basic' mode)
  if (cfg.verifyMode === 'full') {
    // TODO: verify txHash on-chain or via signature
  }

  return { valid: true };
}
```

Rules:
- Always do the amount check first (cheapest, fails fast).
- Always do the recipient check second.
- Cryptographic / on-chain checks go last — gate them behind `cfg.verifyMode === 'full'`.
- Return `{ valid: false, error: '...' }` for every failure path. Never throw.
- No `console.log` — use `console.warn` only for degraded-mode notices.
- No Node.js-only APIs (`fs`, `path`, `process.env` directly) — use `getConfig()` for config reads so the adapter stays Workers/Deno-compatible.

### 1c. Implement a client-side signing helper (if applicable)

```typescript
export interface SignCardanoOptions {
  privateKey: string;       // hex or bech32 private key
  to: string;               // recipient address
  amount: bigint;           // USDC micro-units
  // ...
}

export async function signCardano(options: SignCardanoOptions): Promise<{
  signature: string;
  payload: CardanoPaymentPayload;
}> {
  // Use @noble/ed25519 or chain SDK
  // ...
}
```

---

## Step 2 — Add USDC contract address to `src/config.ts`

`USDC_CONTRACTS` maps network identifier → USDC token address. The network identifier format is `{prefix}:{network}`.

```typescript
// src/config.ts
export const USDC_CONTRACTS: Record<string, string> = {
  'eip155:8453':    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // Base mainnet
  'eip155:84532':   '0x036CbD53842c5426634e7929541eC2318f3dCF7e',  // Base Sepolia
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:devnet':  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  // ADD:
  'cardano:mainnet': '<USDC_POLICY_ID_ON_CARDANO_MAINNET>',
  'cardano:preprod': '<USDC_POLICY_ID_ON_CARDANO_PREPROD>',
};
```

---

## Step 3 — Wire `getActiveChains()` in `src/config.ts`

`getActiveChains()` returns the list of `network` strings for all configured chains. `buildPaymentRequirements()` calls this to generate the `accepts[]` array in the 402 response.

```typescript
// src/config.ts
export function getActiveChains(): string[] {
  const cfg = getConfig();
  const chains: string[] = [];

  if (cfg.evm?.address) {
    const chainId = cfg.testnet ? 84532 : 8453;
    chains.push(`eip155:${chainId}`);
  }

  if (cfg.solana?.address) {
    chains.push(cfg.testnet ? 'solana:devnet' : 'solana:mainnet');
  }

  // ADD:
  if (cfg.cardano?.address) {
    chains.push(cfg.testnet ? 'cardano:preprod' : 'cardano:mainnet');
  }

  return chains;
}
```

`buildPaymentRequirements()` in `src/pricing.ts` already handles the new chain via the `cardano:` branch:

```typescript
} else if (chain.startsWith('cardano:')) {
  payTo = cfg.cardano?.address ?? '';
}
```

That branch is already present — no changes needed in `pricing.ts`.

---

## Step 4 — Wire into `src/verify.ts`

`verifyPayment()` in `verify.ts` is the single routing entry point. Add an import and a new branch:

```typescript
// src/verify.ts
import { verifyPayment as verifyEvmPayment, type EvmPaymentPayload } from './chains/evm.js';
import { verifyPayment as verifySolanaPayment, type SolanaPaymentPayload } from './chains/solana.js';
// ADD:
import { verifyPayment as verifyCardanoPayment, type CardanoPaymentPayload } from './chains/cardano.js';

// Update PaymentPayload union:
export interface PaymentPayload {
  x402Version: number;
  payload: EvmPaymentPayload | SolanaPaymentPayload | CardanoPaymentPayload;  // ADD
  accepted: { ... };
  resource?: { url: string };
}

// In verifyPayment():
if (network.startsWith('cardano:')) {
  return verifyCardanoPayment(
    payment.payload as CardanoPaymentPayload,
    expectedAmount
  );
}
```

Remove the stub `if (network.startsWith('cardano:')) { return { valid: false, error: 'Cardano verification not yet implemented' }; }` line.

---

## Step 5 — Add chain config to `X402Config` (if not already there)

`src/config.ts` already has `cardano?: ChainConfig`. If adding a completely new chain:

```typescript
// src/config.ts
export interface X402Config {
  evm?: ChainConfig & { chainId?: number };
  solana?: ChainConfig;
  cardano?: ChainConfig;
  mychain?: ChainConfig;   // ADD
  testnet?: boolean;
  verifyMode?: 'basic' | 'full';
  facilitatorUrl?: string;
}
```

Also add the env-variable fallback in `getConfig()`:

```typescript
mychain: config.mychain || (process.env.X402_MYCHAIN_ADDRESS ? {
  address: process.env.X402_MYCHAIN_ADDRESS,
} : undefined),
```

And update `isEnabled()`:

```typescript
export function isEnabled(): boolean {
  const cfg = getConfig();
  return !!(cfg.evm?.address || cfg.solana?.address || cfg.cardano?.address || cfg.mychain?.address);
}
```

---

## Step 6 — Add to the exports map in `package.json`

```json
"./chains/cardano": {
  "types": "./dist/chains/cardano.d.ts",
  "import": "./dist/chains/cardano.js"
}
```

Also re-export from `src/chains/index.ts` so `import { chains } from '@qbtlabs/x402'` includes it:

```typescript
// src/chains/index.ts
export * as evm from './evm.js';
export * as solana from './solana.js';
export * as cardano from './cardano.js';   // ADD
```

---

## Step 7 — Testing checklist

### Unit tests (always required before opening a PR)

- [ ] `verifyPayment` rejects amount below threshold
- [ ] `verifyPayment` rejects wrong recipient address
- [ ] `verifyPayment` accepts a valid payload
- [ ] `getActiveChains()` includes the new chain when configured
- [ ] `buildPaymentRequirements()` emits the correct `network`, `asset`, and `payTo` for the new chain
- [ ] `verifyPayment` in `verify.ts` routes correctly on `{prefix}:` network strings

### Devnet / testnet integration

- [ ] Deploy a test payment to devnet/preprod
- [ ] Verify the raw payload parses correctly (`parsePaymentHeader`)
- [ ] Verify the full `verifyPayment` path returns `{ valid: true }` for a real payment
- [ ] Verify `verifyMode: 'full'` path (once implemented)

### Mainnet

- [ ] Only promote after devnet tests pass in CI
- [ ] Update `USDC_CONTRACTS` with audited mainnet address (check official issuer, not community docs)
- [ ] Add mainnet chain ID to `getActiveChains()` behind `!cfg.testnet`

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Importing chain adapter directly instead of going through `verify.ts` | Always use `verifyPayment` from `'./verify.js'` in middleware/transport |
| Using decimal amounts for USDC | All amounts are stored as integer micro-units: `Math.ceil(usd * 1_000_000)` |
| Comparing addresses with `===` on EVM (mixed case) | Use `.toLowerCase()` on both sides for EVM hex addresses |
| Throwing errors instead of returning `{ valid: false, error }` | Chain adapters must never throw — return the error struct |
| Adding Node.js `crypto` or `fs` to `src/chains/` directly | Use `getConfig()` for config, dynamic `import()` for optional heavy deps |
| Forgetting `.js` extension on local imports | ESM + NodeNext resolution requires `.js` on all local imports, even for `.ts` source files |
| Missing the `getActiveChains()` branch | Results in the chain never appearing in 402 responses even when configured |
| Hardcoding `chainId` instead of reading `cfg.testnet` | Always derive testnet vs mainnet from `cfg.testnet` flag |
