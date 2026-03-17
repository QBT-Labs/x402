/**
 * Split Execution Payment Gate
 *
 * Wraps MCP tool handlers with the split payment flow:
 *   1. Intercept tool call
 *   2. Request payment JWT from Worker (signs EIP-3009 locally)
 *   3. Verify JWT locally (ES256)
 *   4. Execute original tool handler
 *   5. Inject payment metadata into response
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSplitClient, type SplitClient } from './client.js';
import type { JWTClaims, SplitPaymentGateOptions } from './types.js';

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

    if (!freeSet.has(name)) {
      const handlerIdx = allArgs.length - 1;
      const originalHandler = allArgs[handlerIdx] as (...a: any[]) => Promise<any>;

      allArgs[handlerIdx] = async function (args: Record<string, unknown>, extra: unknown) {
        const exchange = (args.exchange as string) ?? '';

        const { jwt } = await client.requestJWT({ exchange, tool: name });
        const claims = await client.verifyJWT(jwt);

        if (claims.tool !== name) {
          throw new Error(`JWT tool mismatch: expected ${name}, got ${claims.tool}`);
        }
        if (exchange && claims.exchange !== exchange) {
          throw new Error(`JWT exchange mismatch: expected ${exchange}, got ${claims.exchange}`);
        }

        const result = await originalHandler(args, extra);
        return injectPaymentMeta(result, claims);
      };
    }

    return (originalTool as any)(...allArgs);
  };
}
