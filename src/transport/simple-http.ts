/**
 * Simple HTTP Transport for MCP
 * 
 * A basic JSON-RPC over HTTP transport for MCP servers that don't support
 * the full Streamable HTTP protocol (SSE streaming).
 */

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

export interface SimpleHTTPTransportOptions {
  url: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export class SimpleHTTPTransport implements Transport {
  private url: string;
  private fetchFn: typeof fetch;
  private headers: Record<string, string>;
  private messageHandler?: (message: JSONRPCMessage) => void;
  private closeHandler?: () => void;
  private errorHandler?: (error: Error) => void;

  constructor(options: SimpleHTTPTransportOptions) {
    this.url = options.url;
    this.fetchFn = options.fetch ?? fetch;
    this.headers = options.headers ?? {};
  }

  async start(): Promise<void> {
    // Nothing to do for HTTP - connection is per-request
  }

  async close(): Promise<void> {
    this.closeHandler?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json() as JSONRPCMessage;
      this.messageHandler?.(data);
    } catch (error) {
      this.errorHandler?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  set onmessage(handler: (message: JSONRPCMessage) => void) {
    this.messageHandler = handler;
  }

  set onclose(handler: () => void) {
    this.closeHandler = handler;
  }

  set onerror(handler: (error: Error) => void) {
    this.errorHandler = handler;
  }
}
