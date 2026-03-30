/**
 * Hono x402 Middleware
 *
 * Protect Hono routes with x402 payment requirements.
 *
 * Usage:
 *   import { x402Hono } from '@qbtlabs/x402/hono'
 *   app.get('/data', x402Hono({ tier: 'read' }), handler)
 *   app.post('/order', x402Hono({ toolName: 'place_order' }), handler)
 *
 * Note: Hono already works with withX402Server() since it uses the
 * Web Standard Request/Response API. This adapter provides idiomatic
 * Hono middleware using the Context API.
 */

import type { MiddlewareHandler } from 'hono';
import { isEnabled, getConfig, getActiveChains, USDC_CONTRACTS } from '../config.js';
import { getToolPrice, DEFAULT_TIERS } from '../pricing.js';
import type { PricingTier } from '../pricing.js';
import { parsePaymentHeader, verifyPayment } from '../verify.js';
import { buildFacilitatorRequirements, settleWithFacilitator } from '../facilitator.js';

export interface HonoX402Options {
  /** Exact price in USD. Ignored when toolName is provided. */
  price?: number;
  /** Pricing tier shorthand. Ignored when toolName is provided. */
  tier?: PricingTier;
  /** Registered tool name (via setToolPrice/setToolPrices). Enables settlement. */
  toolName?: string;
}

/**
 * Build V2-format payment requirements directly from a USD price.
 * Used when no toolName is available to look up pricing.
 */
function buildRequirementsForPrice(priceUsd: number): {
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    maxTimeoutSeconds: number;
    payTo: string;
    extra?: Record<string, unknown>;
  }>;
} {
  const cfg = getConfig();
  const chains = getActiveChains();
  const amountMicro = Math.ceil(priceUsd * 1_000_000).toString();
  const accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    maxTimeoutSeconds: number;
    payTo: string;
    extra?: Record<string, unknown>;
  }> = [];

  for (const chain of chains) {
    const asset = USDC_CONTRACTS[chain];
    if (!asset) continue;

    let payTo = '';
    if (chain.startsWith('eip155:')) payTo = cfg.evm?.address ?? '';
    else if (chain.startsWith('solana:')) payTo = cfg.solana?.address ?? '';
    else if (chain.startsWith('cardano:')) payTo = cfg.cardano?.address ?? '';
    if (!payTo) continue;

    accepts.push({
      scheme: 'exact',
      network: chain,
      asset,
      amount: amountMicro,
      maxTimeoutSeconds: 300,
      payTo,
      ...(chain.startsWith('eip155:') ? {
        extra: { name: chain === 'eip155:84532' ? 'USDC' : 'USD Coin', version: '2' },
      } : {}),
    });
  }

  return { accepts };
}

/**
 * Create Hono middleware that requires x402 payment.
 *
 * @param options - Pricing configuration for this route.
 *
 * If `toolName` is provided, pricing is looked up from the registered tool
 * price table and settlement is triggered after verification. Otherwise,
 * `price` / `tier` determine the charge and only verification is performed.
 */
export function x402Hono(options: HonoX402Options = {}): MiddlewareHandler {
  return async (c, next) => {
    if (!isEnabled()) {
      return next();
    }

    const pricing = options.toolName
      ? getToolPrice(options.toolName)
      : {
          tier: options.tier ?? ('read' as PricingTier),
          price: options.price ?? DEFAULT_TIERS[options.tier ?? 'read'],
        };

    if (pricing.price === 0) {
      return next();
    }

    const paymentHeader = c.req.header('x-payment');

    if (!paymentHeader) {
      const requirements = options.toolName
        ? buildFacilitatorRequirements(options.toolName)
        : buildRequirementsForPrice(pricing.price);

      return c.json({
        error: 'Payment Required',
        code: 402,
        price: pricing.price,
        priceFormatted: `$${pricing.price.toFixed(4)}`,
        ...requirements,
        message: `This endpoint requires payment of $${pricing.price.toFixed(4)} USDC.`,
      }, 402);
    }

    const payment = parsePaymentHeader(paymentHeader);
    if (!payment) {
      return c.json({ error: 'Invalid payment header format' }, 402);
    }

    const result = await verifyPayment(payment, pricing.price);
    if (!result.valid) {
      return c.json({ error: result.error ?? 'Payment verification failed' }, 402);
    }

    if (options.toolName) {
      settleWithFacilitator(payment, options.toolName).catch(console.error);
    }

    return next();
  };
}
