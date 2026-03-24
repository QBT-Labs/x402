/**
 * Vault Types
 * Based on Web3 Secret Storage Definition (Keystore v3)
 */

export interface VaultFile {
  version: number;
  id: string;
  address: string;
  crypto: VaultCrypto;
  meta?: VaultMeta;
}

export interface VaultCrypto {
  cipher: 'aes-256-gcm';
  cipherparams: {
    iv: string; // hex
  };
  ciphertext: string; // hex
  kdf: 'pbkdf2';
  kdfparams: {
    c: number; // iterations
    dklen: number; // derived key length
    prf: 'hmac-sha256';
    salt: string; // hex
  };
  mac: string; // GCM auth tag, hex
}

export interface VaultMeta {
  name?: string;
  created: string; // ISO timestamp
  chain?: string;
}

export interface VaultConfig {
  vaultPath?: string;
  configPath?: string;
}

export interface VaultInitOptions {
  password: string;
  name?: string;
  chain?: string;
}

export interface VaultImportOptions {
  password: string;
  privateKey: string;
  name?: string;
  chain?: string;
}

export const VAULT_DIR = '.x402';
export const VAULT_FILE = 'vault.enc';
export const CONFIG_FILE = 'config.json';

export const DEFAULT_ITERATIONS = 100_000;
export const DEFAULT_KEY_LENGTH = 32;
export const IV_LENGTH = 12; // 96-bit for GCM
export const SALT_LENGTH = 32;
