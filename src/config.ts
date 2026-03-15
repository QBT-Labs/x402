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
    chains.push(cfg.testnet ? 'solana:devnet' : 'solana:mainnet');
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
  'solana:mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};
