#!/usr/bin/env node
/**
 * x402 Policy CLI
 * Manage spending limits and transaction rules
 */

import { PolicyEngine } from '../policy/engine.js';
import { parseUSDC, formatUSDC } from '../policy/spending.js';

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
x402 policy - Spending limits and transaction rules

USAGE:
  x402 policy <command> [options]

COMMANDS:
  show              Show current policy configuration
  set <rule> <val>  Set a policy rule
  spending          Show spending summary
  audit             Show recent audit log
  export            Export audit log to CSV
  enable            Enable policy enforcement
  disable           Disable policy enforcement
  reset             Reset spending counters

RULES:
  maxSpendPerTx <amount> <currency>     Max per transaction
  maxSpendPerHour <amount> <currency>   Max per hour
  maxSpendPerDay <amount> <currency>    Max per day
  allowedChains <chains...>             Comma-separated chain list
  allowedRecipients <addrs...>          Comma-separated addresses
  blockedRecipients <addrs...>          Comma-separated addresses

EXAMPLES:
  x402 policy show
  x402 policy set maxSpendPerTx 10 USDC
  x402 policy set maxSpendPerDay 100 USDC
  x402 policy set allowedChains base,base-sepolia
  x402 policy spending
  x402 policy spending --week
  x402 policy audit
  x402 policy audit --export
`);
}

async function main() {
  const engine = new PolicyEngine();

  try {
    switch (command) {
      case 'show': {
        const config = engine.getConfig();
        const rules = config.rules;

        console.log('🔐 x402 Policy Configuration\n');
        console.log(`   Status:  ${config.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`   Version: ${config.version}`);
        console.log('');
        console.log('📋 Rules:');
        
        if (rules.maxSpendPerTx) {
          console.log(`   Max per tx:    ${rules.maxSpendPerTx.amount} ${rules.maxSpendPerTx.currency}`);
        }
        if (rules.maxSpendPerHour) {
          console.log(`   Max per hour:  ${rules.maxSpendPerHour.amount} ${rules.maxSpendPerHour.currency}`);
        }
        if (rules.maxSpendPerDay) {
          console.log(`   Max per day:   ${rules.maxSpendPerDay.amount} ${rules.maxSpendPerDay.currency}`);
        }
        if (rules.allowedChains?.length) {
          console.log(`   Chains:        ${rules.allowedChains.join(', ')}`);
        }
        if (rules.allowedRecipients?.length) {
          console.log(`   Allowed to:    ${rules.allowedRecipients.length} addresses`);
        }
        if (rules.blockedRecipients?.length) {
          console.log(`   Blocked:       ${rules.blockedRecipients.length} addresses`);
        }
        
        console.log('');
        console.log('📝 Audit:');
        console.log(`   Logging:       ${config.audit.enabled ? '✅ Enabled' : '❌ Disabled'}`);
        console.log(`   Level:         ${config.audit.logLevel || 'info'}`);
        break;
      }

      case 'set': {
        const rule = args[1];
        const value1 = args[2];
        const value2 = args[3];

        if (!rule) {
          console.error('❌ Missing rule name');
          console.log('   Run "x402 policy --help" for available rules');
          process.exit(1);
        }

        switch (rule) {
          case 'maxSpendPerTx':
          case 'maxSpendPerHour':
          case 'maxSpendPerDay':
          case 'requireApprovalAbove': {
            if (!value1 || !value2) {
              console.error(`❌ Usage: x402 policy set ${rule} <amount> <currency>`);
              process.exit(1);
            }
            engine.setRule(rule, { amount: value1, currency: value2 as 'USDC' | 'USD' });
            console.log(`✅ Set ${rule} = ${value1} ${value2}`);
            break;
          }
          case 'allowedChains': {
            if (!value1) {
              console.error('❌ Usage: x402 policy set allowedChains <chain1,chain2,...>');
              process.exit(1);
            }
            const chains = value1.split(',').map((c) => c.trim());
            engine.setRule('allowedChains', chains);
            console.log(`✅ Set allowedChains = ${chains.join(', ')}`);
            break;
          }
          case 'allowedRecipients':
          case 'blockedRecipients': {
            if (!value1) {
              console.error(`❌ Usage: x402 policy set ${rule} <addr1,addr2,...>`);
              process.exit(1);
            }
            const addrs = value1.split(',').map((a) => a.trim().toLowerCase());
            engine.setRule(rule, addrs);
            console.log(`✅ Set ${rule} = ${addrs.length} addresses`);
            break;
          }
          default:
            console.error(`❌ Unknown rule: ${rule}`);
            process.exit(1);
        }
        break;
      }

      case 'spending': {
        const summary = engine.getSpendingSummary();
        const isWeek = args.includes('--week');

        console.log('💰 Spending Summary\n');

        if (isWeek) {
          console.log('📅 Last 7 Days:');
          for (const day of summary.weekly) {
            console.log(`   ${day.date}: ${day.total} (${day.transactions} txs)`);
          }
        } else {
          console.log('📊 Today:');
          console.log(`   Total:        ${summary.today.total}`);
          console.log(`   Transactions: ${summary.today.transactions}`);
          console.log('');
          console.log('⏰ By Hour:');
          for (const [hour, amount] of Object.entries(summary.today.hourly)) {
            console.log(`   ${hour}:00  ${amount}`);
          }
        }

        console.log('');
        console.log('📝 Recent Transactions:');
        const recent = engine.getRecentTransactions(5);
        if (recent.length === 0) {
          console.log('   (none)');
        } else {
          for (const tx of recent) {
            const amount = formatUSDC(BigInt(tx.amount));
            console.log(`   ${tx.timestamp.slice(11, 19)} ${amount} → ${tx.to.slice(0, 10)}...`);
          }
        }
        break;
      }

      case 'audit': {
        const isExport = args.includes('--export');

        if (isExport) {
          const csv = engine.exportAuditCSV();
          console.log(csv);
        } else {
          const logs = engine.getAuditLog(20);
          console.log('📝 Recent Audit Log\n');
          if (logs.length === 0) {
            console.log('   (no entries)');
          } else {
            for (const line of logs) {
              console.log(`   ${line}`);
            }
          }
        }
        break;
      }

      case 'enable': {
        engine.setEnabled(true);
        console.log('✅ Policy enforcement enabled');
        break;
      }

      case 'disable': {
        engine.setEnabled(false);
        console.log('⚠️  Policy enforcement disabled');
        break;
      }

      case 'reset': {
        const confirm = args[1] === '--confirm';
        if (!confirm) {
          console.error('⚠️  This will reset all spending counters!');
          console.error('   Add --confirm to proceed');
          process.exit(1);
        }
        engine.resetSpending();
        console.log('✅ Spending counters reset');
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
