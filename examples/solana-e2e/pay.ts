/**
 * Solana x402 Payment Client
 * 
 * Generates a base64 X-Payment header for Solana devnet.
 * 
 * Required env vars:
 *   SOLANA_PRIVATE_KEY - JSON array of 64 bytes (from test-payer.json)
 *   X402_SOLANA_ADDRESS - Merchant pubkey
 *   FACILITATOR_PUBKEY - Fee payer (from facilitator /info)
 */

import { signSolanaPayment } from '../../dist/chains/solana.js';

async function main() {
  const privateKeyJson = process.env.SOLANA_PRIVATE_KEY;
  const merchantAddress = process.env.X402_SOLANA_ADDRESS;
  const facilitatorPubkey = process.env.FACILITATOR_PUBKEY;

  if (!privateKeyJson) {
    console.error('❌ SOLANA_PRIVATE_KEY required (JSON array from keypair file)');
    process.exit(1);
  }
  if (!merchantAddress) {
    console.error('❌ X402_SOLANA_ADDRESS required');
    process.exit(1);
  }
  if (!facilitatorPubkey) {
    console.error('❌ FACILITATOR_PUBKEY required (get from facilitator /info endpoint)');
    process.exit(1);
  }

  const privateKey = new Uint8Array(JSON.parse(privateKeyJson));

  console.error('Signing Solana payment...');
  console.error(`  To: ${merchantAddress}`);
  console.error(`  Amount: $0.001 (read tier)`);
  console.error(`  Fee Payer: ${facilitatorPubkey}`);

  const payload = await signSolanaPayment({
    privateKey,
    to: merchantAddress,
    amount: 0.001,
    network: 'solana:devnet',
    feePayer: facilitatorPubkey,
    rpcUrl: 'https://api.devnet.solana.com',
  });

  const header = Buffer.from(JSON.stringify({
    x402Version: 1,
    payload,
    accepted: {
      scheme: 'exact',
      network: 'solana:devnet',
      asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      amount: '1000',
      payTo: merchantAddress,
    },
  })).toString('base64');

  // Output only the header to stdout (logs go to stderr)
  console.log(header);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
