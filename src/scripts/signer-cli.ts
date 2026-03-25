#!/usr/bin/env node
/**
 * x402 Signer CLI
 * Isolated signing process for secure key management
 */

import { startSignerServer } from '../signer/server.js';
import { createInterface } from 'readline';
import { DEFAULT_SOCKET_PATH } from '../signer/types.js';

const args = process.argv.slice(2);

async function prompt(question: string, hidden = false): Promise<string> {
  if (hidden && process.stdin.isTTY) {
    // Use muted output for password
    const rl = createInterface({
      input: process.stdin,
      output: new (await import('stream')).Writable({
        write: (_chunk, _encoding, callback) => callback()
      }),
      terminal: true,
    });

    process.stdout.write(question);
    
    return new Promise((resolve) => {
      let password = '';
      
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      const onData = (char: string) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode?.(false);
            process.stdin.removeListener('data', onData);
            process.stdin.pause();
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdout.write('\n');
            process.exit(0);
            break;
          case '\u007F': // Backspace
          case '\b':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            if (char.charCodeAt(0) >= 32) { // Printable chars only
              password += char;
              process.stdout.write('*');
            }
            break;
        }
      };
      
      process.stdin.on('data', onData);
    });
  } else {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

function showHelp() {
  console.log(`
x402 signer - Isolated signing process

USAGE:
  x402-signer [options]

OPTIONS:
  --socket PATH       Socket path (default: ${DEFAULT_SOCKET_PATH})
  --vault PATH        Vault file path (default: ~/.x402/vault.enc)
  --stdin             Read from stdin (for subprocess mode)
  
ENVIRONMENT:
  X402_VAULT_PASSWORD   Vault password (required for non-interactive)
  X402_SOCKET_PATH      Socket path override
  X402_VAULT_PATH       Vault path override

DESCRIPTION:
  The signer process holds your private key in an isolated process.
  The AI agent communicates via Unix socket or subprocess IPC.
  
  This provides security isolation:
  - Private key never enters the AI agent process
  - Memory is wiped immediately after signing
  - Policy enforcement happens before signing

EXAMPLES:
  # Start signer daemon (interactive)
  x402-signer
  
  # Start with custom socket
  x402-signer --socket /tmp/my-signer.sock
  
  # Start in subprocess mode (for automation)
  X402_VAULT_PASSWORD=secret x402-signer --stdin

PROTOCOL:
  JSON over newline-delimited socket.
  
  Request:
    {"id": "uuid", "action": "sign", "payload": {"to": "0x...", "amount": "1000000", "chainId": 8453}}
  
  Response:
    {"id": "uuid", "success": true, "signature": "0x..."}
`);
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  // Get configuration
  const socketPath = args.find((a, i) => args[i - 1] === '--socket')
    || process.env.X402_SOCKET_PATH
    || DEFAULT_SOCKET_PATH;
  
  const vaultPath = args.find((a, i) => args[i - 1] === '--vault')
    || process.env.X402_VAULT_PATH
    || undefined;

  // Get password
  let password = process.env.X402_VAULT_PASSWORD;
  
  if (!password) {
    if (args.includes('--stdin')) {
      console.error('❌ X402_VAULT_PASSWORD required for stdin mode');
      process.exit(1);
    }
    password = await prompt('Vault password: ', true);
  }

  if (!password) {
    console.error('❌ Password required');
    process.exit(1);
  }

  try {
    console.log('🔐 Starting x402 signer...');
    console.log(`   Socket: ${socketPath}`);
    
    await startSignerServer({
      socketPath,
      vaultPath,
      password,
    });

    // If stdin mode, print ready signal
    if (args.includes('--stdin')) {
      console.log('ready');
    }

    console.log('');
    console.log('Press Ctrl+C to stop');
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error(`❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
