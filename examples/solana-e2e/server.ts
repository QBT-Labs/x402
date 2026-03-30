/**
 * Solana x402 Test Server
 * 
 * Run: X402_SOLANA_ADDRESS=<merchant> X402_TESTNET=true npx tsx examples/solana-e2e/server.ts
 */

import express from 'express';
import { configure } from '../../dist/index.js';
import { x402Express } from '../../dist/middleware/express.js';

const merchantAddress = process.env.X402_SOLANA_ADDRESS;
if (!merchantAddress) {
  console.error('❌ X402_SOLANA_ADDRESS is required');
  process.exit(1);
}

configure({
  solana: { address: merchantAddress },
  testnet: true,
});

const app = express();

app.get('/', (req, res) => {
  res.json({ status: 'ok', merchant: merchantAddress });
});

app.get('/data', x402Express({ tier: 'read' }), (req, res) => {
  res.json({ 
    result: 'premium data', 
    timestamp: Date.now(),
    message: 'Payment verified! You have Solana x402 access.'
  });
});

const port = 3000;
app.listen(port, () => {
  console.log(`
🚀 Solana x402 Test Server running on http://localhost:${port}

Merchant: ${merchantAddress}
Network:  solana:devnet
Tier:     read ($0.001)

Endpoints:
  GET /      → Health check (free)
  GET /data  → Protected (requires x402 payment)

Test:
  curl http://localhost:${port}/data  # → 402
`);
});
