# Solana x402 E2E Test (Devnet)

End-to-end test of the Solana x402 payment flow using devnet USDC.

## Prerequisites

1. **Solana CLI** installed
2. **Test wallet** with devnet SOL + USDC
3. **Merchant wallet** address

## Setup

### 1. Generate wallets

```bash
# Client wallet (needs USDC)
solana-keygen new --outfile ~/.config/solana/test-payer.json --no-bip39-passphrase

# Merchant wallet (receives payment)
solana-keygen new --outfile ~/.config/solana/merchant.json --no-bip39-passphrase
```

### 2. Fund client wallet

Get devnet SOL:
- https://faucet.solana.com

Get devnet USDC:
- https://spl-token-faucet.com/?token-name=USDC (select Devnet)

Verify:
```bash
solana balance --url devnet --keypair ~/.config/solana/test-payer.json
spl-token balance 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
```

### 3. Set environment

```bash
export X402_SOLANA_ADDRESS=$(solana-keygen pubkey ~/.config/solana/merchant.json)
export X402_TESTNET=true
export SOLANA_PRIVATE_KEY=$(cat ~/.config/solana/test-payer.json)
```

## Run Test

### Terminal 1: Start server

```bash
cd /path/to/x402
npx tsx examples/solana-e2e/server.ts
```

### Terminal 2: Test

```bash
# 1. Probe (expect 402)
curl -s http://localhost:3000/data | jq .

# 2. Get facilitator pubkey
export FACILITATOR_PUBKEY=$(curl -s https://x402.org/facilitator/info | jq -r .solanaFeePayer)

# 3. Generate payment
PAYMENT=$(npx tsx examples/solana-e2e/pay.ts)

# 4. Send with payment (expect 200)
curl -s -H "X-Payment: $PAYMENT" http://localhost:3000/data | jq .
```

## What's happening

1. **Client** builds a VersionedTransaction with:
   - `SetComputeUnitLimit` (ix 0)
   - `SetComputeUnitPrice` (ix 1)
   - `TransferChecked` USDC (ix 2)
   - `Memo` with nonce (ix 3)

2. **Client** partially signs (only their signature)

3. **Server** verifies structure, returns 200

4. **Facilitator** (async):
   - Co-signs as fee payer
   - Submits to devnet
   - Returns tx hash

Key difference from EVM: Solana uses a real partially-signed transaction, not just a signature. The facilitator pays SOL fees.
