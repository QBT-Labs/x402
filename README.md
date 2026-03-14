# @qbtlabs/x402

Multi-chain payment protocol for AI agents.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              x402 Payment Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│          │         │          │         │          │         │          │
│  Agent   │         │   MCP    │         │   x402   │         │  Chain   │
│ (Client) │         │  Server  │         │ Middleware│         │ (USDC)   │
│          │         │          │         │          │         │          │
└────┬─────┘         └────┬─────┘         └────┬─────┘         └────┬─────┘
     │                    │                    │                    │
     │  1. Call Tool      │                    │                    │
     │ ─────────────────> │                    │                    │
     │                    │                    │                    │
     │                    │  2. Check Payment  │                    │
     │                    │ ─────────────────> │                    │
     │                    │                    │                    │
     │                    │  3. No Payment     │                    │
     │                    │ <───────────────── │                    │
     │                    │                    │                    │
     │  4. 402 Response   │                    │                    │
     │     + Payment Req  │                    │                    │
     │ <───────────────── │                    │                    │
     │                    │                    │                    │
     │  5. Sign Payment   │                    │                    │
     │    (EIP-3009)      │                    │                    │
     │ ──────────────────────────────────────────────────────────> │
     │                    │                    │                    │
     │  6. Retry + Sig    │                    │                    │
     │ ─────────────────> │                    │                    │
     │                    │                    │                    │
     │                    │  7. Verify Payment │                    │
     │                    │ ─────────────────> │                    │
     │                    │                    │                    │
     │                    │                    │  8. Check Sig      │
     │                    │                    │ ─────────────────> │
     │                    │                    │                    │
     │                    │                    │  9. Valid          │
     │                    │                    │ <───────────────── │
     │                    │                    │                    │
     │                    │ 10. Payment OK     │                    │
     │                    │ <───────────────── │                    │
     │                    │                    │                    │
     │ 11. Execute Tool   │                    │                    │
     │     & Return       │                    │                    │
     │ <───────────────── │                    │                    │
     │                    │                    │                    │
```

## Payment Flow Steps

| Step | Component | Action |
|------|-----------|--------|
| 1 | Agent | Calls MCP tool (e.g., `get_ticker`) |
| 2 | Server | Passes request through `withX402()` middleware |
| 3 | x402 | No payment signature found |
| 4 | Server | Returns 402 with payment requirements |
| 5 | Agent | Signs EIP-3009 authorization (gasless) |
| 6 | Agent | Retries request with `paymentSignature` |
| 7 | Server | Middleware receives payment signature |
| 8 | x402 | Verifies signature against chain |
| 9 | Chain | Confirms signature validity |
| 10 | x402 | Returns verification success |
| 11 | Server | Executes tool, returns result |

## 402 Response Format

When payment is required, the server returns:

```json
{
  "error": "Payment Required",
  "code": 402,
  "tool": "get_ticker",
  "price": 0.001,
  "priceFormatted": "$0.0010",
  "accepts": [
    {
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000",
      "payTo": "0x..."
    }
  ],
  "message": "This tool requires payment of $0.0010 USDC."
}
```

## Payment Signature Format

The agent signs an EIP-3009 `TransferWithAuthorization` and sends:

```json
{
  "x402Version": 1,
  "payload": {
    "authorization": {
      "from": "0xAgentWallet",
      "to": "0xServerWallet",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "1710432000",
      "nonce": "0x..."
    },
    "signature": "0x..."
  },
  "accepted": {
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000",
    "payTo": "0x..."
  }
}
```

This payload is base64-encoded and sent as `paymentSignature` parameter.

## Installation

```bash
npm install @qbtlabs/x402
```

## Quick Start

```typescript
import { configure, setToolPrices, withX402 } from '@qbtlabs/x402';

configure({
  evm: { address: '0x...' },
  testnet: true,
});

setToolPrices({
  'get_ticker': 'read',
  'place_order': 'write',
});

server.tool('get_ticker', schema, withX402('get_ticker', handler));
```

## Pricing Tiers

| Tier | Price | Use Case |
|------|-------|----------|
| `free` | $0 | Public data |
| `read` | $0.001 | Market data, balances |
| `analysis` | $0.005 | Complex queries |
| `write` | $0.01 | Transactions |

## Supported Chains

| Chain | Network ID | USDC Contract | Status |
|-------|------------|---------------|--------|
| Base Mainnet | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | ✅ |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | ✅ |
| Solana Mainnet | `solana:mainnet` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | ✅ |
| Solana Devnet | `solana:devnet` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | ✅ |
| Cardano | `cardano:mainnet` | — | 🚧 |

## Environment Variables

```bash
X402_EVM_ADDRESS=0x...
X402_SOLANA_ADDRESS=So...
X402_CARDANO_ADDRESS=addr1...
X402_TESTNET=true
X402_VERIFY_MODE=full
```

## Verification Modes

| Mode | Speed | Security | Use Case |
|------|-------|----------|----------|
| `basic` | <1ms | Validates structure | Development |
| `full` | ~100ms | Cryptographic verification | Production |

**Basic mode validates:**
- Payment amount ≥ required
- Recipient matches configured address
- Authorization not expired
- Signature format valid

**Full mode adds:**
- EIP-712 typed data verification
- secp256k1 signature recovery
- Signer matches `from` address

## API Reference

### `configure(config)`

```typescript
configure({
  evm: { address: '0x...', chainId: 8453 },
  solana: { address: 'So...' },
  testnet: false,
  verifyMode: 'full',
});
```

### `setToolPrices(prices)`

```typescript
setToolPrices({
  'get_ticker': 'read',
  'place_order': { tier: 'write', price: 0.02 },
});
```

### `withX402(toolName, handler)`

```typescript
const handler = withX402('get_ticker', async (params) => {
  return { content: [{ type: 'text', text: '...' }] };
});
```

### `checkPayment(toolName, paymentSignature)`

```typescript
const error = await checkPayment('get_ticker', params.paymentSignature);
if (error) return error;
```

## License

MIT © [QBT Labs](https://qbtlabs.io)
