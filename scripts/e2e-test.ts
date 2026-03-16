#!/usr/bin/env npx tsx
/**
 * x402 E2E Test - Full payment flow with real testnet transaction
 * 
 * This test:
 * 1. Signs an EIP-3009 payment authorization
 * 2. Verifies the signature
 * 3. Submits to Base Sepolia and executes the transfer
 * 4. Shows the transaction hash on block explorer
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { signPayment, buildPaymentPayload } from '../src/client.js';

const USDC_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RECEIVER = '0xbFf6130b8BDE4531a724e1c9402Afbad0c66D3Bb';

const USDC_ABI = parseAbi([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function balanceOf(address account) view returns (uint256)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
]);

function splitSignature(signature: string): { v: number; r: `0x${string}`; s: `0x${string}` } {
  const sig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const r = ('0x' + sig.slice(0, 64)) as `0x${string}`;
  const s = ('0x' + sig.slice(64, 128)) as `0x${string}`;
  const v = parseInt(sig.slice(128, 130), 16);
  return { v, r, s };
}

async function main() {
  const privateKey = process.env.X402_PRIVATE_KEY as `0x${string}`;
  
  if (!privateKey) {
    console.error('❌ X402_PRIVATE_KEY required');
    console.error('Usage: X402_PRIVATE_KEY=0x... npx tsx scripts/e2e-test.ts');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  
  console.log('🧪 x402 E2E Test - Real Testnet Transaction');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Network: Base Sepolia (testnet)`);
  console.log(`💳 Wallet: ${account.address}`);
  console.log(`📨 Receiver: ${RECEIVER}`);
  console.log('');

  // Create clients
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  // Check balances
  console.log('📊 Checking balances...');
  const usdcBalance = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const ethBalance = await publicClient.getBalance({ address: account.address });
  
  console.log(`   USDC: ${Number(usdcBalance) / 1_000_000} USDC`);
  console.log(`   ETH: ${Number(ethBalance) / 1e18} ETH`);
  
  if (usdcBalance < 1000n) {
    console.error('❌ Insufficient USDC balance (need at least 0.001 USDC)');
    process.exit(1);
  }
  if (ethBalance < 100000000000000n) {
    console.error('❌ Insufficient ETH for gas');
    process.exit(1);
  }

  // Step 1: Sign payment
  console.log('');
  console.log('📝 Step 1: Signing EIP-3009 authorization...');
  const payment = await signPayment({
    privateKey,
    to: RECEIVER,
    amount: 0.001, // $0.001 = 1000 micro USDC
    chainId: 84532,
    validForSeconds: 300,
  });
  
  console.log(`   ✅ Signed!`);
  console.log(`   From: ${payment.from}`);
  console.log(`   To: ${payment.to}`);
  console.log(`   Value: ${payment.value} micro USDC ($${Number(payment.value) / 1_000_000})`);
  console.log(`   Nonce: ${payment.nonce.slice(0, 18)}...`);

  // Step 2: Build payload (what would be sent to MCP server)
  console.log('');
  console.log('📦 Step 2: Building x402 payload...');
  const payload = buildPaymentPayload(payment);
  console.log(`   ✅ Payload: ${payload.slice(0, 40)}...`);

  // Step 3: Check if nonce already used
  console.log('');
  console.log('🔍 Step 3: Verifying nonce is unused...');
  const nonceUsed = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: USDC_ABI,
    functionName: 'authorizationState',
    args: [account.address, payment.nonce as `0x${string}`],
  });
  
  if (nonceUsed) {
    console.error('❌ Nonce already used! Try again.');
    process.exit(1);
  }
  console.log('   ✅ Nonce is fresh');

  // Step 4: Execute the transfer on-chain
  console.log('');
  console.log('⛓️  Step 4: Executing transferWithAuthorization on-chain...');
  
  const { v, r, s } = splitSignature(payment.signature);
  
  try {
    const txHash = await walletClient.writeContract({
      address: USDC_SEPOLIA,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        payment.from as `0x${string}`,
        payment.to as `0x${string}`,
        BigInt(payment.value),
        BigInt(payment.validAfter),
        BigInt(payment.validBefore),
        payment.nonce as `0x${string}`,
        v,
        r,
        s,
      ],
    });

    console.log(`   ✅ Transaction submitted!`);
    console.log(`   📜 TX Hash: ${txHash}`);
    console.log('');
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    if (receipt.status === 'success') {
      console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}!`);
      console.log('');
      console.log('🎉 SUCCESS! Real USDC transferred on Base Sepolia!');
      console.log('');
      console.log(`🔗 View on Basescan:`);
      console.log(`   https://sepolia.basescan.org/tx/${txHash}`);
    } else {
      console.log(`   ❌ Transaction failed`);
      console.log(`   Receipt: ${JSON.stringify(receipt, null, 2)}`);
    }
  } catch (error: any) {
    console.error(`   ❌ Transaction failed: ${error.message}`);
    if (error.cause) {
      console.error(`   Cause: ${JSON.stringify(error.cause, null, 2)}`);
    }
  }

  // Final balance check
  console.log('');
  console.log('📊 Final balances:');
  const finalUsdcBalance = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: USDC_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`   USDC: ${Number(finalUsdcBalance) / 1_000_000} USDC`);
  console.log(`   Change: ${(Number(finalUsdcBalance) - Number(usdcBalance)) / 1_000_000} USDC`);
}

main().catch(console.error);
