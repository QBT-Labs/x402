/**
 * Generate a mock x402 payment header for testing (basic verify mode)
 * 
 * Usage: npx tsx examples/generate-mock-payment.ts 0xYourAddress
 */

const address = process.argv[2] || '0x1234567890123456789012345678901234567890';

const payload = {
  x402Version: 1,
  payload: {
    authorization: {
      from: '0xaaaa000000000000000000000000000000000000',
      to: address,
      value: '1000', // 0.001 USDC (micro units)
      validAfter: '0',
      validBefore: String(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
      nonce: '0x' + '00'.repeat(32),
    },
    signature: '0x' + 'ab'.repeat(65),
  },
  accepted: {
    scheme: 'exact',
    network: 'eip155:8453', // Base mainnet
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    amount: '1000',
    payTo: address,
  },
};

const header = Buffer.from(JSON.stringify(payload)).toString('base64');

console.log(`
Generated mock payment header for: ${address}

Header (base64):
${header}

Curl command:
curl -H "x-payment: ${header}" http://localhost:3001/paid

Full test flow:
1. Set env: export X402_EVM_ADDRESS=${address}
2. Run server: npx tsx examples/test-hono-server.ts
3. Test: curl -H "x-payment: ${header}" http://localhost:3001/paid
`);
