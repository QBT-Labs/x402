#!/usr/bin/env node
/**
 * x402 Vault CLI
 * Manage encrypted key storage
 */

import { Vault } from '../vault/index.js';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const command = args[0];

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden && process.stdin.isTTY) {
      // For password input, we need to handle it differently
      process.stdout.write(question);
      
      const stdin = process.stdin;
      stdin.setRawMode?.(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      
      let password = '';
      const onData = (char: string) => {
        const c = char.toString();
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            stdin.setRawMode?.(false);
            stdin.removeListener('data', onData);
            stdin.pause();
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.exit();
            break;
          case '\u007F': // Backspace
            password = password.slice(0, -1);
            break;
          default:
            password += c;
            break;
        }
      };
      
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function getPassword(confirmMessage?: string): Promise<string> {
  // Check for environment variable first
  if (process.env.X402_VAULT_PASSWORD) {
    return process.env.X402_VAULT_PASSWORD;
  }

  const password = await prompt('Password: ', true);
  
  if (confirmMessage) {
    const confirm = await prompt(confirmMessage, true);
    if (password !== confirm) {
      console.error('❌ Passwords do not match');
      process.exit(1);
    }
  }
  
  return password;
}

function showHelp() {
  console.log(`
x402 vault - Encrypted key storage

USAGE:
  x402 vault <command> [options]

COMMANDS:
  init              Generate a new wallet and store encrypted
  import            Import an existing private key
  address           Show wallet address (no password needed)
  info              Show vault metadata
  export            Export private key (DANGEROUS)
  passwd            Change vault password
  
OPTIONS:
  --from-env VAR    Import key from environment variable
  --name NAME       Set wallet name
  --chain CHAIN     Set default chain (default: base)
  --show            Show exported key (for export command)

ENVIRONMENT:
  X402_VAULT_PASSWORD   Vault password (for automation)

EXAMPLES:
  x402 vault init
  x402 vault import
  x402 vault import --from-env X402_PRIVATE_KEY
  x402 vault address
  x402 vault export --show
  x402 vault passwd
`);
}

async function main() {
  const vault = new Vault();

  try {
    switch (command) {
      case 'init': {
        if (vault.exists()) {
          console.error('❌ Vault already exists at', vault.getVaultPath());
          console.error('   Use "x402 vault import" to replace or "x402 vault passwd" to change password');
          process.exit(1);
        }

        console.log('🔐 Initializing new x402 vault...\n');
        
        const password = await getPassword('Confirm password: ');
        if (password.length < 8) {
          console.error('❌ Password must be at least 8 characters');
          process.exit(1);
        }

        const name = args.find((a, i) => args[i - 1] === '--name') || undefined;
        const chain = args.find((a, i) => args[i - 1] === '--chain') || undefined;

        const result = vault.init({ password, name, chain });
        
        console.log('✅ Vault created successfully!\n');
        console.log(`   Address: ${result.address}`);
        console.log(`   Path:    ${result.vaultPath}`);
        console.log('\n⚠️  Fund this address with USDC on Base before using x402');
        break;
      }

      case 'import': {
        console.log('🔐 Importing private key to x402 vault...\n');

        let privateKey: string;
        
        const envVar = args.find((a, i) => args[i - 1] === '--from-env');
        if (envVar) {
          privateKey = process.env[envVar] || '';
          if (!privateKey) {
            console.error(`❌ Environment variable ${envVar} not set`);
            process.exit(1);
          }
          console.log(`   Reading from environment variable: ${envVar}`);
        } else {
          privateKey = await prompt('Private key (0x...): ');
        }

        const password = await getPassword('Confirm password: ');
        if (password.length < 8) {
          console.error('❌ Password must be at least 8 characters');
          process.exit(1);
        }

        const name = args.find((a, i) => args[i - 1] === '--name') || undefined;
        const chain = args.find((a, i) => args[i - 1] === '--chain') || undefined;

        const result = vault.import({ password, privateKey, name, chain });
        
        console.log('\n✅ Key imported successfully!\n');
        console.log(`   Address: ${result.address}`);
        console.log(`   Path:    ${result.vaultPath}`);
        break;
      }

      case 'address': {
        if (!vault.exists()) {
          console.error('❌ Vault not found. Run "x402 vault init" first.');
          process.exit(1);
        }

        const address = vault.getAddress();
        console.log(address);
        break;
      }

      case 'info': {
        if (!vault.exists()) {
          console.error('❌ Vault not found. Run "x402 vault init" first.');
          process.exit(1);
        }

        const meta = vault.getMeta();
        console.log('🔐 x402 Vault Info\n');
        console.log(`   Address: ${meta.address}`);
        console.log(`   Name:    ${meta.name || '(not set)'}`);
        console.log(`   Chain:   ${meta.chain || 'base'}`);
        console.log(`   Created: ${meta.created || '(unknown)'}`);
        console.log(`   Path:    ${vault.getVaultPath()}`);
        break;
      }

      case 'export': {
        if (!vault.exists()) {
          console.error('❌ Vault not found. Run "x402 vault init" first.');
          process.exit(1);
        }

        const showKey = args.includes('--show');
        if (!showKey) {
          console.error('⚠️  This will expose your private key!');
          console.error('   Add --show flag to confirm');
          process.exit(1);
        }

        console.log('⚠️  DANGER: Exporting private key\n');
        
        const password = await getPassword();
        const key = vault.export(password);
        
        console.log('\n🔑 Private Key:');
        console.log(`   ${key}`);
        console.log('\n⚠️  Keep this secret! Anyone with this key can spend your funds.');
        break;
      }

      case 'passwd': {
        if (!vault.exists()) {
          console.error('❌ Vault not found. Run "x402 vault init" first.');
          process.exit(1);
        }

        console.log('🔐 Changing vault password...\n');
        
        const oldPassword = await prompt('Current password: ', true);
        const newPassword = await prompt('New password: ', true);
        const confirmPassword = await prompt('Confirm new password: ', true);
        
        if (newPassword !== confirmPassword) {
          console.error('❌ Passwords do not match');
          process.exit(1);
        }
        
        if (newPassword.length < 8) {
          console.error('❌ Password must be at least 8 characters');
          process.exit(1);
        }

        vault.changePassword(oldPassword, newPassword);
        console.log('\n✅ Password changed successfully!');
        break;
      }

      case 'help':
      case '--help':
      case '-h':
      case undefined: {
        showHelp();
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(`\n❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
