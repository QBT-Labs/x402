import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock MCP SDK modules
const mockClientConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockClientClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockClientListTools = jest.fn<any>();
const mockClientCallTool = jest.fn<any>();
const mockClientListResources = jest.fn<any>();
const mockClientListResourceTemplates = jest.fn<any>();
const mockClientReadResource = jest.fn<any>();
const mockClientListPrompts = jest.fn<any>();
const mockClientGetPrompt = jest.fn<any>();
const mockClientComplete = jest.fn<any>();
const mockClientSetLoggingLevel = jest.fn<any>();

let mockServerCapabilities: Record<string, unknown> | undefined;

const mockClientGetServerCapabilities = jest.fn<any>(() => mockServerCapabilities);

const MockClient = jest.fn<any>().mockImplementation(() => ({
  connect: mockClientConnect,
  close: mockClientClose,
  getServerCapabilities: mockClientGetServerCapabilities,
  listTools: mockClientListTools,
  callTool: mockClientCallTool,
  listResources: mockClientListResources,
  listResourceTemplates: mockClientListResourceTemplates,
  readResource: mockClientReadResource,
  listPrompts: mockClientListPrompts,
  getPrompt: mockClientGetPrompt,
  complete: mockClientComplete,
  setLoggingLevel: mockClientSetLoggingLevel,
}));

const mockServerConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockServerClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockServerSetRequestHandler = jest.fn<any>();

const MockServer = jest.fn<any>().mockImplementation(() => ({
  connect: mockServerConnect,
  close: mockServerClose,
  setRequestHandler: mockServerSetRequestHandler,
}));

const MockStdioServerTransport = jest.fn<any>();
const MockSimpleHTTPTransport = jest.fn<any>();

jest.unstable_mockModule('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: MockServer,
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: MockStdioServerTransport,
}));

jest.unstable_mockModule('../transport/simple-http.js', () => ({
  SimpleHTTPTransport: MockSimpleHTTPTransport,
}));

// Import real schemas (they're just Zod objects, no need to mock)
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
} = await import('@modelcontextprotocol/sdk/types.js');

const { createPassthroughProxy } = await import('../proxy/passthrough.js');

const mockFetchFn = jest.fn<typeof fetch>();

describe('createPassthroughProxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerCapabilities = { tools: {}, resources: {}, prompts: {} };
  });

  it('creates client with correct target URL and fetch function', async () => {
    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    expect(MockSimpleHTTPTransport).toHaveBeenCalledWith({
      url: 'https://remote.example.com/mcp',
      fetch: mockFetchFn,
    });
    expect(mockClientConnect).toHaveBeenCalled();
  });

  it('creates server with custom name and version', async () => {
    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
      name: 'my-proxy',
      version: '2.0.0',
    });

    expect(MockServer).toHaveBeenCalledWith(
      { name: 'my-proxy', version: '2.0.0' },
      expect.any(Object),
    );

    expect(MockClient).toHaveBeenCalledWith(
      { name: 'my-proxy-client', version: '2.0.0' },
    );
  });

  it('uses default name and version when not provided', async () => {
    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    expect(MockServer).toHaveBeenCalledWith(
      { name: 'x402-proxy', version: '1.0.0' },
      expect.any(Object),
    );
  });

  it('registers tool handlers when remote has tools capability', async () => {
    mockServerCapabilities = { tools: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const registeredSchemas = mockServerSetRequestHandler.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredSchemas).toContain(ListToolsRequestSchema);
    expect(registeredSchemas).toContain(CallToolRequestSchema);
  });

  it('registers resource handlers when remote has resources capability', async () => {
    mockServerCapabilities = { resources: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const registeredSchemas = mockServerSetRequestHandler.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredSchemas).toContain(ListResourcesRequestSchema);
    expect(registeredSchemas).toContain(ListResourceTemplatesRequestSchema);
    expect(registeredSchemas).toContain(ReadResourceRequestSchema);
  });

  it('registers prompt handlers when remote has prompts capability', async () => {
    mockServerCapabilities = { prompts: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const registeredSchemas = mockServerSetRequestHandler.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredSchemas).toContain(ListPromptsRequestSchema);
    expect(registeredSchemas).toContain(GetPromptRequestSchema);
  });

  it('registers completion handler when remote has completions capability', async () => {
    mockServerCapabilities = { completions: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const registeredSchemas = mockServerSetRequestHandler.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredSchemas).toContain(CompleteRequestSchema);
  });

  it('registers logging handler when remote has logging capability', async () => {
    mockServerCapabilities = { logging: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const registeredSchemas = mockServerSetRequestHandler.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredSchemas).toContain(SetLevelRequestSchema);
  });

  it('does not register handlers for capabilities the remote lacks', async () => {
    mockServerCapabilities = {};

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    expect(mockServerSetRequestHandler).not.toHaveBeenCalled();
  });

  it('forwards listTools to remote client', async () => {
    const toolsResult = {
      tools: [{ name: 'test_tool', inputSchema: { type: 'object' as const } }],
    };
    mockClientListTools.mockResolvedValue(toolsResult);

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    // Find the listTools handler
    const listToolsCall = mockServerSetRequestHandler.mock.calls.find(
      (call: unknown[]) => call[0] === ListToolsRequestSchema,
    );
    const handler = listToolsCall![1] as (req: { params?: unknown }) => Promise<unknown>;

    const result = await handler({ params: undefined });
    expect(result).toBe(toolsResult);
    expect(mockClientListTools).toHaveBeenCalledWith(undefined);
  });

  it('forwards callTool to remote client', async () => {
    const callResult = {
      content: [{ type: 'text', text: 'result' }],
    };
    mockClientCallTool.mockResolvedValue(callResult);

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const callToolCall = mockServerSetRequestHandler.mock.calls.find(
      (call: unknown[]) => call[0] === CallToolRequestSchema,
    );
    const handler = callToolCall![1] as (req: { params: unknown }) => Promise<unknown>;

    const params = { name: 'test_tool', arguments: { key: 'value' } };
    const result = await handler({ params });
    expect(result).toBe(callResult);
    expect(mockClientCallTool).toHaveBeenCalledWith(params);
  });

  it('forwards readResource to remote client', async () => {
    const readResult = {
      contents: [{ uri: 'test://resource', text: 'content' }],
    };
    mockClientReadResource.mockResolvedValue(readResult);

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const readCall = mockServerSetRequestHandler.mock.calls.find(
      (call: unknown[]) => call[0] === ReadResourceRequestSchema,
    );
    const handler = readCall![1] as (req: { params: unknown }) => Promise<unknown>;

    const params = { uri: 'test://resource' };
    const result = await handler({ params });
    expect(result).toBe(readResult);
    expect(mockClientReadResource).toHaveBeenCalledWith(params);
  });

  it('forwards getPrompt to remote client', async () => {
    const promptResult = {
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
    };
    mockClientGetPrompt.mockResolvedValue(promptResult);

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const getPromptCall = mockServerSetRequestHandler.mock.calls.find(
      (call: unknown[]) => call[0] === GetPromptRequestSchema,
    );
    const handler = getPromptCall![1] as (req: { params: unknown }) => Promise<unknown>;

    const params = { name: 'test_prompt' };
    const result = await handler({ params });
    expect(result).toBe(promptResult);
    expect(mockClientGetPrompt).toHaveBeenCalledWith(params);
  });

  it('connects local server via StdioServerTransport in stdio mode', async () => {
    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    expect(MockStdioServerTransport).toHaveBeenCalled();
    expect(mockServerConnect).toHaveBeenCalled();
  });

  it('throws for unsupported transport mode', async () => {
    await expect(
      createPassthroughProxy({
        targetUrl: 'https://remote.example.com/mcp',
        fetchFn: mockFetchFn as typeof fetch,
        mode: 'http' as any,
      }),
    ).rejects.toThrow('Transport mode "http" is not yet supported');
  });

  it('stop function closes both client and server', async () => {
    const { stop } = await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    await stop();

    expect(mockClientClose).toHaveBeenCalled();
    expect(mockServerClose).toHaveBeenCalled();
  });

  it('mirrors remote capabilities to local server', async () => {
    mockServerCapabilities = { tools: {}, prompts: {} };

    await createPassthroughProxy({
      targetUrl: 'https://remote.example.com/mcp',
      fetchFn: mockFetchFn as typeof fetch,
      mode: 'stdio',
    });

    const serverOptions = MockServer.mock.calls[0][1] as { capabilities: Record<string, unknown> };
    expect(serverOptions.capabilities).toHaveProperty('tools');
    expect(serverOptions.capabilities).toHaveProperty('prompts');
    expect(serverOptions.capabilities).not.toHaveProperty('resources');
  });
});
