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
  nonce?: number;       // Optional nonce
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
}

export interface SignerConfig {
  socketPath?: string;
  vaultPath?: string;
  policyPath?: string;
  timeout?: number;     // Request timeout in ms
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
