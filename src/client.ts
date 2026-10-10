/**
 * x402 Client - Payment signing for agents
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia, base } from 'viem/chains';

const USDC_CONTRACTS: Record<number, `0x${string}`> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
};

interface SignPaymentParams {
  privateKey: `0x${string}`;
  to: `0x${string}`;
  amount: number;
  chainId?: number;
  validForSeconds?: number;
  /** Exact amount in atomic USDC units (6 decimals), e.g. from an x402 v2 `accepts[].amount`. Overrides `amount`. */
  amountAtomic?: string;
}

export interface SignedPayment {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
  network: string;
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ('0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as `0x${string}`;
}

/**
 * Sign an EIP-3009 payment authorization
 */
export async function signPayment(params: SignPaymentParams): Promise<SignedPayment> {
  const { privateKey, to, amount, chainId = 84532, validForSeconds = 300 } = params;
  const exact = params.amountAtomic !== undefined ? BigInt(params.amountAtomic) : undefined;

  const account = privateKeyToAccount(privateKey);
  const chain = chainId === 8453 ? base : baseSepolia;
  const usdcContract = USDC_CONTRACTS[chainId];

  if (!usdcContract) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const value = BigInt(Math.ceil(amount * 1_000_000));
  const validAfter = BigInt(0);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + validForSeconds);
  const nonce = randomNonce();

  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  // Base Sepolia USDC uses domain name "USDC"; mainnet uses "USD Coin"
  const domainName = chainId === 84532 ? 'USDC' : 'USD Coin';

  const signature = await client.signTypedData({
    domain: {
      name: domainName,
      version: '2',
      chainId: BigInt(chainId),
      verifyingContract: usdcContract,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address,
      to,
      value: exact ?? value,
      validAfter,
      validBefore,
      nonce,
    },
  });

  return {
    from: account.address,
    to,
    value: (exact ?? value).toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    signature,
    network: `eip155:${chainId}`,
  };
}

/**
 * Build payment payload for x402 header
 */
/**
 * x402 v2 servers match `accepted` against the requirement they offered (maxTimeoutSeconds, extra, ...), so echo
 * the server's entry when it is for the same payee and amount that was signed; otherwise build the minimal block.
 */
function acceptedBlock(
  fallback: { scheme: string; network: string; asset: string; amount: string; payTo: string },
  offered?: PaymentRequirementEntry,
): Record<string, unknown> {
  if (
    offered &&
    String(offered.payTo).toLowerCase() === fallback.payTo.toLowerCase() &&
    String(offered.amount ?? offered.maxAmountRequired) === fallback.amount
  ) {
    return { ...offered };
  }
  return fallback;
}

export function buildPaymentPayload(signedPayment: SignedPayment, offered?: PaymentRequirementEntry): string {
  const asset = signedPayment.network === 'eip155:84532'
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    
  // Build payload in the format expected by x402.org facilitator
  const payload = {
    x402Version: 2,
    scheme: 'exact',
    network: signedPayment.network,
    payload: {
      authorization: {
        from: signedPayment.from,
        to: signedPayment.to,
        value: signedPayment.value,
        validAfter: signedPayment.validAfter,
        validBefore: signedPayment.validBefore,
        nonce: signedPayment.nonce,
      },
      signature: signedPayment.signature,
    },
    accepted: acceptedBlock(
      { scheme: 'exact', network: signedPayment.network, asset, amount: signedPayment.value, payTo: signedPayment.to },
      offered,
    ),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Build payment payload from a pre-signed signature (for isolated signer mode)
 * @deprecated Use buildPaymentPayloadWithAuthorization instead
 */
export function buildPaymentPayloadFromSignature(params: {
  signature: string;
  from: string;
  to: string;
  amount: string;
  chainId: number;
}): string {
  const { signature, from, to, amount, chainId } = params;
  const network = `eip155:${chainId}`;
  const asset = chainId === 84532
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const now = Math.floor(Date.now() / 1000);
  
  // Build payload in the format expected by x402.org facilitator
  const payload = {
    x402Version: 2,
    scheme: 'exact',
    network,
    payload: {
      authorization: {
        from,
        to,
        value: amount,
        validAfter: '0',
        validBefore: String(now + 300),
        nonce: '0x' + crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
      },
      signature,
    },
    // Also include accepted for compatibility
    accepted: {
      scheme: 'exact',
      network,
      asset,
      amount,
      payTo: to,
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Build payment payload with exact authorization data from signer.
 * This ensures the authorization fields match what was signed.
 */
export function buildPaymentPayloadWithAuthorization(params: {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  chainId: number;
  /** The requirement entry from the server's 402 (`parsePaymentRequired(...).accepted`); echoed when it matches. */
  accepted?: PaymentRequirementEntry;
}): string {
  const { signature, authorization, chainId } = params;
  const network = `eip155:${chainId}`;
  const asset = chainId === 84532
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  
  // Use exact authorization data that was signed
  const payload = {
    x402Version: 2,
    payload: {
      authorization,
      signature,
    },
    accepted: acceptedBlock(
      { scheme: 'exact', network, asset, amount: authorization.value, payTo: authorization.to },
      params.accepted,
    ),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** One entry of an x402 `accepts` list (v1 uses `maxAmountRequired`, v2 uses `amount`). */
export interface PaymentRequirementEntry {
  network: string;
  asset?: string;
  payTo: string;
  scheme?: string;
  amount?: string;
  maxAmountRequired?: string;
  [extra: string]: unknown;
}

/**
 * Parse a 402 body (or a decoded v2 `PAYMENT-REQUIRED` header) and pick the first requirement this client can pay:
 * scheme `exact` (or unstated), USDC on Base or Base Sepolia. Accepts x402 v1 (`error: 'Payment Required'`,
 * `maxAmountRequired`) and v2 (`x402Version: 2`, any error text, `amount`). Returns null when nothing is payable.
 */
export function parsePaymentRequired(response: {
  x402Version?: number;
  error?: string;
  price?: number;
  accepts?: PaymentRequirementEntry[];
}): {
  price: number;
  payTo: string;
  network: string;
  chainId: number;
  /** Exact amount in atomic USDC units, as the server stated it. */
  amountAtomic?: string;
  /** The chosen `accepts` entry, verbatim, to echo back as `accepted` (x402 v2). */
  accepted: PaymentRequirementEntry;
} | null {
  if (!response || !Array.isArray(response.accepts) || !response.accepts.length) return null;
  if (response.x402Version !== 2 && response.error !== 'Payment Required') return null;

  for (const accept of response.accepts) {
    if (accept.scheme !== undefined && accept.scheme !== 'exact') continue;
    const [ns, ref] = String(accept.network ?? '').split(':');
    const chainId = parseInt(ref || '84532');
    if (ns !== 'eip155' || !USDC_CONTRACTS[chainId]) continue;
    if (accept.asset && accept.asset.toLowerCase() !== USDC_CONTRACTS[chainId].toLowerCase()) continue;
    const raw = accept.amount ?? accept.maxAmountRequired;
    const amountAtomic = raw !== undefined && /^[0-9]+$/.test(String(raw)) ? String(raw) : undefined;
    if (amountAtomic === undefined && response.price === undefined) continue;
    return {
      price: response.price ?? Number(amountAtomic) / 1_000_000,
      payTo: accept.payTo,
      network: accept.network,
      chainId,
      ...(amountAtomic !== undefined ? { amountAtomic } : {}),
      accepted: accept,
    };
  }
  return null;
}
