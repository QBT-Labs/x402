/**
 * x402 Pricing
 */

import { getConfig, getActiveChains, USDC_CONTRACTS } from './config.js';

export type PricingTier = 'free' | 'read' | 'analysis' | 'write';

export interface ToolPricing {
  tier: PricingTier;
  price: number; // USD
}

export const DEFAULT_TIERS: Record<PricingTier, number> = {
  free: 0,
  read: 0.001,     // $0.001
  analysis: 0.005, // $0.005
  write: 0.01,     // $0.01
};

const toolPricing: Map<string, ToolPricing> = new Map();

/**
 * Set pricing for a tool
 */
export function setToolPrice(tool: string, tier: PricingTier, price?: number): void {
  toolPricing.set(tool, {
    tier,
    price: price ?? DEFAULT_TIERS[tier],
  });
}

/**
 * Set pricing for multiple tools
 */
export function setToolPrices(prices: Record<string, PricingTier | ToolPricing>): void {
  for (const [tool, tierOrPricing] of Object.entries(prices)) {
    if (typeof tierOrPricing === 'string') {
      setToolPrice(tool, tierOrPricing);
    } else {
      toolPricing.set(tool, tierOrPricing);
    }
  }
}

/**
 * Get pricing for a tool
 */
export function getToolPrice(tool: string): ToolPricing {
  return toolPricing.get(tool) ?? { tier: 'read', price: DEFAULT_TIERS.read };
}

/**
 * Build payment requirements for a price
 */
export function buildPaymentRequirements(priceUsd: number): {
  accepts: Array<{
    network: string;
    asset: string;
    amount: string;
    payTo: string;
  }>;
} {
  const cfg = getConfig();
  const chains = getActiveChains();
  const accepts: Array<{ network: string; asset: string; amount: string; payTo: string }> = [];

  // Convert USD to micro-units (6 decimals for USDC)
  const amount = Math.ceil(priceUsd * 1_000_000).toString();

  for (const chain of chains) {
    const asset = USDC_CONTRACTS[chain];
    if (!asset) continue;

    let payTo = '';
    if (chain.startsWith('eip155:')) {
      payTo = cfg.evm?.address ?? '';
    } else if (chain.startsWith('solana:')) {
      payTo = cfg.solana?.address ?? '';
    } else if (chain.startsWith('cardano:')) {
      payTo = cfg.cardano?.address ?? '';
    }

    if (payTo) {
      accepts.push({ network: chain, asset, amount, payTo });
    }
  }

  return { accepts };
}
