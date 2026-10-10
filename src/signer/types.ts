/**
 * Signer IPC Protocol Types
 * Communication between AI agent process and isolated signer process
 */

export interface SignRequest {
  id: string;
  action: 'sign' | 'address' | 'health';
  payload?: SignPayload;
}

export interface SignPayload {
  to: string;           // Recipient address
  amount: string;       // Amount in wei (string to handle big numbers)
  chainId: number;      // Chain ID (84532 = Base Sepolia, 8453 = Base)
  nonce?: number | string; // Optional nonce (a 0x-prefixed bytes32 hex string is accepted)
  deadline?: number;    // EIP-3009 deadline
  validAfter?: number;  // EIP-3009 validAfter
  validBefore?: number; // EIP-3009 validBefore
}

export interface SignResponse {
  id: string;
  success: boolean;
  signature?: string;   // Signed data
  address?: string;     // Wallet address (for address action)
  error?: string;       // Error message if failed
  // Return the exact authorization data that was signed (for EIP-3009)
  authorization?: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

export interface SignerConfig {
  socketPath?: string;
  vaultPath?: string;
  policyPath?: string;
  timeout?: number;     // Request timeout in ms
  /**
   * Optional extra check run after the policy engine allows a payment and before the key is decrypted,
   * e.g. the invinoveritas verdict gate (see src/verdict). Returning allowed=false refuses to sign.
   * Any nonce / validity window it returns is used verbatim for the signature.
   */
  preSign?: (payload: SignPayload & { from: string }) => Promise<PreSignResult>;
}

export interface PreSignResult {
  allowed: boolean;
  reason?: string;
  nonce?: string;
  validAfter?: number;
  validBefore?: number;
}

export const DEFAULT_SOCKET_PATH = '/tmp/x402-signer.sock';
export const DEFAULT_TIMEOUT = 30000; // 30 seconds

export type SignerMode = 'socket' | 'subprocess';

/**
 * IPC Message format (newline-delimited JSON)
 */
export interface IPCMessage {
  type: 'request' | 'response';
  data: SignRequest | SignResponse;
}
