# @qbtlabs/x402

Multi-chain payment protocol for AI agents.

## Installation

```bash
npm install @qbtlabs/x402
```

## Quick Start

```typescript
import { configure, setToolPrices, withX402 } from '@qbtlabs/x402';

// Configure payment addresses
configure({
  evm: { address: '0x...' },
  solana: { address: 'So...' },
  testnet: true,
});

// Set tool pricing
setToolPrices({
  'get_ticker': 'read',      // $0.001
  'get_orderbook': 'read',   // $0.001
  'analyze': 'analysis',     // $0.005
  'place_order': 'write',    // $0.01
});

// Wrap MCP tool handlers
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

| Chain | Network | USDC Contract |
|-------|---------|---------------|
| Base Mainnet | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Solana Mainnet | `solana:mainnet` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Solana Devnet | `solana:devnet` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## Environment Variables

```bash
# Payment addresses
X402_EVM_ADDRESS=0x...
X402_SOLANA_ADDRESS=So...
X402_CARDANO_ADDRESS=addr1...

# Options
X402_TESTNET=true          # Use testnets
X402_VERIFY_MODE=full      # full | basic
```

## API

### `configure(config)`

Set payment configuration.

```typescript
configure({
  evm: { address: '0x...', chainId: 8453 },
  solana: { address: 'So...' },
  cardano: { address: 'addr1...' },
  testnet: false,
  verifyMode: 'full',
});
```

### `setToolPrices(prices)`

Set pricing for multiple tools.

```typescript
setToolPrices({
  'get_ticker': 'read',
  'place_order': { tier: 'write', price: 0.02 }, // Custom price
});
```

### `withX402(toolName, handler)`

Wrap an MCP tool handler with payment middleware.

```typescript
const wrappedHandler = withX402('get_ticker', async (params) => {
  // Your tool logic
  return { content: [{ type: 'text', text: '...' }] };
});
```

### `checkPayment(toolName, paymentSignature)`

Check payment before executing tool logic. Returns error response or null.

```typescript
const error = await checkPayment('get_ticker', params.paymentSignature);
if (error) return error;

// Continue with tool logic
```

## Verification Modes

| Mode | Speed | Security | Use Case |
|------|-------|----------|----------|
| `basic` | Fast | Low | Development |
| `full` | ~500ms | High | Production |

Full verification includes:
- EIP-712 typed data verification
- secp256k1 signature recovery
- On-chain balance check (optional)

## License

MIT © [QBT Labs](https://qbtlabs.io)
