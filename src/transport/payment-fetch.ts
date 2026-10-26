import { parsePaymentRequired, signPayment, buildPaymentPayload } from '../client.js';

/** Read lazy init values once, including inherited and non-enumerable fields. */
function memoizeRequestInit(init?: RequestInit): RequestInit | undefined {
  if (init === undefined || init === null) return undefined;
  const values = new Map<PropertyKey, unknown>();
  return new Proxy(init, {
    get(target, key) {
      if (!values.has(key)) values.set(key, Reflect.get(target, key, target));
      return values.get(key);
    },
    set(target, key, value) {
      const written = Reflect.set(target, key, value, target);
      if (written) values.delete(key);
      return written;
    },
    defineProperty(target, key, descriptor) {
      const defined = Reflect.defineProperty(target, key, descriptor);
      if (defined) values.delete(key);
      return defined;
    },
    deleteProperty(target, key) {
      const deleted = Reflect.deleteProperty(target, key);
      if (deleted) values.delete(key);
      return deleted;
    },
  });
}

/** Override selected fields without eagerly evaluating other init getters. */
function overrideRequestInit(init: RequestInit | undefined, overrides: RequestInit): RequestInit {
  const result = Object.create(init ?? Object.prototype) as RequestInit;
  if (init) {
    for (const key of Reflect.ownKeys(init)) {
      const descriptor = Object.getOwnPropertyDescriptor(init, key);
      if (!descriptor) continue;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: () => Reflect.get(init, key),
        ...(descriptor.writable || descriptor.set ? {
          set: (value: unknown) => {
            if (!Reflect.set(init, key, value)) throw new TypeError('Cannot assign request option');
          },
        } : {}),
      });
    }
  }
  Object.defineProperties(result, Object.getOwnPropertyDescriptors(overrides));
  return new Proxy(result, {
    deleteProperty(target, key) {
      // Deleting a forwarded option must not expose the original value again.
      if (Object.getOwnPropertyDescriptor(target, key)?.configurable === false) return false;
      if (init && !Reflect.deleteProperty(init, key)) return false;
      return Reflect.deleteProperty(target, key);
    },
  });
}


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
    const cachedInit = memoizeRequestInit(init);
    const request = input;
    let retryRequest = input;
    let fetchInit = cachedInit;
    let retryInit = cachedInit;
    const bodies: ReadableStream[] = [];
    try {
      const body = cachedInit?.body;
      const suppliedHeaders = cachedInit?.headers;
      if (suppliedHeaders !== undefined) {
        fetchInit = overrideRequestInit(cachedInit, { headers: new Headers(suppliedHeaders) });
      }
      retryInit = fetchInit;

      if (body instanceof ReadableStream) {
        // An explicit stream overrides any Request body; reserve both send branches.
        const [first, replay] = body.tee();
        bodies.push(first, replay);
        retryInit = overrideRequestInit(fetchInit, { body: replay });
        fetchInit = overrideRequestInit(fetchInit, { body: first });
      } else if (input instanceof Request && body == null && input.body) {
        // Keep the original transport input and options. Clone only a body that
        // the first send will consume; explicit reusable body overrides need no clone.
        let replay: Request;
        try {
          replay = input.clone();
        } finally {
          if (input.body) bodies.push(input.body);
        }
        if (replay.body) bodies.push(replay.body);
        retryRequest = replay;
      }
      return await sendWithPayment(request, fetchInit, retryRequest, retryInit);
    } finally {
      // Release unsent branches, including when the transport rejects before reading.
      // Never await one tee branch while its sibling may still be in use.
      for (const body of bodies) {
        // Alternate Request implementations can expose reusable byte buffers.
        if (typeof body.cancel === 'function' && !body.locked) void body.cancel().catch(() => {});
      }
    }
  };

  async function sendWithPayment(
    request: string | URL | Request,
    init: RequestInit | undefined,
    retryRequest: string | URL | Request,
    retryInit: RequestInit | undefined,
  ): Promise<Response> {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    log('Making request to:', url);
    
    const response = await fetch(request, init);
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

    const retryHeaders = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
    retryHeaders.set('X-PAYMENT', paymentHeader);

    log('Retrying with payment...');
    const retryResponse = await fetch(retryRequest, overrideRequestInit(retryInit, { headers: retryHeaders }));
    log('Retry response status:', retryResponse.status);

    if (onPaymentSent) {
      onPaymentSent(url, requirements.price);
    }

    return retryResponse;
  }
}
