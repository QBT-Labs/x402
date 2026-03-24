/**
 * Signer Tests
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { Vault } from '../vault/index.js';
import { SignerServer } from '../signer/server.js';
import { SignerClient } from '../signer/client.js';

describe('Signer', () => {
  let tempDir: string;
  let vaultPath: string;
  let socketPath: string;
  let server: SignerServer | null = null;
  const password = 'test-password-123';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'x402-signer-test-'));
    vaultPath = join(tempDir, 'vault.enc');
    socketPath = join(tempDir, 'signer.sock');

    // Create a test vault
    const vault = new Vault({ vaultPath });
    vault.init({ password });
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('SignerServer', () => {
    it('should start and stop cleanly', async () => {
      server = new SignerServer({
        socketPath,
        vaultPath,
        password,
      });

      await server.start();
      await server.stop();
      server = null;
    });

    it('should reject if vault not found', () => {
      expect(() => {
        new SignerServer({
          socketPath,
          vaultPath: '/nonexistent/vault.enc',
          password,
        });
      }).toThrow(/Vault not found/);
    });
  });

  describe('SignerClient', () => {
    beforeAll(async () => {
      // Start server for client tests
      server = new SignerServer({
        socketPath,
        vaultPath,
        password,
      });
      await server.start();
    });

    afterAll(async () => {
      if (server) {
        await server.stop();
        server = null;
      }
    });

    it('should detect available signer', async () => {
      const client = new SignerClient({ socketPath });
      const available = await client.isAvailable();
      expect(available).toBe(true);
    });

    it('should get address from signer', async () => {
      const client = new SignerClient({ socketPath });
      const address = await client.getAddress();
      
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should detect unavailable signer', async () => {
      const client = new SignerClient({ socketPath: '/nonexistent.sock' });
      const available = await client.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('IPC Protocol', () => {
    let client: SignerClient;

    beforeAll(async () => {
      if (!server) {
        server = new SignerServer({
          socketPath,
          vaultPath,
          password,
        });
        await server.start();
      }
      client = new SignerClient({ socketPath });
    });

    it('should handle health check', async () => {
      const available = await client.isAvailable();
      expect(available).toBe(true);
    });

    it('should handle address request', async () => {
      const address = await client.getAddress();
      expect(address).toBeDefined();
      expect(address.startsWith('0x')).toBe(true);
    });

    // Note: Full signing test requires proper USDC contract setup
    // which is not available in unit tests
  });
});
