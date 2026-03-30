/**
 * Types and interfaces for the x402 EVM adapter.
 */

export interface EvmPaymentPayload {
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: string;
}

export interface SignEIP3009Options {
  privateKey: string;
  to: string;
  value: bigint;
  validAfter: number;
  validBefore: number;
  nonce?: bigint;
  chainId: number;
}

export interface SignEIP3009Result {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}
