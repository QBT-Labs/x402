/**
 * x402 Encrypted Vault
 * Secure storage for private keys with AES-256-GCM encryption
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { VaultFile, VaultConfig, VaultInitOptions, VaultImportOptions } from './types.js';
import { VAULT_DIR, VAULT_FILE, CONFIG_FILE } from './types.js';
import {
  createVaultFile,
  decryptPrivateKey,
  deriveAddress,
  generatePrivateKey,
  normalizePrivateKey,
  validatePrivateKey,
  wipeBuffer,
  encryptPrivateKey,
} from './crypto.js';

export class Vault {
  private vaultPath: string;
  private configPath: string;
  private vaultFile: VaultFile | null = null;

  constructor(config?: VaultConfig) {
    const baseDir = join(homedir(), VAULT_DIR);
    this.vaultPath = config?.vaultPath || join(baseDir, VAULT_FILE);
    this.configPath = config?.configPath || join(baseDir, CONFIG_FILE);

    // Ensure directory exists with secure permissions
    const dir = join(homedir(), VAULT_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Check if vault exists
   */
  exists(): boolean {
    return existsSync(this.vaultPath);
  }

  /**
   * Initialize a new vault with a generated key
   */
  init(options: VaultInitOptions): { address: string; vaultPath: string } {
    if (this.exists()) {
      throw new Error('Vault already exists. Use import to replace or change password.');
    }

    const privateKey = generatePrivateKey();
    
    try {
      this.vaultFile = createVaultFile(privateKey, options.password, {
        name: options.name,
        chain: options.chain,
      });

      this.save();

      return {
        address: this.vaultFile.address,
        vaultPath: this.vaultPath,
      };
    } finally {
      // Always wipe the private key from memory
      wipeBuffer(privateKey);
    }
  }

  /**
   * Import an existing private key into the vault
   */
  import(options: VaultImportOptions): { address: string; vaultPath: string } {
    if (!validatePrivateKey(options.privateKey)) {
      throw new Error('Invalid private key format. Expected 64 hex characters (with or without 0x prefix).');
    }

    const privateKey = normalizePrivateKey(options.privateKey);
    
    try {
      this.vaultFile = createVaultFile(privateKey, options.password, {
        name: options.name,
        chain: options.chain,
      });

      this.save();

      return {
        address: this.vaultFile.address,
        vaultPath: this.vaultPath,
      };
    } finally {
      // Always wipe the private key from memory
      wipeBuffer(privateKey);
    }
  }

  /**
   * Get the wallet address without decrypting
   */
  getAddress(): string {
    this.load();
    if (!this.vaultFile) {
      throw new Error('Vault not loaded');
    }
    return this.vaultFile.address;
  }

  /**
   * Get vault metadata
   */
  getMeta(): { address: string; name?: string; created?: string; chain?: string } {
    this.load();
    if (!this.vaultFile) {
      throw new Error('Vault not loaded');
    }
    return {
      address: this.vaultFile.address,
      name: this.vaultFile.meta?.name,
      created: this.vaultFile.meta?.created,
      chain: this.vaultFile.meta?.chain,
    };
  }

  /**
   * Decrypt and return the private key
   * IMPORTANT: Caller is responsible for wiping the returned buffer
   */
  decrypt(password: string): Buffer {
    this.load();
    if (!this.vaultFile) {
      throw new Error('Vault not loaded');
    }

    try {
      return decryptPrivateKey(this.vaultFile.crypto, password);
    } catch (error) {
      throw new Error('Failed to decrypt vault. Wrong password?');
    }
  }

  /**
   * Decrypt and return private key as hex string
   * IMPORTANT: Caller should clear the string when done
   */
  decryptAsHex(password: string): string {
    const privateKey = this.decrypt(password);
    try {
      return `0x${privateKey.toString('hex')}`;
    } finally {
      wipeBuffer(privateKey);
    }
  }

  /**
   * Change the vault password
   */
  changePassword(oldPassword: string, newPassword: string): void {
    this.load();
    if (!this.vaultFile) {
      throw new Error('Vault not loaded');
    }

    // Decrypt with old password
    const privateKey = this.decrypt(oldPassword);

    try {
      // Re-encrypt with new password
      this.vaultFile.crypto = encryptPrivateKey(privateKey, newPassword);
      this.save();
    } finally {
      wipeBuffer(privateKey);
    }
  }

  /**
   * Export the private key (dangerous!)
   */
  export(password: string): string {
    return this.decryptAsHex(password);
  }

  /**
   * Load vault file from disk
   */
  private load(): void {
    if (this.vaultFile) {
      return;
    }

    if (!this.exists()) {
      throw new Error(`Vault not found at ${this.vaultPath}. Run 'x402 vault init' first.`);
    }

    const content = readFileSync(this.vaultPath, 'utf-8');
    this.vaultFile = JSON.parse(content) as VaultFile;

    // Validate version
    if (this.vaultFile.version !== 1) {
      throw new Error(`Unsupported vault version: ${this.vaultFile.version}`);
    }
  }

  /**
   * Save vault file to disk with secure permissions
   */
  private save(): void {
    if (!this.vaultFile) {
      throw new Error('No vault data to save');
    }

    const content = JSON.stringify(this.vaultFile, null, 2);
    writeFileSync(this.vaultPath, content, { mode: 0o600 });
    
    // Ensure permissions are correct (extra safety)
    chmodSync(this.vaultPath, 0o600);
  }

  /**
   * Get the vault file path
   */
  getVaultPath(): string {
    return this.vaultPath;
  }
}

// Export crypto utilities for advanced use
export {
  deriveKey,
  encryptPrivateKey,
  decryptPrivateKey,
  deriveAddress,
  generatePrivateKey,
  wipeBuffer,
  validatePrivateKey,
  normalizePrivateKey,
} from './crypto.js';

// Export types
export type {
  VaultFile,
  VaultCrypto,
  VaultMeta,
  VaultConfig,
  VaultInitOptions,
  VaultImportOptions,
} from './types.js';

export { VAULT_DIR, VAULT_FILE } from './types.js';
