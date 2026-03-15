import { parsePaymentRequired, signPayment, buildPaymentPayload } from '../client.js';

export interface PaymentFetchOptions {
  privateKey: `0x${string}`;
  chainId?: number;
  onPaymentRequired?: (url: string, amount: number) => Promise<boolean>;
  onPaymentSent?: (url: string, amount: number) => void;
}

const log = (...args: unknown[]) => process.stderr.write('[PaymentFetch] ' + args.join(' ') + '\n');

export function createPaymentFetch(options: PaymentFetchOptions): typeof fetch {
  const { privateKey, chainId, onPaymentRequired, onPaymentSent } = options;

  return async function paymentFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    log('Making request to:', url);
    
    const response = await fetch(input, init);
    log('Response status:', response.status);

    if (response.status !== 402) {
      return response;
    }

    log('Got 402 Payment Required!');
    const bodyText = await response.text();
    log('Body:', bodyText.substring(0, 200));
    
    let body: any;
    try {
      body = JSON.parse(bodyText);
    } catch (e) {
      log('Failed to parse JSON:', e);
      throw new Error('Failed to parse 402 response');
    }

    const requirements = parsePaymentRequired(body);
    log('Parsed requirements:', JSON.stringify(requirements));
    
    if (!requirements) {
      throw new Error('Failed to parse payment requirements from 402 response');
    }

    if (onPaymentRequired) {
      const approved = await onPaymentRequired(url, requirements.price);
      if (!approved) {
        throw new Error('Payment cancelled by user');
      }
    }

    log('Signing payment...');
    const signedPayment = await signPayment({
      privateKey,
      to: requirements.payTo as `0x${string}`,
      amount: requirements.price,
      chainId: chainId ?? requirements.chainId,
    });
    log('Payment signed, from:', signedPayment.from);

    const paymentHeader = buildPaymentPayload(signedPayment);
    log('Payment header length:', paymentHeader.length);

    const retryHeaders = new Headers(init?.headers);
    retryHeaders.set('X-PAYMENT', paymentHeader);

    log('Retrying with payment...');
    const retryResponse = await fetch(input, {
      ...init,
      headers: retryHeaders,
    });
    log('Retry response status:', retryResponse.status);

    if (onPaymentSent) {
      onPaymentSent(url, requirements.price);
    }

    return retryResponse;
  };
}
