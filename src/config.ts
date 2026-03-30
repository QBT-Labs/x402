/**
 * x402 Configuration
 */

export interface ChainConfig {
  address: string;
  rpcUrl?: string;
}

export interface X402Config {
  evm?: ChainConfig & { chainId?: number };
  solana?: ChainConfig;
  cardano?: ChainConfig;
  testnet?: boolean;
  verifyMode?: 'basic' | 'full';
  facilitatorUrl?: string;
  solanaFacilitatorUrl?: string;
}

let config: X402Config = {};

/**
 * Configure x402 chains
 */
export function configure(cfg: X402Config): void {
  config = { ...cfg };
}

/**
 * Reset configuration (for testing)
 */
export function resetConfig(): void {
  config = {};
}

/**
 * Get current configuration, with environment variable fallbacks
 */
export function getConfig(): X402Config {
  return {
    evm: config.evm || (process.env.X402_EVM_ADDRESS ? {
      address: process.env.X402_EVM_ADDRESS,
      chainId: config.testnet || process.env.X402_TESTNET === 'true' ? 84532 : 8453,
    } : undefined),
    solana: config.solana || (process.env.X402_SOLANA_ADDRESS ? {
      address: process.env.X402_SOLANA_ADDRESS,
    } : undefined),
    cardano: config.cardano || (process.env.X402_CARDANO_ADDRESS ? {
      address: process.env.X402_CARDANO_ADDRESS,
    } : undefined),
    testnet: config.testnet ?? process.env.X402_TESTNET === 'true',
    verifyMode: config.verifyMode ?? (process.env.X402_VERIFY_MODE as 'basic' | 'full') ?? 'basic',
    facilitatorUrl: config.facilitatorUrl ?? process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
    solanaFacilitatorUrl: config.solanaFacilitatorUrl ?? process.env.X402_SOLANA_FACILITATOR_URL ?? 'https://facilitator.payai.network',
  };
}

/**
 * Check if x402 is enabled (at least one chain configured)
 */
export function isEnabled(): boolean {
  const cfg = getConfig();
  return !!(cfg.evm?.address || cfg.solana?.address || cfg.cardano?.address);
}

/**
 * Get list of active chain identifiers
 */
export function getActiveChains(): string[] {
  const cfg = getConfig();
  const chains: string[] = [];
  
  if (cfg.evm?.address) {
    const chainId = cfg.testnet ? 84532 : 8453;
    chains.push(`eip155:${chainId}`);
  }
  
  if (cfg.solana?.address) {
    // Use CAIP-2 format for Solana (required by PayAI facilitator)
    chains.push(cfg.testnet ? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' : 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
  }
  
  if (cfg.cardano?.address) {
    chains.push(cfg.testnet ? 'cardano:preprod' : 'cardano:mainnet');
  }
  
  return chains;
}

/**
 * USDC contract addresses by chain
 */
export const USDC_CONTRACTS: Record<string, string> = {
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // Solana CAIP-2 format
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // mainnet
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',  // devnet
  // Legacy format (for backwards compatibility)
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

/**
 * Solana CAIP-2 network identifiers
 */
export const SOLANA_NETWORKS = {
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
} as const;

/**
 * PayAI facilitator fee payer for Solana
 * This is fetched dynamically but cached for performance
 */
export const PAYAI_SOLANA_FEE_PAYER = '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4';
