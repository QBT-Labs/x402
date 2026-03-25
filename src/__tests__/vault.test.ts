/**
 * Vault Tests
 */

import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import {
  encryptPrivateKey,
  decryptPrivateKey,
  deriveAddress,
  generatePrivateKey,
  validatePrivateKey,
  normalizePrivateKey,
  wipeBuffer,
  createVaultFile,
} from '../vault/crypto.js';
import { Vault } from '../vault/index.js';

describe('Vault Crypto', () => {
  describe('generatePrivateKey', () => {
    it('should generate a 32-byte key', () => {
      const key = generatePrivateKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should generate unique keys', () => {
      const key1 = generatePrivateKey();
      const key2 = generatePrivateKey();
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('validatePrivateKey', () => {
    it('should accept valid hex key without prefix', () => {
      const key = 'a'.repeat(64);
      expect(validatePrivateKey(key)).toBe(true);
    });

    it('should accept valid hex key with 0x prefix', () => {
      const key = '0x' + 'a'.repeat(64);
      expect(validatePrivateKey(key)).toBe(true);
    });

    it('should reject too short key', () => {
      expect(validatePrivateKey('0x' + 'a'.repeat(63))).toBe(false);
    });

    it('should reject too long key', () => {
      expect(validatePrivateKey('0x' + 'a'.repeat(65))).toBe(false);
    });

    it('should reject non-hex characters', () => {
      expect(validatePrivateKey('0x' + 'g'.repeat(64))).toBe(false);
    });
  });

  describe('normalizePrivateKey', () => {
    it('should handle key without prefix', () => {
      const key = 'a'.repeat(64);
      const result = normalizePrivateKey(key);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });

    it('should handle key with 0x prefix', () => {
      const key = '0x' + 'a'.repeat(64);
      const result = normalizePrivateKey(key);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });
  });

  describe('encrypt/decrypt', () => {
    const password = 'test-password-123';

    it('should encrypt and decrypt successfully', () => {
      const privateKey = generatePrivateKey();
      const encrypted = encryptPrivateKey(privateKey, password);
      const decrypted = decryptPrivateKey(encrypted, password);

      expect(decrypted.equals(privateKey)).toBe(true);
    });

    it('should fail with wrong password', () => {
      const privateKey = generatePrivateKey();
      const encrypted = encryptPrivateKey(privateKey, password);

      expect(() => {
        decryptPrivateKey(encrypted, 'wrong-password');
      }).toThrow();
    });

    it('should produce different ciphertext each time (random IV/salt)', () => {
      const privateKey = generatePrivateKey();
      const encrypted1 = encryptPrivateKey(privateKey, password);
      const encrypted2 = encryptPrivateKey(privateKey, password);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.cipherparams.iv).not.toBe(encrypted2.cipherparams.iv);
      expect(encrypted1.kdfparams.salt).not.toBe(encrypted2.kdfparams.salt);
    });
  });

  describe('deriveAddress', () => {
    it('should derive correct address from known key', () => {
      // Known test key
      const privateKey = Buffer.from(
        'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        'hex'
      );
      const address = deriveAddress(privateKey);
      // This is the first Hardhat/Anvil test account
      expect(address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
    });
  });

  describe('createVaultFile', () => {
    it('should create a valid vault file', () => {
      const privateKey = generatePrivateKey();
      const password = 'test-password';
      const vault = createVaultFile(privateKey, password, {
        name: 'test-wallet',
        chain: 'base',
      });

      expect(vault.version).toBe(1);
      expect(vault.id).toBeDefined();
      expect(vault.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(vault.crypto.cipher).toBe('aes-256-gcm');
      expect(vault.crypto.kdf).toBe('pbkdf2');
      expect(vault.meta?.name).toBe('test-wallet');
      expect(vault.meta?.chain).toBe('base');
    });
  });

  describe('wipeBuffer', () => {
    it('should zero out buffer contents', () => {
      const buf = Buffer.from('sensitive data here');
      const originalContent = buf.toString();
      
      wipeBuffer(buf);
      
      // Buffer should be all zeros
      expect(buf.every((b) => b === 0)).toBe(true);
      expect(buf.toString()).not.toBe(originalContent);
    });
  });
});

describe('Vault Class', () => {
  let tempDir: string;
  let vault: Vault;
  const password = 'test-password-123';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'x402-vault-test-'));
    vault = new Vault({
      vaultPath: join(tempDir, 'vault.enc'),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should create a new vault', () => {
      expect(vault.exists()).toBe(false);
      
      const result = vault.init({ password });
      
      expect(vault.exists()).toBe(true);
      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should fail if vault already exists', () => {
      vault.init({ password });
      
      expect(() => {
        vault.init({ password });
      }).toThrow(/already exists/);
    });
  });

  describe('import', () => {
    const testKey = '0x' + 'a'.repeat(64);

    it('should import an existing key', () => {
      const result = vault.import({ password, privateKey: testKey });
      
      expect(vault.exists()).toBe(true);
      expect(result.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should reject invalid key', () => {
      expect(() => {
        vault.import({ password, privateKey: 'invalid' });
      }).toThrow(/Invalid private key format/);
    });
  });

  describe('getAddress', () => {
    it('should return address without password', () => {
      vault.init({ password });
      
      // Create a new vault instance (simulates new process)
      const vault2 = new Vault({
        vaultPath: join(tempDir, 'vault.enc'),
      });
      
      const address = vault2.getAddress();
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });

  describe('decrypt', () => {
    it('should decrypt with correct password', () => {
      vault.init({ password });
      
      const privateKey = vault.decrypt(password);
      expect(privateKey).toBeInstanceOf(Buffer);
      expect(privateKey.length).toBe(32);
    });

    it('should fail with wrong password', () => {
      vault.init({ password });
      
      expect(() => {
        vault.decrypt('wrong-password');
      }).toThrow(/Wrong password/);
    });
  });

  describe('changePassword', () => {
    it('should change password successfully', () => {
      vault.init({ password });
      
      const newPassword = 'new-password-456';
      vault.changePassword(password, newPassword);
      
      // Old password should fail
      expect(() => {
        vault.decrypt(password);
      }).toThrow();
      
      // New password should work
      const privateKey = vault.decrypt(newPassword);
      expect(privateKey).toBeInstanceOf(Buffer);
    });
  });
});
