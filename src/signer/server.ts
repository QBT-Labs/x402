/**
 * x402 Signer Server
 * Isolated process that holds private keys and signs transactions
 */

import { createServer, Server, Socket } from 'net';
import { existsSync, unlinkSync } from 'fs';
import { Vault, wipeBuffer } from '../vault/index.js';
import { signEIP3009 } from '../chains/evm.js';
import type { SignRequest, SignResponse, SignPayload, SignerConfig } from './types.js';
import { DEFAULT_SOCKET_PATH } from './types.js';

export class SignerServer {
  private server: Server | null = null;
  private vault: Vault;
  private socketPath: string;
  private password: string;
  private isRunning = false;

  constructor(config: SignerConfig & { password: string }) {
    this.socketPath = config.socketPath || DEFAULT_SOCKET_PATH;
    this.password = config.password;
    this.vault = new Vault({ vaultPath: config.vaultPath });

    if (!this.vault.exists()) {
      throw new Error('Vault not found. Run "x402 vault init" first.');
    }
  }

  /**
   * Start the signer server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Signer already running');
    }

    // Clean up existing socket
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.isRunning = true;
        console.log(`🔐 x402-signer listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the signer server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.isRunning = false;
        if (existsSync(this.socketPath)) {
          unlinkSync(this.socketPath);
        }
        resolve();
      });
    });
  }

  /**
   * Handle incoming socket connection
   */
  private handleConnection(socket: Socket): void {
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as SignRequest;
          const response = await this.handleRequest(request);
          socket.write(JSON.stringify(response) + '\n');
        } catch (error) {
          const errorResponse: SignResponse = {
            id: 'unknown',
            success: false,
            error: `Parse error: ${(error as Error).message}`,
          };
          socket.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  }

  /**
   * Handle a sign request
   */
  private async handleRequest(request: SignRequest): Promise<SignResponse> {
    const { id, action, payload } = request;

    try {
      switch (action) {
        case 'health':
          return { id, success: true };

        case 'address':
          return {
            id,
            success: true,
            address: this.vault.getAddress(),
          };

        case 'sign':
          if (!payload) {
            return { id, success: false, error: 'Missing payload' };
          }
          return await this.handleSign(id, payload);

        default:
          return { id, success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return {
        id,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Handle signing request
   */
  private async handleSign(id: string, payload: SignPayload): Promise<SignResponse> {
    // Decrypt private key
    const privateKey = this.vault.decrypt(this.password);

    try {
      // Sign the payment
      const signature = await signEIP3009({
        privateKey: `0x${privateKey.toString('hex')}`,
        to: payload.to,
        value: BigInt(payload.amount),
        validAfter: payload.validAfter || 0,
        validBefore: payload.validBefore || Math.floor(Date.now() / 1000) + 3600,
        nonce: payload.nonce ? BigInt(payload.nonce) : undefined,
        chainId: payload.chainId,
      });

      return {
        id,
        success: true,
        signature,
      };
    } finally {
      // CRITICAL: Always wipe key from memory
      wipeBuffer(privateKey);
    }
  }
}

/**
 * Start signer server from CLI
 */
export async function startSignerServer(options: {
  socketPath?: string;
  vaultPath?: string;
  password: string;
}): Promise<SignerServer> {
  const server = new SignerServer({
    socketPath: options.socketPath,
    vaultPath: options.vaultPath,
    password: options.password,
  });

  await server.start();

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\n🛑 Shutting down signer...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
