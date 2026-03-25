/**
 * x402 Signer Module
 * Process isolation for secure key management
 */

// Server (runs in isolated process)
export { SignerServer, startSignerServer } from './server.js';

// Client (runs in AI agent process)
export { SignerClient, createSignerClient, signWithIsolatedSigner } from './client.js';

// Types
export type {
  SignRequest,
  SignResponse,
  SignPayload,
  SignerConfig,
  SignerMode,
} from './types.js';

export { DEFAULT_SOCKET_PATH, DEFAULT_TIMEOUT } from './types.js';
