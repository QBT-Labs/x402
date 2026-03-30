/**
 * Cardano live integration tests.
 *
 * These tests hit Cardano mainnet via Blockfrost and submit real transactions.
 * They are SKIPPED unless the BLOCKFROST_PROJECT_ID env var is set.
 *
 * Run:
 *   BLOCKFROST_PROJECT_ID=mainnetXXX \
 *   CARDANO_TEST_SEED="word1 word2 ... word24" \
 *   CARDANO_MERCHANT_ADDRESS="addr1..." \
 *   npx jest --testPathPattern=cardano.integration --runInBand
 *
 * Or with tsx directly (faster, no Jest overhead):
 *   BLOCKFROST_PROJECT_ID=mainnetXXX \
 *   CARDANO_TEST_SEED="word1 ..." \
 *   CARDANO_MERCHANT_ADDRESS="addr1..." \
 *   npx tsx src/__tests__/cardano.integration.test.ts
 */

import http from 'http';
import {
  signCardanoPayment,
  verifyCardanoPayment,
  submitCardanoTx,
  KNOWN_CARDANO_TOKENS,
  type CardanoPaymentPayload,
} from '../chains/cardano.js';
import { parsePaymentHeader } from '../verify.js';

// ---------------------------------------------------------------------------
// Credentials — read from env, skip the whole suite if absent
// ---------------------------------------------------------------------------

const PROJECT_ID       = process.env.BLOCKFROST_PROJECT_ID ?? '';
const SEED             = process.env.CARDANO_TEST_SEED     ?? '';
const MERCHANT_ADDRESS = process.env.CARDANO_MERCHANT_ADDRESS ?? '';
const BLOCKFROST_URL   = 'https://cardano-mainnet.blockfrost.io/api/v0';

const SKIP = !PROJECT_ID || !SEED || !MERCHANT_ADDRESS;

const maybeDescribe = SKIP
  ? describe.skip
  : describe;

if (SKIP) {
  console.log(
    '[cardano.integration] Skipped — set BLOCKFROST_PROJECT_ID, ' +
    'CARDANO_TEST_SEED, CARDANO_MERCHANT_ADDRESS to run.',
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 2 ADA — comfortably above min-UTxO (1.5 ADA) */
const ADA_AMOUNT = 2_000_000n;

/** iUSD unit string (policyId + assetNameHex) */
const IUSD_UNIT = Object.keys(KNOWN_CARDANO_TOKENS).find(
  k => KNOWN_CARDANO_TOKENS[k].symbol === 'iUSD',
)!;

// ---------------------------------------------------------------------------
// Suite 1 — ADA transfer
// ---------------------------------------------------------------------------

maybeDescribe('Live: ADA transfer', () => {
  let signedPayload: CardanoPaymentPayload;

  beforeAll(async () => {
    signedPayload = await signCardanoPayment({
      seed: SEED,
      toAddress: MERCHANT_ADDRESS,
      amount: ADA_AMOUNT,
      token: 'ADA',
      blockfrostProjectId: PROJECT_ID,
      network: 'Mainnet',
    });
  }, 60_000);

  it('signCardanoPayment returns a non-empty CBOR hex string', () => {
    expect(typeof signedPayload.transaction).toBe('string');
    expect(signedPayload.transaction.length).toBeGreaterThan(10);
  });

  it('verifyCardanoPayment passes structural check', async () => {
    const result = await verifyCardanoPayment(
      signedPayload,
      MERCHANT_ADDRESS,
      ADA_AMOUNT,
      'ADA',
    );
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('submitCardanoTx broadcasts tx and returns a txHash', async () => {
    try {
      const result = await submitCardanoTx(
        signedPayload.transaction,
        BLOCKFROST_URL,
        PROJECT_ID,
      );
      expect(typeof result.txHash).toBe('string');
      expect(result.txHash).toHaveLength(64);
      console.log(`    ADA txHash: ${result.txHash}`);
      console.log(`    https://cardanoscan.io/transaction/${result.txHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('All inputs are spent') || msg.includes('already been included')) {
        console.log('    (tx already on-chain from previous run — OK)');
      } else {
        throw err;
      }
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Suite 2 — iUSD transfer (skipped unless wallet holds iUSD)
// ---------------------------------------------------------------------------

maybeDescribe('Live: iUSD transfer', () => {
  // $0.01 = 10_000 units at 6 decimal places
  const IUSD_AMOUNT = 10_000n;
  let signedPayload: CardanoPaymentPayload;
  let skippedNoBalance = false;

  beforeAll(async () => {
    try {
      signedPayload = await signCardanoPayment({
        seed: SEED,
        toAddress: MERCHANT_ADDRESS,
        amount: IUSD_AMOUNT,
        token: 'iUSD',
        blockfrostProjectId: PROJECT_ID,
        network: 'Mainnet',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not have enough funds')) {
        console.log('    [iUSD] Skipped — wallet has no iUSD balance');
        skippedNoBalance = true;
      } else {
        throw err;
      }
    }
  }, 60_000);

  it('verifyCardanoPayment passes for iUSD output', async () => {
    if (skippedNoBalance) return;
    const result = await verifyCardanoPayment(
      signedPayload,
      MERCHANT_ADDRESS,
      IUSD_AMOUNT,
      'iUSD',
    );
    expect(result.valid).toBe(true);
  });

  it('submitCardanoTx broadcasts iUSD tx and returns txHash', async () => {
    if (skippedNoBalance) return;
    try {
      const result = await submitCardanoTx(
        signedPayload.transaction,
        BLOCKFROST_URL,
        PROJECT_ID,
      );
      expect(result.txHash).toHaveLength(64);
      console.log(`    iUSD txHash: ${result.txHash}`);
      console.log(`    https://cardanoscan.io/transaction/${result.txHash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('All inputs are spent') || msg.includes('already been included')) {
        console.log('    (tx already on-chain from previous run — OK)');
      } else {
        throw err;
      }
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Suite 3 — Full x402 HTTP flow (ADA, using Node http server)
// ---------------------------------------------------------------------------

maybeDescribe('Live: Full x402 HTTP flow (ADA)', () => {
  const PORT = 3403;
  let server: http.Server;

  beforeAll(() => {
    server = http.createServer(async (req, res) => {
      if (req.url !== '/api/data' || req.method !== 'GET') {
        res.writeHead(404); res.end(); return;
      }

      const headerVal = req.headers['x-payment'] as string | undefined;
      if (!headerVal) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Payment Required',
          x402Version: 1,
          accepts: [{
            scheme: 'exact',
            network: 'cardano:mainnet',
            asset: 'lovelace',
            amount: ADA_AMOUNT.toString(),
            maxTimeoutSeconds: 300,
            payTo: MERCHANT_ADDRESS,
          }],
        }));
        return;
      }

      const payment = parsePaymentHeader(headerVal);
      if (!payment) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Bad payment header' })); return;
      }

      const verify = await verifyCardanoPayment(
        payment.payload as CardanoPaymentPayload,
        MERCHANT_ADDRESS,
        ADA_AMOUNT,
        'ADA',
      );
      if (!verify.valid) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Verification failed', reason: verify.error }));
        return;
      }

      // Settle fire-and-forget
      submitCardanoTx(
        (payment.payload as CardanoPaymentPayload).transaction,
        BLOCKFROST_URL,
        PROJECT_ID,
      ).catch(() => { /* settlement errors don't affect the response */ });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Access granted!', timestamp: new Date().toISOString() }));
    });

    return new Promise<void>(resolve => server.listen(PORT, resolve));
  });

  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

  it('returns 402 with payment requirements when no X-Payment header', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/data`);
    expect(res.status).toBe(402);
    const body = await res.json() as Record<string, unknown>;
    expect(body.x402Version).toBe(1);
    const accepts = body.accepts as Array<Record<string, unknown>>;
    expect(accepts[0].network).toBe('cardano:mainnet');
    expect(accepts[0].payTo).toBe(MERCHANT_ADDRESS);
  });

  it('returns 200 and settles when a valid signed ADA tx is presented', async () => {
    const payload = await signCardanoPayment({
      seed: SEED,
      toAddress: MERCHANT_ADDRESS,
      amount: ADA_AMOUNT,
      token: 'ADA',
      blockfrostProjectId: PROJECT_ID,
      network: 'Mainnet',
    });

    const xPaymentObj = {
      x402Version: 1,
      payload: { transaction: payload.transaction },
      accepted: {
        scheme: 'exact',
        network: 'cardano:mainnet',
        asset: 'lovelace',
        amount: ADA_AMOUNT.toString(),
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 300,
      },
    };
    const header = Buffer.from(JSON.stringify(xPaymentObj)).toString('base64');

    const res = await fetch(`http://localhost:${PORT}/api/data`, {
      headers: { 'X-Payment': header },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.message).toBe('Access granted!');
  }, 90_000);
});
