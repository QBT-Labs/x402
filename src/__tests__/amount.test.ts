import { usdToAtomic } from '../amount.js';

describe('usdToAtomic', () => {
  it('is exact where Math.ceil(usd * 1e6) overshoots by one unit', () => {
    expect(Math.ceil(4.03 * 1_000_000)).toBe(4030001); // the old behaviour
    expect(usdToAtomic(4.03)).toBe(4_030_000n);
    expect(usdToAtomic(8.05)).toBe(8_050_000n);
  });
  it('matches integer cents for every cent price up to $1,000, and every $0.0001 step up to $10', () => {
    for (let c = 1; c <= 100_000; c++) expect(usdToAtomic(c / 100)).toBe(BigInt(c) * 10_000n);
    for (let c = 1; c <= 100_000; c++) expect(usdToAtomic(c / 10_000)).toBe(BigInt(c) * 100n);
  });
  it('still rounds a genuinely sub-unit price up, never down', () => {
    expect(usdToAtomic(0.0000001)).toBe(1n);
    expect(usdToAtomic(0.0000015)).toBe(2n);
    expect(usdToAtomic(0)).toBe(0n);
  });
  it('rejects negative and non-finite amounts', () => {
    expect(() => usdToAtomic(-1)).toThrow();
    expect(() => usdToAtomic(NaN)).toThrow();
    expect(() => usdToAtomic(Infinity)).toThrow();
  });
});
