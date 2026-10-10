import { describe, it, expect } from '@jest/globals';
import { verifyTypedData } from 'viem';
import { buildPaymentPayloadWithAuthorization, parsePaymentRequired, signPayment } from '../client.js';

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x161DbdD73D025E9aEdd4918a67c28e5bf9A87Fb9';

// Shape of a live x402 v2 402 (api.babyblueviper.com/review, 2026-10-10), trimmed: a non-EVM option first.
const v2 = {
  x402Version: 2,
  error: 'X-PAYMENT header required',
  accepts: [
    { scheme: 'exact', network: 'xrpl:0', amount: '769560', asset: 'XRP', payTo: 'rhFHztjS63h6fs5vXgTotuL7jsuryUvDSF' },
    { scheme: 'exact', network: 'eip155:8453', asset: BASE_USDC, amount: '1080424', payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' } },
  ],
};

describe('parsePaymentRequired', () => {
  it('still parses an x402 v1 body', () => {
    expect(parsePaymentRequired({
      error: 'Payment Required', price: 0.001,
      accepts: [{ network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: PAY_TO, maxAmountRequired: '1000' }],
    })).toMatchObject({ price: 0.001, payTo: PAY_TO, network: 'eip155:84532', chainId: 84532, amountAtomic: '1000' });
  });
  it('parses an x402 v2 body: any error text, `amount`, and skips requirements it cannot pay', () => {
    const r = parsePaymentRequired(v2);
    expect(r).toMatchObject({ price: 1.080424, payTo: PAY_TO, network: 'eip155:8453', chainId: 8453, amountAtomic: '1080424' });
    expect(r!.accepted).toBe(v2.accepts.find((a: any) => a.amount === '1080424'));
  });
  it('skips a non-USDC asset and a non-exact scheme on an EVM chain', () => {
    expect(parsePaymentRequired({ x402Version: 2, accepts: [
      { scheme: 'exact', network: 'eip155:8453', asset: '0x0000000000000000000000000000000000000001', amount: '5', payTo: PAY_TO },
      { scheme: 'upto', network: 'eip155:8453', asset: BASE_USDC, amount: '5', payTo: PAY_TO },
    ] })).toBeNull();
  });
  it('returns null for a body that is neither v1 nor v2, or has nothing payable', () => {
    expect(parsePaymentRequired({ error: 'unknown', accepts: v2.accepts })).toBeNull();
    expect(parsePaymentRequired({ x402Version: 2, accepts: [] })).toBeNull();
    expect(parsePaymentRequired({ x402Version: 2, accepts: [{ network: 'eip155:8453', payTo: PAY_TO, amount: '1.5' }] })).toBeNull();
  });
});

describe('signPayment amountAtomic', () => {
  it('signs exactly the stated atomic amount, and the signature verifies over it', async () => {
    const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    const s = await signPayment({ privateKey, to: PAY_TO, amount: 999, amountAtomic: '1080424', chainId: 8453 });
    expect(s.value).toBe('1080424');
    const ok = await verifyTypedData({
      address: s.from as `0x${string}`,
      domain: { name: 'USD Coin', version: '2', chainId: 8453n, verifyingContract: BASE_USDC },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ] },
      primaryType: 'TransferWithAuthorization',
      message: { from: s.from as `0x${string}`, to: PAY_TO, value: 1080424n, validAfter: BigInt(s.validAfter), validBefore: BigInt(s.validBefore), nonce: s.nonce as `0x${string}` },
      signature: s.signature as `0x${string}`,
    });
    expect(ok).toBe(true);
  });
  it('echoes the offered requirement as `accepted` (v2 servers check maxTimeoutSeconds, extra) only when it matches', () => {
    const offered = { scheme: 'exact', network: 'eip155:8453', asset: BASE_USDC, amount: '24897', payTo: PAY_TO,
      maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' } };
    const auth = { from: PAY_TO, to: PAY_TO, value: '24897', validAfter: '0', validBefore: '9', nonce: '0x' + '11'.repeat(32) };
    const dec = (h: string) => JSON.parse(Buffer.from(h, 'base64').toString()).accepted;
    expect(dec(buildPaymentPayloadWithAuthorization({ signature: '0x', authorization: auth, chainId: 8453, accepted: offered }))).toEqual(offered);
    const other = dec(buildPaymentPayloadWithAuthorization({ signature: '0x', authorization: { ...auth, value: '1' }, chainId: 8453, accepted: offered }));
    expect(other).toEqual({ scheme: 'exact', network: 'eip155:8453', asset: BASE_USDC, amount: '1', payTo: PAY_TO });
  });
});
