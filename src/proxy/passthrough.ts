/**
 * MCP Passthrough Proxy
 *
 * Creates a local MCP server that mirrors a remote MCP server,
 * forwarding all requests through a payment-aware fetch function.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export interface PassthroughProxyOptions {
  targetUrl: string;
  fetchFn: typeof fetch;
  mode: 'stdio' | 'http';
  port?: number;
  name?: string;
  version?: string;
}

export async function createPassthroughProxy(
  options: PassthroughProxyOptions,
): Promise<{ stop: () => Promise<void> }> {
  const {
    targetUrl,
    fetchFn,
    mode,
    name = 'x402-proxy',
    version = '1.0.0',
  } = options;

  // Create MCP client that connects to the remote server
  const mcpClient = new Client({ name: `${name}-client`, version });

  const transport = new StreamableHTTPClientTransport(new URL(targetUrl), {
    fetch: fetchFn,
  });

  await mcpClient.connect(transport);

  // Discover remote capabilities
  const capabilities = mcpClient.getServerCapabilities();

  const hasTools = !!capabilities?.tools;
  const hasResources = !!capabilities?.resources;
  const hasPrompts = !!capabilities?.prompts;
  const hasLogging = !!capabilities?.logging;
  const hasCompletion = !!capabilities?.completions;

  // Create local MCP server mirroring remote capabilities
  const mcpServer = new Server(
    { name, version },
    {
      capabilities: {
        ...(hasTools ? { tools: {} } : {}),
        ...(hasResources ? { resources: {} } : {}),
        ...(hasPrompts ? { prompts: {} } : {}),
        ...(hasLogging ? { logging: {} } : {}),
        ...(hasCompletion ? { completions: {} } : {}),
      },
    },
  );

  // Register passthrough handlers for tools
  if (hasTools) {
    mcpServer.setRequestHandler(ListToolsRequestSchema, async (request) => {
      return mcpClient.listTools(request.params);
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      return mcpClient.callTool(request.params);
    });
  }

  // Register passthrough handlers for resources
  if (hasResources) {
    mcpServer.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      return mcpClient.listResources(request.params);
    });

    mcpServer.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
      return mcpClient.listResourceTemplates(request.params);
    });

    mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return mcpClient.readResource(request.params);
    });
  }

  // Register passthrough handlers for prompts
  if (hasPrompts) {
    mcpServer.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      return mcpClient.listPrompts(request.params);
    });

    mcpServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return mcpClient.getPrompt(request.params);
    });
  }

  // Register passthrough handler for completion
  if (hasCompletion) {
    mcpServer.setRequestHandler(CompleteRequestSchema, async (request) => {
      return mcpClient.complete(request.params);
    });
  }

  // Register passthrough handler for logging level
  if (hasLogging) {
    mcpServer.setRequestHandler(SetLevelRequestSchema, async (request) => {
      return mcpClient.setLoggingLevel(request.params.level);
    });
  }

  // Connect local server to transport
  if (mode === 'stdio') {
    const serverTransport = new StdioServerTransport();
    await mcpServer.connect(serverTransport);
  } else {
    throw new Error(`Transport mode "${mode}" is not yet supported`);
  }

  return {
    stop: async () => {
      await mcpClient.close();
      await mcpServer.close();
    },
  };
}
