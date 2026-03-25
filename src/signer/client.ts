/**
 * x402 Signer Client
 * Communicates with isolated signer process via IPC
 */

import { connect, Socket } from 'net';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import type { SignRequest, SignResponse, SignPayload, SignerConfig, SignerMode } from './types.js';
import { DEFAULT_SOCKET_PATH, DEFAULT_TIMEOUT } from './types.js';

export class SignerClient {
  private socketPath: string;
  private timeout: number;
  private subprocess: ChildProcess | null = null;
  private mode: SignerMode;

  constructor(config?: SignerConfig & { mode?: SignerMode }) {
    this.socketPath = config?.socketPath || DEFAULT_SOCKET_PATH;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;
    this.mode = config?.mode || 'socket';
  }

  /**
   * Check if signer is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.mode === 'socket') {
      if (!existsSync(this.socketPath)) {
        return false;
      }
      try {
        await this.send({ id: randomUUID(), action: 'health' });
        return true;
      } catch {
        return false;
      }
    }
    return !!this.subprocess;
  }

  /**
   * Start signer subprocess (subprocess mode only)
   */
  async startSubprocess(options: {
    password: string;
    vaultPath?: string;
  }): Promise<void> {
    if (this.mode !== 'subprocess') {
      throw new Error('Subprocess mode not configured');
    }

    this.subprocess = spawn('x402-signer', ['--stdin'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        X402_VAULT_PASSWORD: options.password,
        X402_VAULT_PATH: options.vaultPath || '',
      },
    });

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const onReady = (data: Buffer) => {
        if (data.toString().includes('ready')) {
          this.subprocess?.stdout?.off('data', onReady);
          resolve();
        }
      };
      this.subprocess?.stdout?.on('data', onReady);
      this.subprocess?.on('error', reject);
      
      // Timeout
      setTimeout(() => reject(new Error('Signer startup timeout')), 10000);
    });
  }

  /**
   * Stop subprocess
   */
  stopSubprocess(): void {
    if (this.subprocess) {
      this.subprocess.kill();
      this.subprocess = null;
    }
  }

  /**
   * Get wallet address from signer
   */
  async getAddress(): Promise<string> {
    const response = await this.send({
      id: randomUUID(),
      action: 'address',
    });

    if (!response.success || !response.address) {
      throw new Error(response.error || 'Failed to get address');
    }

    return response.address;
  }

  /**
   * Sign a payment via the isolated signer
   * Returns both signature and the exact authorization data that was signed
   */
  async sign(payload: SignPayload): Promise<{
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  }> {
    const response = await this.send({
      id: randomUUID(),
      action: 'sign',
      payload,
    });

    if (!response.success || !response.signature || !response.authorization) {
      throw new Error(response.error || 'Signing failed');
    }

    return {
      signature: response.signature,
      authorization: response.authorization,
    };
  }

  /**
   * Send request to signer and get response
   */
  private async send(request: SignRequest): Promise<SignResponse> {
    if (this.mode === 'subprocess' && this.subprocess) {
      return this.sendViaSubprocess(request);
    }
    return this.sendViaSocket(request);
  }

  /**
   * Send via Unix socket
   */
  private sendViaSocket(request: SignRequest): Promise<SignResponse> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.socketPath);
      let buffer = '';
      let timeoutHandle: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        socket.destroy();
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('Signer request timeout'));
      }, this.timeout);

      socket.on('connect', () => {
        socket.write(JSON.stringify(request) + '\n');
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as SignResponse;
            if (response.id === request.id) {
              cleanup();
              resolve(response);
              return;
            }
          } catch {
            // Continue reading
          }
        }
      });

      socket.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Send via subprocess stdin/stdout
   */
  private sendViaSubprocess(request: SignRequest): Promise<SignResponse> {
    return new Promise((resolve, reject) => {
      if (!this.subprocess?.stdin || !this.subprocess?.stdout) {
        reject(new Error('Subprocess not available'));
        return;
      }

      let buffer = '';
      let timeoutHandle: NodeJS.Timeout;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.subprocess?.stdout?.off('data', onData);
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('Signer request timeout'));
      }, this.timeout);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as SignResponse;
            if (response.id === request.id) {
              cleanup();
              resolve(response);
              return;
            }
          } catch {
            // Continue reading
          }
        }
      };

      this.subprocess.stdout.on('data', onData);
      this.subprocess.stdin.write(JSON.stringify(request) + '\n');
    });
  }
}

/**
 * Create a signer client
 * Automatically detects if signer is available
 */
export async function createSignerClient(config?: SignerConfig): Promise<SignerClient | null> {
  const client = new SignerClient(config);
  
  if (await client.isAvailable()) {
    return client;
  }
  
  return null;
}

/**
 * Sign with isolated signer if available, otherwise throw
 */
export async function signWithIsolatedSigner(
  payload: SignPayload,
  config?: SignerConfig
): Promise<{
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}> {
  const client = await createSignerClient(config);
  
  if (!client) {
    throw new Error(
      'Isolated signer not available. Start with "x402-signer" or use direct signing.'
    );
  }
  
  return client.sign(payload);
}
