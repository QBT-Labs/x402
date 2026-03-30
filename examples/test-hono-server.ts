/**
 * Live E2E Test — Hono Server
 * 
 * Run: npx tsx examples/test-hono-server.ts
 * 
 * Env vars:
 *   X402_EVM_ADDRESS=0xYourAddress   (required - receives USDC)
 *   X402_TESTNET=true                (optional - use Base Sepolia)
 *   X402_VERIFY_MODE=basic           (optional - skip on-chain check)
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { x402Hono } from '../dist/middleware/hono.js';

const app = new Hono();

// Free endpoint - no payment required
app.get('/', (c) => c.json({ message: 'x402 Hono Test Server', status: 'running' }));

// Protected endpoint - requires payment
app.get('/paid', x402Hono({ price: 0.001 }), (c) => {
  return c.json({ 
    message: 'Payment verified! You have access.',
    data: { ticker: 'BTC/USDT', price: 67500.00 }
  });
});

// Protected with tier
app.get('/premium', x402Hono({ tier: 'write' }), (c) => {
  return c.json({ 
    message: 'Premium access granted!',
    data: { secret: 'premium-content-here' }
  });
});

const port = 3001;
console.log(`
🚀 Hono x402 Test Server running on http://localhost:${port}

Env:
  X402_EVM_ADDRESS: ${process.env.X402_EVM_ADDRESS || '(not set - middleware disabled)'}
  X402_TESTNET: ${process.env.X402_TESTNET || 'false'}
  X402_VERIFY_MODE: ${process.env.X402_VERIFY_MODE || 'basic'}

Endpoints:
  GET /       → Free (no payment)
  GET /paid   → Requires $0.001 USDC
  GET /premium → Requires write-tier payment

Test commands:
  # 1. Free endpoint
  curl http://localhost:${port}/
  
  # 2. Paid endpoint (no payment - expect 402)
  curl http://localhost:${port}/paid
  
  # 3. Paid endpoint with mock payment header (basic mode)
  curl -H "x-payment: $(echo '{"x402Version":1,"payload":{"authorization":{"from":"0xaaaa000000000000000000000000000000000000","to":"YOUR_ADDRESS","value":"1000","validAfter":"0","validBefore":"9999999999","nonce":"0x0000000000000000000000000000000000000000000000000000000000000000"},"signature":"0x${'ab'.repeat(65)}"},"accepted":{"scheme":"exact","network":"eip155:8453","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","amount":"1000","payTo":"YOUR_ADDRESS"}}' | base64)" http://localhost:${port}/paid
`);

serve({ fetch: app.fetch, port });
