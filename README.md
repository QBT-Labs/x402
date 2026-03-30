# @qbtlabs/x402

Multi-chain payment protocol for AI agents. Enable pay-per-call monetization for MCP servers with automatic USDC micropayments on Base.

[![npm version](https://img.shields.io/npm/v/@qbtlabs/x402.svg)](https://www.npmjs.com/package/@qbtlabs/x402)
[![npm downloads](https://img.shields.io/npm/dm/@qbtlabs/x402.svg)](https://www.npmjs.com/package/@qbtlabs/x402)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Architecture

The x402 payment system uses a secure 6-layer architecture with process isolation:

```mermaid
sequenceDiagram
    autonumber

    participant Client as 🤖 MCP Client<br/>(Claude/Cursor)
    participant Vault as 🔐 Encrypted Vault<br/>(~/.x402/vault.enc)
    participant Signer as 🔏 x402 Signer<br/>(Isolated Process)
    participant Policy as 📋 Policy Engine<br/>(~/.x402/policy.json)
    participant Proxy as 🔄 x402 Proxy<br/>(Local)
    participant Server as ☁️ MCP Server<br/>(mcp.openmm.io)
    participant KMS as 🔑 AWS KMS<br/>(ES256)
    participant Facilitator as 💳 x402.org<br/>(Facilitator)
    participant Chain as ⛓️ Base L2<br/>(USDC)

    %% PHASE 1 — CLIENT SECURITY (Startup)
    rect rgb(232, 245, 233)
    Note over Vault, Signer: 🛡️ PHASE 1 — Client Security (Startup)

    Signer->>Vault: Unlock vault with password
    Note right of Vault: AES-256-GCM + PBKDF2<br/>decryption

    Vault-->>Signer: Private key decrypted
    Note right of Signer: Keys loaded in isolated<br/>memory — NEVER in<br/>agent process

    Note over Client, Signer: 🔒 SECURITY LAYER 1: Encrypted Vault (AES-256-GCM)<br/>~/.x402/vault.enc → wallet private key (payments)<br/>🔒 SECURITY LAYER 2: Process Isolation (keys never in agent memory)
    end

    %% PHASE 2 — TOOL CALL + PAYMENT
    rect rgb(227, 242, 253)
    Note over Client, Facilitator: 💰 PHASE 2 — Tool Call + Payment

    Client->>Proxy: tools/call (get_ticker)
    Proxy->>Server: Forward request
    Server-->>Proxy: HTTP 402 + payment requirements<br/>(payTo, amount, chainId)

    Proxy->>Policy: Check spending limits
    Note right of Policy: maxSpendPerTx: 10 USDC<br/>maxSpendPerDay: 100 USDC<br/>allowedChains: [base]<br/>allowedRecipients: [0x...]

    alt Policy REJECTED
        Policy-->>Proxy: ❌ Limit exceeded / recipient blocked
        Proxy-->>Client: Error: Payment policy denied
    else Policy APPROVED
        Policy-->>Proxy: ✅ Approved (within limits)
    end

    Note over Policy: 🔒 SECURITY LAYER 3: Policy Engine<br/>(spending limits, allowlists, audit log)

    Proxy->>Signer: Request signature (IPC)
    Note right of Signer: Sign EIP-3009<br/>TransferWithAuthorization<br/>(gasless)
    Signer-->>Proxy: Signature only (key stays in signer)

    Proxy->>Server: Retry with X-PAYMENT header
    end

    %% PHASE 3 — ON-CHAIN SETTLEMENT
    rect rgb(255, 243, 224)
    Note over Server, Chain: ⛓️ PHASE 3 — On-Chain Settlement

    Server->>Facilitator: Settlement request<br/>(payment payload)
    Facilitator->>Chain: Execute USDC transfer<br/>(EIP-3009 authorization)
    Chain-->>Facilitator: Transaction confirmed ✅
    Facilitator-->>Server: Payment receipt + tx hash

    Note over Chain: 🔒 SECURITY LAYER 4: On-chain settlement<br/>(verifiable, immutable, Base L2)
    end

    %% PHASE 4 — JWT ISSUANCE (post-settlement)
    rect rgb(237, 231, 246)
    Note over Server, KMS: 🔑 PHASE 4 — JWT Issuance (post-settlement receipt)

    Note right of Server: Payment confirmed on-chain ✅<br/>tx hash available → embed in JWT

    Server->>KMS: Sign JWT (ES256)
    Note right of KMS: JWT Payload:<br/>{user_id, exchange,<br/>tool, payment_tx, exp}<br/>↑ payment_tx = on-chain proof
    KMS-->>Server: Signed JWT

    Note over KMS: 🔒 SECURITY LAYER 5: AWS KMS JWT signing<br/>(keys never leave HSM, ES256)

    Server-->>Proxy: JWT (proof-of-payment receipt)
    Proxy-->>Client: Forward JWT to client
    end

    %% PHASE 5 — AUTHENTICATED LOCAL EXECUTION
    rect rgb(252, 228, 236)
    Note over Client, Proxy: 🚀 PHASE 5 — Authenticated Local Execution

    Client->>Proxy: Tool request + JWT
    Proxy->>Proxy: Verify JWT signature (cached public key)

    alt JWT INVALID
        Proxy-->>Client: ❌ Error: Invalid or expired JWT
    else JWT VALID
        Proxy->>Proxy: Decrypt exchange API keys<br/>from ~/.openmm/vault.enc
        Note right of Proxy: Exchange keys encrypted<br/>in ~/.openmm/vault.enc<br/>(AES-256-GCM)<br/>NEVER sent to cloud<br/>NEVER exposed to AI agent

        Proxy->>Proxy: Execute on exchange API (MEXC/Binance/etc)
        Proxy-->>Client: Return ticker data to Claude
    end

    Note over Proxy: 🔒 SECURITY LAYER 6: Local API Key Isolation<br/>(encrypted in ~/.openmm/vault.enc,<br/>NEVER sent to cloud,<br/>NEVER exposed to AI agent)
    end

    %% SECURITY SUMMARY
    Note over Client, Chain: ══════════ SECURITY LAYERS SUMMARY ══════════<br/>Layer 1: Encrypted Vault (~/.x402/vault.enc — wallet key, AES-256-GCM)<br/>Layer 2: Process Isolation (keys never in agent memory)<br/>Layer 3: Policy Engine (spending limits, allowlists, audit)<br/>Layer 4: On-chain Settlement (verifiable, immutable)<br/>Layer 5: AWS KMS JWT Signing (HSM-backed, post-settlement)<br/>Layer 6: Local API Key Isolation (encrypted vault + never leaves machine)
```

### 6 Security Layers

| Layer | Component | Protection |
|-------|-----------|------------|
| **1. Encrypted Vault** | `~/.x402/vault.enc` | Wallet key encrypted at rest (AES-256-GCM + PBKDF2) |
| **2. Process Isolation** | `x402-signer` | Keys never enter AI agent process memory |
| **3. Policy Engine** | `~/.x402/policy.json` | Spending limits, allowlists, audit logging |
| **4. On-chain Settlement** | Base L2 | Verifiable, immutable USDC transfers |
| **5. AWS KMS JWT** | ES256 signing | Server keys never leave HSM |
| **6. Local API Keys** | `~/.openmm/vault.enc` | Exchange credentials encrypted, never sent to cloud |

### Two Vaults

| Vault | Path | Contents |
|-------|------|----------|
| **x402 Vault** | `~/.x402/vault.enc` | Wallet private key (for payments) |
| **OpenMM Vault** | `~/.openmm/vault.enc` | Exchange API keys (for trading) |

Both use AES-256-GCM encryption with PBKDF2 key derivation.

## Security Architecture (v0.4.0+)

Private keys should never be exposed to AI agents. The x402 security layer provides three protection mechanisms:

```
┌───────────────────────────┐     ┌───────────────────────────┐
│    AI AGENT PROCESS       │     │    x402-signer PROCESS    │
│                           │     │    (isolated)             │
│  ┌─────────────────────┐ │     │  ┌─────────────────────┐  │
│  │ AI Agent (Claude)   │ │     │  │ Encrypted Vault     │  │
│  │                     │ │     │  │ ~/.x402/vault.enc   │  │
│  │ NO KEY ACCESS       │ │     │  │ (AES-256-GCM)       │  │
│  └──────────┬──────────┘ │     │  └──────────┬──────────┘  │
│             │            │     │             │              │
│  ┌──────────▼──────────┐ │     │  ┌──────────▼──────────┐  │
│  │ x402 Client Proxy   │ │     │  │ Policy Engine       │  │
│  │                     │◄┼─────┼─►│ - Max per tx        │  │
│  │ Forwards sign reqs  │ │ IPC │  │ - Max per day       │  │
│  └─────────────────────┘ │     │  │ - Allowed addresses │  │
│                          │     │  └──────────┬──────────┘  │
└──────────────────────────┘     │             │              │
                                 │  ┌──────────▼──────────┐  │
                                 │  │ Sign → Wipe Memory  │  │
                                 │  └─────────────────────┘  │
                                 └───────────────────────────┘
```

### Security Layers

| Layer | Component | Protection |
|-------|-----------|------------|
| **Encrypted Vault** | `~/.x402/vault.enc` | Keys encrypted at rest (AES-256-GCM, PBKDF2) |
| **Process Isolation** | `x402-signer` | Keys never enter AI agent process |
| **Policy Engine** | `~/.x402/policy.json` | Spending limits, allowlists, audit log |

### Vault CLI

```bash
# Initialize new vault (generates key)
x402 vault init

# Import existing key
x402 vault import
x402 vault import --from-env X402_PRIVATE_KEY

# Show wallet address (no decryption needed)
x402 vault address

# Change password
x402 vault passwd
```

### Policy Configuration

```json
// ~/.x402/policy.json
{
  "rules": {
    "maxSpendPerTx": { "amount": "10", "currency": "USDC" },
    "maxSpendPerDay": { "amount": "100", "currency": "USDC" },
    "allowedChains": ["base"],
    "allowedRecipients": ["0xfacilitator..."]
  },
  "audit": {
    "enabled": true,
    "logFile": "~/.x402/audit.log"
  }
}
```

### Policy CLI

```bash
# View current policy
x402 policy show

# Set spending limits
x402 policy set maxSpendPerTx 10 USDC
x402 policy set maxSpendPerDay 100 USDC

# View spending history
x402 policy spending
x402 policy spending --week

# View audit log
x402 policy audit
```

## Features

- **Multi-Client Support** — Works with Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP client
- **Client Proxy** — Automatic payment signing via stdio transport
- **Server Middleware** — Payment gating with zero tool-level changes
- **Payment-Aware Fetch** — Drop-in replacement for `fetch()` with payment handling
- **Multi-Chain** — Base (USDC) with Solana support planned
- **Testnet Ready** — Base Sepolia for development

## Installation

```bash
npm install @qbtlabs/x402
```

## Quick Start: Client Side

x402 works with any MCP client that supports stdio transport. Configure your preferred client below:

### Claude Code

Add to `~/.claude.json` (or `~/.claude/mcp_servers.json`):

```json
{
  "mcpServers": {
    "openmm": {
      "command": "npx",
      "args": ["@qbtlabs/x402", "client-proxy", "--target", "https://mcp.openmm.io/mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openmm": {
      "command": "npx",
      "args": ["@qbtlabs/x402", "client-proxy", "--target", "https://mcp.openmm.io/mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your workspace (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "openmm": {
      "command": "npx",
      "args": ["@qbtlabs/x402", "client-proxy", "--target", "https://mcp.openmm.io/mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "openmm": {
      "command": "npx",
      "args": ["@qbtlabs/x402", "client-proxy", "--target", "https://mcp.openmm.io/mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}
```

### Any MCP Client

The x402 proxy uses stdio transport, so it works with any MCP-compatible client. The configuration pattern is the same — just point your client to `npx @qbtlabs/x402 client-proxy`.

That's it! Your AI agent will now automatically pay for tool calls.

### Programmatic Client Usage

```typescript
import { createPaymentFetch } from '@qbtlabs/x402';

// Create a payment-aware fetch function
const paymentFetch = createPaymentFetch({
  privateKey: process.env.X402_PRIVATE_KEY,
  chainId: 84532, // Base Sepolia
});

// Use like regular fetch — payments happen automatically
const response = await paymentFetch('https://mcp.openmm.io/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'get_ticker', arguments: { exchange: 'mexc', symbol: 'BTC/USDT' } },
    id: 1,
  }),
});
```

## Quick Start: Server Side

### Cloudflare Worker with x402

```typescript
import { withX402Server, setToolPrices, configure } from '@qbtlabs/x402';

// Configure payment recipient
configure({
  evm: { address: process.env.X402_EVM_ADDRESS },
  testnet: process.env.X402_TESTNET === 'true',
});

// Set tool pricing
setToolPrices({
  list_exchanges: 'free',
  get_ticker: 'read',      // $0.001
  get_orderbook: 'read',   // $0.001
  place_order: 'write',    // $0.01
});

// Your MCP request handler
async function handleMcpRequest(request: Request): Promise<Response> {
  const body = await request.json();
  // ... handle MCP JSON-RPC
  return Response.json({ jsonrpc: '2.0', id: body.id, result: { /* ... */ } });
}

// Wrap with x402 payment gating
export default {
  fetch: withX402Server({
    handler: handleMcpRequest,
  }),
};
```

The middleware automatically:
- Passes free tools and non-tool requests through
- Returns 402 with payment requirements for paid tools
- Verifies payments via the facilitator
- Settles payments after successful execution

## API Reference

### Configuration

```typescript
import { configure, setToolPrices } from '@qbtlabs/x402';

// Configure payment settings
configure({
  evm: { address: '0x...' },        // Your USDC receiving address
  solana: { address: 'So...' },     // Optional: Solana address
  testnet: true,                     // Use Base Sepolia
  facilitatorUrl: 'https://x402.org', // Default facilitator
});

// Set pricing for tools
setToolPrices({
  'tool_name': 'free',      // $0
  'tool_name': 'read',      // $0.001
  'tool_name': 'analysis',  // $0.005
  'tool_name': 'write',     // $0.01
  'tool_name': 0.05,        // Custom price in USD
});
```

### Transport Layer

#### `createPaymentFetch(options)`

Creates a fetch function that automatically handles 402 responses.

```typescript
import { createPaymentFetch } from '@qbtlabs/x402';

const paymentFetch = createPaymentFetch({
  privateKey: '0x...',    // Wallet private key
  chainId: 84532,         // Chain ID (84532 = Base Sepolia, 8453 = Base)
});

const response = await paymentFetch(url, options);
```

#### `withX402Server(options)`

Middleware that wraps a request handler with payment gating.

```typescript
import { withX402Server } from '@qbtlabs/x402';

const handler = withX402Server({
  handler: async (request: Request) => Response,
  extractToolName: (body: unknown) => string | null,  // Optional custom extractor
});
```

### Proxy Layer

#### `createClientProxy(options)`

Creates a stdio-to-HTTP proxy with payment handling.

```typescript
import { createClientProxy } from '@qbtlabs/x402';

const proxy = createClientProxy({
  targetUrl: 'https://mcp.openmm.io/mcp',
  privateKey: '0x...',
  chainId: 84532,
});

await proxy.start();
```

#### `createPassthroughProxy(options)`

Creates a full MCP passthrough proxy.

```typescript
import { createPassthroughProxy } from '@qbtlabs/x402';

await createPassthroughProxy({
  targetUrl: 'https://mcp.openmm.io/mcp',
  privateKey: '0x...',
  mode: 'stdio',
});
```

### Client Utilities

```typescript
import { signPayment, buildPaymentPayload, parsePaymentRequired } from '@qbtlabs/x402';

// Parse 402 response
const requirements = parsePaymentRequired(response);

// Sign a payment
const signature = await signPayment({
  privateKey: '0x...',
  to: requirements.payTo,
  value: requirements.maxAmountRequired,
  chainId: 84532,
});

// Build the X-PAYMENT header value
const paymentHeader = buildPaymentPayload(signature, requirements);
```

### Facilitator Integration

```typescript
import {
  buildFacilitatorRequirements,
  verifyWithFacilitator,
  settleWithFacilitator,
} from '@qbtlabs/x402';

// Build 402 response requirements
const requirements = buildFacilitatorRequirements('get_ticker');

// Verify a payment
const result = await verifyWithFacilitator(paymentPayload, 'get_ticker');

// Settle after execution
await settleWithFacilitator(paymentPayload, 'get_ticker');
```

## Package Structure

```
src/
├── index.ts              # Main exports
├── config.ts             # Configuration (addresses, testnet)
├── pricing.ts            # Tool pricing tiers
├── verify.ts             # Payment verification
├── client.ts             # Client-side signing
├── facilitator.ts        # x402.org integration
├── chains/
│   ├── evm.ts            # EVM/Base utilities
│   └── solana.ts         # Solana utilities (planned)
├── transport/
│   ├── payment-fetch.ts  # Payment-aware fetch
│   └── server.ts         # Server middleware
├── proxy/
│   ├── client-proxy.ts   # Client proxy factory
│   └── passthrough.ts    # MCP passthrough proxy
├── middleware/
│   └── mcp.ts            # Legacy tool-level middleware
└── scripts/
    └── client-proxy.ts   # CLI entry point
```

## Environment Variables

### Client Side

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_PRIVATE_KEY` | Wallet private key for signing payments | Yes |
| `X402_CHAIN_ID` | Chain ID (84532=Sepolia, 8453=Mainnet) | No (default: 84532) |

### Server Side

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_EVM_ADDRESS` | USDC receiving wallet address | Yes |
| `X402_TESTNET` | Use testnet (Base Sepolia) | No (default: false) |
| `X402_FACILITATOR_URL` | Custom facilitator URL | No |

## Pricing Tiers

| Tier | Price | Use Case |
|------|-------|----------|
| `free` | $0.00 | Discovery, listing |
| `read` | $0.001 | Market data, queries |
| `analysis` | $0.005 | Computed insights |
| `write` | $0.01 | Transactions, mutations |

## Networks

| Network | Chain ID | USDC Contract |
|---------|----------|---------------|
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Related Projects

- [openmm-mcp](https://github.com/QBT-Labs/openmm-mcp) — MCP server using x402
- [x402 Protocol](https://x402.org) — Payment facilitator
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) — Model Context Protocol

## Testing

### Unit tests (no credentials required)

Runs all mocked tests. No network calls, no wallet needed.

```bash
npm test
```

To run only Cardano adapter tests:
```bash
npm test -- --testPathPattern=cardano
```

### Integration & E2E tests (live Cardano mainnet)

Requires a Blockfrost mainnet project ID, a funded wallet seed phrase, and a recipient address.

```bash
BLOCKFROST_PROJECT_ID=mainnetXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
CARDANO_TEST_SEED="word1 word2 word3 ... word24" \
CARDANO_MERCHANT_ADDRESS="addr1q..." \
npm test -- --testPathPattern=cardano
```

**What runs with credentials:**

| Test file | What it covers |
|---|---|
| `cardano.integration.test.ts` | ADA + iUSD live transfers, structural verify, Blockfrost submission |
| `cardano.e2e.test.ts` | Full HTTP 402 → sign → verify → 200 flow with iUSD |
| `cardano.insufficient-balance.test.ts` | USDM/USDCx throw clear errors when wallet has zero balance |

**Get a Blockfrost API key:** https://blockfrost.io (free tier available, select Mainnet)

**Get test ADA (Preprod):** https://docs.cardano.org/cardano-testnets/tools/faucet

## License

MIT © QBT Labs
