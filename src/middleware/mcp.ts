/**
 * MCP Middleware
 * 
 * Wrap MCP tool handlers with x402 payment requirements
 */

import { isEnabled } from '../config.js';
import { getToolPrice, buildPaymentRequirements } from '../pricing.js';
import { parsePaymentHeader } from '../verify.js';
import { processPayment, verifyWithFacilitator } from '../facilitator.js';

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler<T = unknown> = (params: T) => Promise<ToolResult>;

interface ParamsWithPayment {
  paymentSignature?: string;
  [key: string]: unknown;
}

/**
 * Create 402 Payment Required response
 */
function paymentRequired(tool: string, priceUsd: number): ToolResult {
  const requirements = buildPaymentRequirements(priceUsd);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'Payment Required',
        code: 402,
        tool,
        price: priceUsd,
        priceFormatted: `$${priceUsd.toFixed(4)}`,
        ...requirements,
        message: `This tool requires payment of $${priceUsd.toFixed(4)} USDC.`,
        docs: 'https://docs.cdp.coinbase.com/x402/welcome',
      }, null, 2),
    }],
  };
}

/**
 * Create payment verification error response
 */
function paymentError(tool: string, error: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'Payment Verification Failed',
        code: 402,
        tool,
        reason: error,
      }, null, 2),
    }],
  };
}

/**
 * Wrap a tool handler with x402 payment middleware.
 * The tool will require payment based on its configured pricing tier.
 */
export function withX402<T extends ParamsWithPayment>(
  toolName: string,
  handler: ToolHandler<T>
): ToolHandler<T> {
  return async (params: T) => {
    if (!isEnabled()) {
      return handler(params);
    }

    const pricing = getToolPrice(toolName);
    
    if (pricing.tier === 'free' || pricing.price === 0) {
      return handler(params);
    }

    const paymentSignature = params.paymentSignature;
    
    if (!paymentSignature) {
      return paymentRequired(toolName, pricing.price);
    }

    const payment = parsePaymentHeader(paymentSignature);
    if (!payment) {
      return paymentError(toolName, 'Invalid payment signature format');
    }

    const result = await processPayment(payment, toolName, () => handler(params));
    if (!result.success) {
      return paymentError(toolName, result.error ?? 'Unknown error');
    }

    if (result.txHash) {
      process.stderr.write(`[x402] settled on-chain: ${result.txHash}\n`);
    }

    return result.result!;
  };
}

/**
 * Check payment before tool execution.
 * Returns error response if payment required/invalid, null if OK.
 */
export async function checkPayment(
  toolName: string,
  paymentSignature?: string
): Promise<ToolResult | null> {
  if (!isEnabled()) {
    return null;
  }

  const pricing = getToolPrice(toolName);
  
  if (pricing.tier === 'free' || pricing.price === 0) {
    return null;
  }

  if (!paymentSignature) {
    return paymentRequired(toolName, pricing.price);
  }

  const payment = parsePaymentHeader(paymentSignature);
  if (!payment) {
    return paymentError(toolName, 'Invalid payment signature format');
  }

  const result = await verifyWithFacilitator(payment, toolName);
  if (!result.valid) {
    return paymentError(toolName, result.error ?? 'Unknown error');
  }

  return null;
}
