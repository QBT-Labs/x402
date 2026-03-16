#!/usr/bin/env node

/**
 * CLI entry point for the x402 client proxy.
 *
 * Usage:
 *   TARGET_URL=https://remote-mcp.example.com PRIVATE_KEY=0x... npx @qbtlabs/x402
 *
 * In stdio mode, stdout is reserved for MCP protocol communication.
 * All logging is directed to stderr.
 */

import { createClientProxy } from '../proxy/client-proxy.js';

// In stdio mode, stdout is reserved for MCP protocol.
// Redirect all console output to stderr.
const log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');

const targetUrl = process.env.TARGET_URL;
const privateKey = process.env.PRIVATE_KEY;

if (!targetUrl) {
  log('Error: TARGET_URL environment variable is required');
  process.exit(1);
}

if (!privateKey) {
  log('Error: PRIVATE_KEY environment variable is required');
  process.exit(1);
}

if (!privateKey.startsWith('0x')) {
  log('Error: PRIVATE_KEY must be a hex string starting with 0x');
  process.exit(1);
}

const mode = (process.env.MODE as 'stdio' | 'http') || 'stdio';
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
const chainId = process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : undefined;

// Exchange API credentials (optional, for private endpoints)
const exchangeCredentials: Record<string, string> = {};
const credentialKeys = [
  'MEXC_API_KEY', 'MEXC_SECRET_KEY',
  'GATEIO_API_KEY', 'GATEIO_SECRET',
  'BITGET_API_KEY', 'BITGET_SECRET', 'BITGET_PASSPHRASE',
  'KRAKEN_API_KEY', 'KRAKEN_SECRET',
];

for (const key of credentialKeys) {
  if (process.env[key]) {
    exchangeCredentials[key] = process.env[key]!;
  }
}

const hasCredentials = Object.keys(exchangeCredentials).length > 0;

log(`x402 client proxy starting...`);
log(`  Target: ${targetUrl}`);
log(`  Mode:   ${mode}`);
if (port) log(`  Port:   ${port}`);
if (chainId) log(`  Chain:  ${chainId}`);
if (hasCredentials) log(`  Exchange credentials: ${Object.keys(exchangeCredentials).length} keys`);

let proxy: { stop: () => Promise<void> } | undefined;

async function shutdown() {
  log('\nShutting down...');
  if (proxy) {
    await proxy.stop();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  proxy = await createClientProxy({
    targetUrl,
    privateKey: privateKey as `0x${string}`,
    mode,
    port,
    chainId,
    exchangeCredentials: hasCredentials ? exchangeCredentials : undefined,
  });

  log('Proxy running. Press Ctrl+C to stop.');
} catch (err) {
  log('Failed to start proxy:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
