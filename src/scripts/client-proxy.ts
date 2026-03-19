#!/usr/bin/env node

/**
 * CLI entry point for the x402 client proxy.
 *
 * Usage:
 *   npx @qbtlabs/x402 client-proxy --target https://mcp.openmm.io/mcp
 *   
 * Or with env vars:
 *   TARGET_URL=https://mcp.openmm.io/mcp PRIVATE_KEY=0x... npx @qbtlabs/x402
 *
 * In stdio mode, stdout is reserved for MCP protocol communication.
 * All logging is directed to stderr.
 */

import { createClientProxy } from '../proxy/client-proxy.js';

// In stdio mode, stdout is reserved for MCP protocol.
// Redirect all console output to stderr.
const log = (...args: unknown[]) => process.stderr.write(args.join(' ') + '\n');

// Parse CLI arguments
function parseArgs(): { target?: string; privateKey?: string; chainId?: number; mode?: string; port?: number } {
  const args = process.argv.slice(2);
  const result: { target?: string; privateKey?: string; chainId?: number; mode?: string; port?: number } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    if ((arg === '--target' || arg === '-t') && nextArg) {
      result.target = nextArg;
      i++;
    } else if ((arg === '--private-key' || arg === '-k') && nextArg) {
      result.privateKey = nextArg;
      i++;
    } else if ((arg === '--chain-id' || arg === '-c') && nextArg) {
      result.chainId = parseInt(nextArg, 10);
      i++;
    } else if ((arg === '--mode' || arg === '-m') && nextArg) {
      result.mode = nextArg;
      i++;
    } else if ((arg === '--port' || arg === '-p') && nextArg) {
      result.port = parseInt(nextArg, 10);
      i++;
    }
  }
  
  return result;
}

const cliArgs = parseArgs();

// CLI args take precedence over env vars
const targetUrl = cliArgs.target || process.env.TARGET_URL;
const privateKey = cliArgs.privateKey || process.env.PRIVATE_KEY || process.env.X402_PRIVATE_KEY;

if (!targetUrl) {
  log('Error: TARGET_URL is required');
  log('Usage: npx @qbtlabs/x402 client-proxy --target https://mcp.openmm.io/mcp');
  log('   Or: TARGET_URL=https://... npx @qbtlabs/x402');
  process.exit(1);
}

if (!privateKey) {
  log('Error: PRIVATE_KEY is required');
  log('Usage: npx @qbtlabs/x402 client-proxy --private-key 0x...');
  log('   Or: PRIVATE_KEY=0x... npx @qbtlabs/x402');
  process.exit(1);
}

if (!privateKey.startsWith('0x')) {
  log('Error: PRIVATE_KEY must be a hex string starting with 0x');
  process.exit(1);
}

const mode = (cliArgs.mode || process.env.MODE || 'stdio') as 'stdio' | 'http';
const port = cliArgs.port || (process.env.PORT ? parseInt(process.env.PORT, 10) : undefined);
const chainId = cliArgs.chainId || (process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID, 10) : undefined);

log(`x402 client proxy starting...`);
log(`  Target: ${targetUrl}`);
log(`  Mode:   ${mode}`);
if (port) log(`  Port:   ${port}`);
if (chainId) log(`  Chain:  ${chainId}`);

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
  });

  log('Proxy running. Press Ctrl+C to stop.');
} catch (err) {
  log('Failed to start proxy:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
