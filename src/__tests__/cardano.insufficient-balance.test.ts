/**
 * Cardano insufficient-balance tests.
 *
 * Verifies that signCardanoPayment throws clear errors when the wallet
 * does not hold the requested token.  Requires a live Blockfrost connection
 * because the balance check fetches UTxOs.
 *
 * Run:
 *   BLOCKFROST_PROJECT_ID=mainnetXXX \
 *   CARDANO_TEST_SEED="word1 ..." \
 *   CARDANO_MERCHANT_ADDRESS="addr1..." \
 *   npx jest --testPathPattern=cardano.insufficient-balance --runInBand
 */

import {
  signCardanoPayment,
  getCardanoWalletBalances,
  usdToCardanoUnits,
} from '../chains/cardano.js';

const PROJECT_ID = process.env.BLOCKFROST_PROJECT_ID ?? '';
const SEED        = process.env.CARDANO_TEST_SEED     ?? '';
const MERCHANT    = process.env.CARDANO_MERCHANT_ADDRESS ?? '';

const skip = !PROJECT_ID || !SEED || !MERCHANT;

const maybeIt = skip ? it.skip : it;

if (skip) {
  console.log(
    '[cardano.insufficient-balance] Skipped — set BLOCKFROST_PROJECT_ID, ' +
    'CARDANO_TEST_SEED, CARDANO_MERCHANT_ADDRESS to run.',
  );
}

const config = { seed: SEED, blockfrostProjectId: PROJECT_ID, network: 'Mainnet' as const };

describe('Cardano insufficient balance', () => {
  maybeIt('getCardanoWalletBalances shows zero USDM and USDCx', async () => {
    const balances = await getCardanoWalletBalances(config);
    expect(balances.USDM).toBe(0n);
    expect(balances.USDCx).toBe(0n);
    // Wallet used in tests holds iUSD
    expect(balances.iUSD).toBeGreaterThan(0n);
  }, 30_000);

  maybeIt('signCardanoPayment throws for USDM with clear error', async () => {
    await expect(
      signCardanoPayment({
        ...config,
        toAddress: MERCHANT,
        amount: usdToCardanoUnits(0.01, 'USDM'),
        token: 'USDM',
      }),
    ).rejects.toThrow(/Insufficient USDM balance/);
  }, 30_000);

  maybeIt('signCardanoPayment throws for USDCx with clear error', async () => {
    await expect(
      signCardanoPayment({
        ...config,
        toAddress: MERCHANT,
        amount: usdToCardanoUnits(0.01, 'USDCx'),
        token: 'USDCx',
      }),
    ).rejects.toThrow(/Insufficient USDCx balance/);
  }, 30_000);
});
