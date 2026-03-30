import { describe, it, expect, jest, beforeAll } from '@jest/globals';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as path from 'path';

const SCRIPT_PATH = path.resolve('dist/scripts/client-proxy.js');

function runCli(
  env: Record<string, string> = {},
  timeoutMs = 3000,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn('node', [SCRIPT_PATH], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

describe('client-proxy CLI', () => {
  beforeAll(() => {
    execSync('npx tsc', { cwd: path.resolve('.') });
  });

  it('exits with error when TARGET_URL is missing', async () => {
    const { code, stderr } = await runCli({
      PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });

    expect(code).toBe(1);
    expect(stderr).toContain('Error: TARGET_URL is required');
  }, 10000);

  it('exits with error when PRIVATE_KEY is missing', async () => {
    const { code, stderr } = await runCli({
      TARGET_URL: 'https://example.com/mcp',
    });

    expect(code).toBe(1);
    expect(stderr).toContain('Error: PRIVATE_KEY is required');
  }, 10000);

  it('exits with error when PRIVATE_KEY does not start with 0x', async () => {
    const { code, stderr } = await runCli({
      TARGET_URL: 'https://example.com/mcp',
      PRIVATE_KEY: 'not-a-hex-key',
    });

    expect(code).toBe(1);
    expect(stderr).toContain('PRIVATE_KEY must be a hex string starting with 0x');
  }, 10000);

  it('logs startup info to stderr', async () => {
    const { stderr } = await runCli(
      {
        TARGET_URL: 'https://example.com/mcp',
        PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        CHAIN_ID: '84532',
      },
      5000,
    );

    expect(stderr).toContain('x402 client proxy starting...');
    expect(stderr).toContain('Target: https://example.com/mcp');
    expect(stderr).toContain('Mode:   stdio');
    expect(stderr).toContain('Chain:  84532');
  }, 15000);
});
