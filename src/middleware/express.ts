/**
 * Express.js x402 Middleware
 *
 * Protect Express routes with x402 payment requirements.
 *
 * Usage:
 *   import { x402Express } from '@qbtlabs/x402/express'
 *   app.get('/data', x402Express({ tier: 'read' }), handler)
 *   app.post('/order', x402Express({ toolName: 'place_order' }), handler)
 */

import type { Request, Response, NextFunction } from 'express';
import { isEnabled, getConfig, getActiveChains, USDC_CONTRACTS } from '../config.js';
import { getToolPrice, DEFAULT_TIERS } from '../pricing.js';
import type { PricingTier } from '../pricing.js';
import { parsePaymentHeader, verifyPayment } from '../verify.js';
import { buildFacilitatorRequirements, settleWithFacilitator } from '../facilitator.js';

export interface ExpressX402Options {
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
 * Create Express middleware that requires x402 payment.
 *
 * @param options - Pricing configuration for this route.
 *
 * If `toolName` is provided, pricing is looked up from the registered tool
 * price table and settlement is triggered after verification. Otherwise,
 * `price` / `tier` determine the charge and only verification is performed.
 */
export function x402Express(options: ExpressX402Options = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      const requirements = options.toolName
        ? buildFacilitatorRequirements(options.toolName)
        : buildRequirementsForPrice(pricing.price);

      res.status(402).json({
        error: 'Payment Required',
        code: 402,
        price: pricing.price,
        priceFormatted: `$${pricing.price.toFixed(4)}`,
        ...requirements,
        message: `This endpoint requires payment of $${pricing.price.toFixed(4)} USDC.`,
      });
      return;
    }

    const payment = parsePaymentHeader(paymentHeader);
    if (!payment) {
      res.status(402).json({ error: 'Invalid payment header format' });
      return;
    }

    const result = await verifyPayment(payment, pricing.price);
    if (!result.valid) {
      res.status(402).json({ error: result.error ?? 'Payment verification failed' });
      return;
    }

    if (options.toolName) {
      settleWithFacilitator(payment, options.toolName).catch(console.error);
    }

    return next();
  };
}
