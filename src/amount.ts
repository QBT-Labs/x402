/**
 * USD -> USDC atomic units (6 decimals).
 *
 * `Math.ceil(usd * 1_000_000)` overshoots by one unit whenever the float product lands just above an integer,
 * e.g. 4.03 * 1_000_000 = 4030000.0000000005 -> 4030001. Over cent prices up to $1,000 that is 3,038 of 100,000.
 * Here a product within 1e-6 of an integer is that integer; a genuinely sub-unit remainder still rounds up,
 * so a price is never under-charged.
 */
export function usdToAtomic(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid USD amount: ${usd}`);
  const scaled = usd * 1_000_000;
  const nearest = Math.round(scaled);
  return BigInt(Math.abs(scaled - nearest) < 1e-6 ? nearest : Math.ceil(scaled));
}
