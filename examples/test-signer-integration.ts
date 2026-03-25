/**
 * Test x402 Signer Integration
 * 
 * Run with: npx tsx examples/test-signer-integration.ts
 */

import { SignerClient } from '../src/signer/client.js';

async function main() {
  console.log('🔗 Connecting to signer...\n');
  
  const client = new SignerClient({
    socketPath: '/tmp/x402-signer.sock'
  });

  // Test 1: Check if available
  console.log('1️⃣ Checking signer availability...');
  const available = await client.isAvailable();
  console.log(`   Result: ${available ? '✅ Available' : '❌ Not available'}\n`);
  
  if (!available) {
    console.log('❌ Signer not running. Start with:');
    console.log('   npx tsx src/scripts/signer-cli.ts start');
    process.exit(1);
  }

  // Test 2: Get address (no key exposure)
  console.log('2️⃣ Getting wallet address...');
  const address = await client.getAddress();
  console.log(`   Address: ${address}\n`);

  // Test 3: Sign a test payment
  console.log('3️⃣ Signing test payment...');
  console.log('   To: 0x1234...7890');
  console.log('   Amount: 1 USDC');
  console.log('   Chain: Base Sepolia (84532)');
  
  try {
    const signature = await client.sign({
      to: '0x1234567890123456789012345678901234567890',
      amount: '1000000', // 1 USDC (6 decimals)
      chainId: 84532,    // Base Sepolia
    });
    console.log(`   ✅ Signature: ${signature.slice(0, 20)}...${signature.slice(-10)}\n`);
  } catch (error) {
    console.log(`   ❌ Error: ${(error as Error).message}\n`);
  }

  // Test 4: Policy violation test
  console.log('4️⃣ Testing policy violation (amount > limit)...');
  try {
    await client.sign({
      to: '0x1234567890123456789012345678901234567890',
      amount: '50000000000', // 50,000 USDC - should exceed daily limit
      chainId: 84532,
    });
    console.log('   ⚠️ No policy violation (unexpected)\n');
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('Policy')) {
      console.log(`   ✅ Policy blocked: ${msg}\n`);
    } else {
      console.log(`   ❌ Error: ${msg}\n`);
    }
  }

  console.log('✨ Integration test complete!');
}

main().catch(console.error);
