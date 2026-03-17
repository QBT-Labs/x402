/**
 * Split Execution Types
 *
 * Shared types for the split execution flow where payment verification
 * happens on a remote Worker and tool execution happens locally.
 */

/**
 * JWT claims issued by the Worker after successful payment verification.
 */
export interface JWTClaims {
  user_id: string;
  exchange: string;
  tool: string;
  issued_at: number;
  expires_at: number;
  payment_tx: string;
}

/**
 * Options for creating a split execution payment client.
 */
export interface SplitClientOptions {
  /** Agent's wallet private key (hex, 0x-prefixed). Never sent to server. */
  privateKey: `0x${string}`;
  /** Worker URL (e.g. https://mcp.openmm.io) */
  workerUrl: string;
  /** Override chain ID (default: derived from testnet flag) */
  chainId?: number;
  /** Use testnet chains (Base Sepolia). Default false. */
  testnet?: boolean;
}

/**
 * Options for the MCP split payment gate wrapper.
 */
export interface SplitPaymentGateOptions {
  /** Agent's wallet private key (hex, 0x-prefixed). */
  privateKey: `0x${string}`;
  /** Worker URL (e.g. https://mcp.openmm.io) */
  workerUrl: string;
  /** Use testnet chains. Default false. */
  testnet?: boolean;
  /** Tool names that don't require payment. */
  freeTools?: string[];
}

/**
 * Payment requirements returned by Worker in 402 response.
 */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
  extra?: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
}
