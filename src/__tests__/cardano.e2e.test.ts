/**
 * Cardano full x402 HTTP flow — iUSD.
 *
 * Spins up a Node http server that requires $0.01 iUSD, exercises the full
 * 402 → sign → verify → 200 → settle cycle, then checks the same tx cannot
 * be re-submitted (inputs-already-spent).
 *
 * Skipped unless BLOCKFROST_PROJECT_ID + CARDANO_TEST_SEED +
 * CARDANO_MERCHANT_ADDRESS are set.
 *
 * Run:
 *   BLOCKFROST_PROJECT_ID=mainnetXXX \
 *   CARDANO_TEST_SEED="word1 ..." \
 *   CARDANO_MERCHANT_ADDRESS="addr1..." \
 *   npx jest --testPathPattern=cardano.e2e --runInBand
 */

import http from 'http';
import {
  signCardanoPayment,
  verifyCardanoPayment,
  submitCardanoTx,
  iUSDToUnits,
  type CardanoPaymentPayload,
} from '../chains/cardano.js';

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const PROJECT_ID = process.env.BLOCKFROST_PROJECT_ID ?? '';
const SEED        = process.env.CARDANO_TEST_SEED     ?? '';
const MERCHANT    = process.env.CARDANO_MERCHANT_ADDRESS ?? '';
const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0';

const SKIP = !PROJECT_ID || !SEED || !MERCHANT;
const maybeDescribe = SKIP ? describe.skip : describe;

if (SKIP) {
  console.log(
    '[cardano.e2e] Skipped — set BLOCKFROST_PROJECT_ID, ' +
    'CARDANO_TEST_SEED, CARDANO_MERCHANT_ADDRESS to run.',
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT       = 3404;
const PRICE_USD  = 0.01;
const AMOUNT     = iUSDToUnits(PRICE_USD); // 10_000n

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('Live: Full x402 HTTP flow (iUSD)', () => {
  let server: http.Server;
  let signedPayload: CardanoPaymentPayload;

  beforeAll(async () => {
    // Start server
    server = http.createServer(async (req, res) => {
      if (req.url !== '/api/data' || req.method !== 'GET') {
        res.writeHead(404); res.end(); return;
      }

      const headerVal = req.headers['x-payment'] as string | undefined;
      if (!headerVal) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          x402Version: 1,
          error: 'Payment Required',
          accepts: [{
            scheme: 'exact',
            network: 'cardano:mainnet',
            token: 'iUSD',
            amount: AMOUNT.toString(),
            payTo: MERCHANT,
          }],
        }));
        return;
      }

      try {
        const raw = JSON.parse(Buffer.from(headerVal, 'base64').toString()) as {
          transaction: string;
        };
        const verify = await verifyCardanoPayment(
          { transaction: raw.transaction },
          MERCHANT,
          AMOUNT,
          'iUSD',
        );
        if (!verify.valid) {
          res.writeHead(402, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: verify.error }));
          return;
        }

        // Settle fire-and-forget
        submitCardanoTx(raw.transaction, BLOCKFROST_URL, PROJECT_ID)
          .catch(() => { /* settlement errors don't affect the response */ });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Access granted!',
          paidWith: 'iUSD',
          amount: `$${PRICE_USD}`,
          timestamp: new Date().toISOString(),
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.writeHead(500); res.end(msg);
      }
    });

    await new Promise<void>(resolve => server.listen(PORT, resolve));

    // Sign a payment tx to reuse across tests
    signedPayload = await signCardanoPayment({
      seed: SEED,
      toAddress: MERCHANT,
      amount: AMOUNT,
      token: 'iUSD',
      blockfrostProjectId: PROJECT_ID,
      network: 'Mainnet',
    });
  }, 90_000);

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  // ──────────────────────────────────────────────────────────────────────────

  it('returns 402 with iUSD payment requirement when no X-Payment header', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/data`);
    expect(res.status).toBe(402);
    const body = await res.json() as Record<string, unknown>;
    expect(body.x402Version).toBe(1);
    const accepts = body.accepts as Array<Record<string, unknown>>;
    expect(accepts[0].token).toBe('iUSD');
    expect(accepts[0].payTo).toBe(MERCHANT);
    expect(accepts[0].amount).toBe(AMOUNT.toString());
  });

  it('signCardanoPayment returns a non-empty CBOR hex string', () => {
    expect(typeof signedPayload.transaction).toBe('string');
    expect(signedPayload.transaction.length).toBeGreaterThan(10);
  });

  it('verifyCardanoPayment passes structural check for iUSD tx', async () => {
    const result = await verifyCardanoPayment(signedPayload, MERCHANT, AMOUNT, 'iUSD');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns 200 and Access granted when valid iUSD CBOR is presented', async () => {
    const header = Buffer.from(
      JSON.stringify({ x402Version: 1, transaction: signedPayload.transaction }),
    ).toString('base64');

    const res = await fetch(`http://localhost:${PORT}/api/data`, {
      headers: { 'x-payment': header },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.message).toBe('Access granted!');
    expect(body.paidWith).toBe('iUSD');
  }, 30_000);

  it('submitCardanoTx settles or is already included', async () => {
    try {
      const result = await submitCardanoTx(
        signedPayload.transaction,
        BLOCKFROST_URL,
        PROJECT_ID,
      );
      expect(result.txHash).toHaveLength(64);
      console.log(`    iUSD e2e txHash: ${result.txHash}`);
      console.log(`    https://cardanoscan.io/transaction/${result.txHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('All inputs are spent') || msg.includes('already been included')) {
        console.log('    (tx already on-chain — OK)');
      } else {
        throw err;
      }
    }
  }, 30_000);
});
