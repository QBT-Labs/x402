/**
 * MCP Middleware
 * 
 * Wrap MCP tool handlers with x402 payment requirements
 */

import { isEnabled } from '../config.js';
import { getToolPrice, buildPaymentRequirements } from '../pricing.js';
import { parsePaymentHeader, verifyPayment } from '../verify.js';

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
 * Create payment error response
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
 * Wrap a tool handler with x402 payment middleware
 */
export function withX402<T extends ParamsWithPayment>(
  toolName: string,
  handler: ToolHandler<T>
): ToolHandler<T> {
  return async (params: T) => {
    // Skip if x402 not enabled
    if (!isEnabled()) {
      return handler(params);
    }

    // Get pricing
    const pricing = getToolPrice(toolName);
    
    // Free tools pass through
    if (pricing.tier === 'free' || pricing.price === 0) {
      return handler(params);
    }

    // Check for payment signature
    const paymentSignature = params.paymentSignature;
    
    if (!paymentSignature) {
      return paymentRequired(toolName, pricing.price);
    }

    // Parse and verify payment
    const payment = parsePaymentHeader(paymentSignature);
    if (!payment) {
      return paymentError(toolName, 'Invalid payment signature format');
    }

    const result = await verifyPayment(payment, pricing.price);
    if (!result.valid) {
      return paymentError(toolName, result.error ?? 'Unknown error');
    }

    // Payment verified - execute tool
    return handler(params);
  };
}

/**
 * Check payment before tool execution
 * Returns error response if payment required/invalid, null if OK
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

  const result = await verifyPayment(payment, pricing.price);
  if (!result.valid) {
    return paymentError(toolName, result.error ?? 'Unknown error');
  }

  return null;
}
