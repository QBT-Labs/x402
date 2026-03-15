/**
 * x402 Facilitator Client
 *
 * HTTP client for Coinbase's x402 facilitator service.
 * Handles verification and settlement of payments.
 */

import type { PaymentPayload } from './verify.js';
import { getConfig, getActiveChains, USDC_CONTRACTS } from './config.js';
import { getToolPrice } from './pricing.js';

/**
 * Convert our PaymentPayload into the facilitator's expected PaymentPayloadV1 format
 */
function toFacilitatorPayload(payment: PaymentPayload): {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
} {
  return {
    x402Version: payment.x402Version ?? 2,
    scheme: 'exact',
    network: payment.accepted?.network ?? '',
    payload: payment.payload as unknown as Record<string, unknown>,
  };
}

/**
 * Build payment requirements for a tool (facilitator format)
 */
export function buildFacilitatorRequirements(toolName: string): {
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string;
    amount: string;
    maxTimeoutSeconds: number;
    resource: string;
    payTo: string;
    description: string;
    extra?: Record<string, unknown>;
  }>;
} {
  const cfg = getConfig();
  const chains = getActiveChains();
  const pricing = getToolPrice(toolName);
  const amountMicro = Math.ceil(pricing.price * 1_000_000).toString();

  const accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string;
    amount: string;
    maxTimeoutSeconds: number;
    resource: string;
    payTo: string;
    description: string;
    extra?: Record<string, unknown>;
  }> = [];

  for (const chain of chains) {
    const asset = USDC_CONTRACTS[chain];
    if (!asset) continue;

    let payTo = '';
    if (chain.startsWith('eip155:')) {
      payTo = cfg.evm?.address ?? '';
    } else if (chain.startsWith('solana:')) {
      payTo = cfg.solana?.address ?? '';
    } else if (chain.startsWith('cardano:')) {
      payTo = cfg.cardano?.address ?? '';
    }

    if (!payTo) continue;

    accepts.push({
      scheme: 'exact',
      network: chain,
      asset,
      maxAmountRequired: amountMicro,
      amount: amountMicro,
      maxTimeoutSeconds: 300,
      resource: `mcp:tool:${toolName}`,
      payTo,
      description: `Payment for ${toolName}`,
      extra: chain.startsWith('eip155:') ? { name: 'USD Coin', version: '2' } : undefined,
    });
  }

  return { accepts };
}

/**
 * Verify payment via the facilitator service
 */
export async function verifyWithFacilitator(
  payment: PaymentPayload,
  toolName: string
): Promise<{ valid: boolean; error?: string }> {
  const cfg = getConfig();
  const facilitatorUrl = cfg.facilitatorUrl ?? 'https://x402.org/facilitator';
  const requirements = buildFacilitatorRequirements(toolName);

  const acceptedNetwork = payment.accepted?.network;
  const matchingRequirement = requirements.accepts.find((r) => r.network === acceptedNetwork);

  if (!matchingRequirement) {
    return { valid: false, error: `Unsupported network: ${acceptedNetwork}` };
  }

  try {
    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: payment.x402Version ?? 2,
        paymentPayload: toFacilitatorPayload(payment),
        paymentRequirements: matchingRequirement,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { valid: false, error: `Facilitator error: ${response.status} ${errorText}` };
    }

    const result = (await response.json()) as {
      isValid?: boolean;
      valid?: boolean;
      invalidReason?: string;
      error?: string;
    };

    const isValid = result.isValid ?? result.valid ?? false;

    if (!isValid) {
      return { valid: false, error: result.invalidReason || result.error || 'Verification failed' };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Facilitator connection error: ${error}` };
  }
}

/**
 * Settle payment via the facilitator service
 */
export async function settleWithFacilitator(
  payment: PaymentPayload,
  toolName: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const cfg = getConfig();
  const facilitatorUrl = cfg.facilitatorUrl ?? 'https://x402.org/facilitator';
  const requirements = buildFacilitatorRequirements(toolName);

  const acceptedNetwork = payment.accepted?.network;
  const matchingRequirement = requirements.accepts.find((r) => r.network === acceptedNetwork);

  if (!matchingRequirement) {
    return { success: false, error: `Unsupported network: ${acceptedNetwork}` };
  }

  try {
    const response = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: payment.x402Version ?? 2,
        paymentPayload: toFacilitatorPayload(payment),
        paymentRequirements: matchingRequirement,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Settlement error: ${response.status} ${errorText}` };
    }

    const result = (await response.json()) as {
      success?: boolean;
      settled?: boolean;
      txHash?: string;
      transactionHash?: string;
      error?: string;
    };

    const success = result.success ?? result.settled ?? false;
    const txHash = result.txHash ?? result.transactionHash;

    if (!success) {
      return { success: false, error: result.error || 'Settlement failed' };
    }

    return { success: true, txHash };
  } catch (error) {
    return { success: false, error: `Settlement connection error: ${error}` };
  }
}

/**
 * Full payment flow: verify → execute → settle
 */
export async function processPayment<T>(
  payment: PaymentPayload,
  toolName: string,
  executeHandler: () => Promise<T>
): Promise<{
  success: boolean;
  result?: T;
  txHash?: string;
  error?: string;
}> {
  const verifyResult = await verifyWithFacilitator(payment, toolName);
  if (!verifyResult.valid) {
    return { success: false, error: verifyResult.error };
  }

  let result: T;
  try {
    result = await executeHandler();
  } catch (error) {
    return { success: false, error: `Execution error: ${error}` };
  }

  const settleResult = await settleWithFacilitator(payment, toolName);
  if (!settleResult.success) {
    console.error(`Settlement failed: ${settleResult.error}`);
  }

  return {
    success: true,
    result,
    txHash: settleResult.txHash,
  };
}

/**
 * Check if facilitator service is healthy
 */
export async function checkFacilitatorHealth(): Promise<boolean> {
  const cfg = getConfig();
  const facilitatorUrl = cfg.facilitatorUrl ?? 'https://x402.org/facilitator';

  try {
    const response = await fetch(`${facilitatorUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
