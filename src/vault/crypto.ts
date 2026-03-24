/**
 * Vault Cryptographic Utilities
 * AES-256-GCM encryption with PBKDF2 key derivation
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import type { VaultFile, VaultCrypto } from './types.js';
import {
  DEFAULT_ITERATIONS,
  DEFAULT_KEY_LENGTH,
  IV_LENGTH,
  SALT_LENGTH,
} from './types.js';

/**
 * Derive encryption key from password using PBKDF2
 */
export function deriveKey(
  password: string,
  salt: Buffer,
  iterations: number = DEFAULT_ITERATIONS,
  keyLength: number = DEFAULT_KEY_LENGTH
): Buffer {
  return pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
}

/**
 * Encrypt a private key with AES-256-GCM
 */
export function encryptPrivateKey(
  privateKey: Buffer,
  password: string
): VaultCrypto {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  const derivedKey = deriveKey(password, salt);

  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    cipher: 'aes-256-gcm',
    cipherparams: {
      iv: iv.toString('hex'),
    },
    ciphertext: ciphertext.toString('hex'),
    kdf: 'pbkdf2',
    kdfparams: {
      c: DEFAULT_ITERATIONS,
      dklen: DEFAULT_KEY_LENGTH,
      prf: 'hmac-sha256',
      salt: salt.toString('hex'),
    },
    mac: authTag.toString('hex'),
  };
}

/**
 * Decrypt a private key from vault crypto data
 */
export function decryptPrivateKey(
  crypto: VaultCrypto,
  password: string
): Buffer {
  const { kdfparams, cipherparams, ciphertext, mac } = crypto;

  const salt = Buffer.from(kdfparams.salt, 'hex');
  const iv = Buffer.from(cipherparams.iv, 'hex');
  const authTag = Buffer.from(mac, 'hex');
  const encryptedData = Buffer.from(ciphertext, 'hex');

  const derivedKey = deriveKey(password, salt, kdfparams.c, kdfparams.dklen);

  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);

  const privateKey = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return privateKey;
}

/**
 * Derive Ethereum address from private key
 */
export function deriveAddress(privateKey: Buffer | string): string {
  const keyHex = typeof privateKey === 'string'
    ? privateKey
    : `0x${privateKey.toString('hex')}`;
  
  const account = privateKeyToAccount(keyHex as `0x${string}`);
  return account.address;
}

/**
 * Generate a new random private key
 */
export function generatePrivateKey(): Buffer {
  return randomBytes(32);
}

/**
 * Create a complete vault file
 */
export function createVaultFile(
  privateKey: Buffer,
  password: string,
  options?: { name?: string; chain?: string }
): VaultFile {
  const crypto = encryptPrivateKey(privateKey, password);
  const address = deriveAddress(privateKey);

  return {
    version: 1,
    id: randomUUID(),
    address,
    crypto,
    meta: {
      name: options?.name || 'x402-default',
      created: new Date().toISOString(),
      chain: options?.chain || 'base',
    },
  };
}

/**
 * Securely wipe a buffer from memory
 */
export function wipeBuffer(buf: Buffer): void {
  // Fill with zeros
  buf.fill(0);
  
  // Fill with random data (prevents compiler optimization)
  randomBytes(buf.length).copy(buf);
  
  // Fill with zeros again
  buf.fill(0);
}

/**
 * Validate private key format
 */
export function validatePrivateKey(key: string): boolean {
  // Remove 0x prefix if present
  const cleanKey = key.startsWith('0x') ? key.slice(2) : key;
  
  // Must be 64 hex characters (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    return false;
  }
  
  return true;
}

/**
 * Normalize private key to Buffer
 */
export function normalizePrivateKey(key: string): Buffer {
  const cleanKey = key.startsWith('0x') ? key.slice(2) : key;
  return Buffer.from(cleanKey, 'hex');
}
