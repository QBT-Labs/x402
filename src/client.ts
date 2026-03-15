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

  const signature = await client.signTypedData({
    domain: {
      name: 'USD Coin',
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
      value,
      validAfter,
      validBefore,
      nonce,
    },
  });

  return {
    from: account.address,
    to,
    value: value.toString(),
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
export function buildPaymentPayload(signedPayment: SignedPayment): string {
  const payload = {
    x402Version: 2,
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
    accepted: {
      network: signedPayment.network,
      asset: signedPayment.network === 'eip155:84532'
        ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
        : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: signedPayment.value,
      payTo: signedPayment.to,
    },
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Parse 402 response and extract payment requirements
 */
export function parsePaymentRequired(response: {
  error?: string;
  price?: number;
  accepts?: Array<{ network: string; asset: string; payTo: string; maxAmountRequired: string }>;
}): {
  price: number;
  payTo: string;
  network: string;
  chainId: number;
} | null {
  if (response.error !== 'Payment Required' || !response.accepts?.length) {
    return null;
  }

  const accept = response.accepts[0];
  const chainId = parseInt(accept.network.split(':')[1] || '84532');

  return {
    price: response.price ?? parseInt(accept.maxAmountRequired) / 1_000_000,
    payTo: accept.payTo,
    network: accept.network,
    chainId,
  };
}
