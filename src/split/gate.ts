/**
 * Split Execution Payment Gate
 *
 * Wraps MCP tool handlers with the split payment flow:
 *   1. Intercept tool call
 *   2. Request payment JWT from Worker (signs EIP-3009 locally)
 *   3. Verify JWT locally (ES256)
 *   4. Execute original tool handler
 *   5. Inject payment metadata into response
 *
 * Sends MCP progress notifications during the payment flow to keep the
 * transport connection alive while the on-chain settlement completes.
 */

import { appendFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSplitClient, type SplitClient } from './client.js';
import type { JWTClaims, SplitPaymentGateOptions } from './types.js';

/**
 * Debug logger — writes to /tmp/x402-gate.log so it's visible even when
 * the process is spawned by Claude Code (which swallows stderr).
 */
function debugLog(msg: string): void {
  const ts = new Date().toISOString();
  try {
    appendFileSync('/tmp/x402-gate.log', `${ts} [x402-gate] ${msg}\n`);
  } catch { /* ignore write errors */ }
}

/**
 * Extract the progress token from the MCP request metadata, if present.
 */
function getProgressToken(extra: unknown): string | number | undefined {
  try {
    const ex = extra as { _meta?: { progressToken?: string | number } } | undefined;
    return ex?._meta?.progressToken;
  } catch {
    return undefined;
  }
}

/**
 * Send an MCP progress notification to reset the client's request timeout.
 * Falls back to a logging notification if no progress token is available.
 * Best-effort — failures never break the payment flow.
 */
async function notifyProgress(
  extra: unknown,
  step: number,
  total: number,
  message: string,
): Promise<void> {
  debugLog(`notifyProgress (${step}/${total}): ${message}`);
  try {
    const ex = extra as { sendNotification?: (n: unknown) => Promise<void> } | undefined;
    if (typeof ex?.sendNotification !== 'function') {
      debugLog('  sendNotification not available');
      return;
    }

    const progressToken = getProgressToken(extra);
    debugLog(`  progressToken: ${progressToken ?? 'none'}`);

    if (progressToken !== undefined) {
      // Progress notifications reset the client timeout per MCP spec
      await ex.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress: step,
          total,
          message,
        },
      });
      debugLog('  progress notification sent OK');
    } else {
      // Fallback to logging notification
      await ex.sendNotification({
        method: 'notifications/message',
        params: {
          level: 'info',
          logger: 'x402-payment',
          data: message,
        },
      });
      debugLog('  logging notification sent OK');
    }
  } catch (err) {
    debugLog(`  notification failed: ${err}`);
  }
}

function injectPaymentMeta(
  result: { content: Array<{ type: string; text?: string }> },
  claims: JWTClaims,
): typeof result {
  if (!result.content?.[0] || result.content[0].type !== 'text' || !result.content[0].text) {
    return result;
  }

  try {
    const parsed = JSON.parse(result.content[0].text);
    parsed._payment = {
      payment_tx: claims.payment_tx,
      tool: claims.tool,
      exchange: claims.exchange,
      issued_at: new Date(claims.issued_at * 1000).toISOString(),
    };
    result.content[0] = { type: 'text', text: JSON.stringify(parsed, null, 2) };
  } catch {
    // Parse failed — leave result as-is
  }
  return result;
}

/**
 * Wrap an McpServer so that tool handlers go through the split payment flow.
 * Call BEFORE registering tools.
 *
 * @example
 * ```typescript
 * import { wrapWithSplitPayment } from '@qbtlabs/x402/split';
 *
 * wrapWithSplitPayment(server, {
 *   privateKey: process.env.WALLET_PRIVATE_KEY as `0x${string}`,
 *   workerUrl: 'https://mcp.openmm.io',
 *   testnet: true,
 *   freeTools: ['list_exchanges'],
 * });
 *
 * // Then register tools as normal
 * registerTools(server);
 * ```
 */
export function wrapWithSplitPayment(server: McpServer, options: SplitPaymentGateOptions): void {
  debugLog('wrapWithSplitPayment called');

  // Ensure the server declares logging capability so we can send notifications
  try {
    const inner = (server as any).server;
    if (inner?._serverCapabilities && !inner._serverCapabilities.logging) {
      inner._serverCapabilities.logging = {};
      debugLog('logging capability injected');
    }
  } catch { /* best-effort */ }

  const { freeTools = [] } = options;
  const freeSet = new Set(freeTools);

  const client: SplitClient = createSplitClient({
    privateKey: options.privateKey,
    workerUrl: options.workerUrl,
    testnet: options.testnet,
  });

  const originalTool = server.tool.bind(server);

  (server as any).tool = function (...allArgs: any[]) {
    const name: string = allArgs[0];
    debugLog(`tool registered: ${name} (free=${freeSet.has(name)})`);

    if (!freeSet.has(name)) {
      const handlerIdx = allArgs.length - 1;
      const originalHandler = allArgs[handlerIdx] as (...a: any[]) => Promise<any>;

      allArgs[handlerIdx] = async function (args: Record<string, unknown>, extra: unknown) {
        const exchange = (args.exchange as string) ?? '';
        debugLog(`handler called: tool=${name} exchange=${exchange}`);
        debugLog(`_meta: ${JSON.stringify((extra as any)?._meta ?? null)}`);

        await notifyProgress(extra, 1, 5, `Processing payment for ${name}…`);

        debugLog('calling requestJWT…');
        const { jwt } = await client.requestJWT({ exchange, tool: name });
        debugLog(`requestJWT done, jwt length=${jwt.length}`);

        await notifyProgress(extra, 2, 5, `Payment confirmed, verifying…`);

        debugLog('calling verifyJWT…');
        const claims = await client.verifyJWT(jwt);
        debugLog(`verifyJWT done, tool=${claims.tool}`);

        if (claims.tool !== name) {
          throw new Error(`JWT tool mismatch: expected ${name}, got ${claims.tool}`);
        }
        if (exchange && claims.exchange !== exchange) {
          throw new Error(`JWT exchange mismatch: expected ${exchange}, got ${claims.exchange}`);
        }

        await notifyProgress(extra, 3, 5, `Executing ${name}…`);

        // Intercept process.exit to find out what kills the server
        const origExit = process.exit;
        (process as any).exit = (code?: number) => {
          debugLog(`!!! process.exit(${code}) called from:`);
          debugLog(new Error().stack ?? 'no stack');
          origExit(code as any);
        };
        process.on('SIGTERM', () => debugLog('!!! received SIGTERM'));
        process.on('SIGINT', () => debugLog('!!! received SIGINT'));
        process.on('uncaughtException', (e) => debugLog(`!!! uncaughtException: ${e.stack ?? e}`));
        process.on('unhandledRejection', (e) => debugLog(`!!! unhandledRejection: ${e}`));

        debugLog('calling original handler…');
        try {
          const result = await originalHandler(args, extra);
          debugLog('original handler done, injecting payment meta');
          await notifyProgress(extra, 4, 5, `Complete`);
          return injectPaymentMeta(result, claims);
        } catch (err) {
          debugLog(`original handler THREW: ${err}`);
          throw err;
        }
      };
    }

    return (originalTool as any)(...allArgs);
  };
}
