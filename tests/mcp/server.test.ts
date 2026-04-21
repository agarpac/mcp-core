/**
 * Tests for the gateway MCP server.
 *
 * Strategy:
 *   - Inject a mock DaemonMetaClient (no real socket, no subprocess).
 *   - Use `InMemoryTransport.createLinkedPair()` for client ↔ server transport.
 *   - Mock the underlying CLI commands for the mcp_core__ control tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Mocks ------------------------------------------------------------------

const { runInstallMock, runUninstallMock, toggleClientServerMock, getDaemonStatusMock, configGetMock } =
  vi.hoisted(() => ({
    runInstallMock: vi.fn(),
    runUninstallMock: vi.fn(),
    toggleClientServerMock: vi.fn(),
    getDaemonStatusMock: vi.fn(),
    configGetMock: vi.fn(),
  }));

vi.mock('../../src/cli/commands/install', () => ({ runInstall: runInstallMock }));
vi.mock('../../src/cli/commands/uninstall', () => ({ runUninstall: runUninstallMock }));
vi.mock('../../src/cli/injectors/index', () => ({
  toggleClientServer: toggleClientServerMock,
  addServerToClients: vi.fn(),
  removeServerFromClients: vi.fn(),
}));
vi.mock('../../src/cli/commands/status', () => ({ getDaemonStatus: getDaemonStatusMock }));
vi.mock('../../src/config/store', () => ({
  ConfigStore: {
    initialize: vi.fn(),
    get: configGetMock,
    addServer: vi.fn(),
    removeServer: vi.fn(),
  },
}));

import {
  createGatewayServer,
  GATEWAY_CONTROL_TOOLS,
  type DaemonMetaClient,
  type BackendClient,
  type GatewayServer,
} from '../../src/mcp/server';
import type { BackendInfo } from '../../src/daemon/index';

// --- Helpers ----------------------------------------------------------------

function makeMockMetaClient(backends: BackendInfo[] = []): DaemonMetaClient {
  const ee = new EventEmitter() as DaemonMetaClient;
  ee.listBackends = async () => backends;
  ee.close = () => {};
  return ee;
}

async function makeGateway(backends: BackendInfo[] = []): Promise<GatewayServer> {
  const gateway = createGatewayServer({
    _metaClientFactory: async () => makeMockMetaClient(backends),
  });
  await gateway.start();
  return gateway;
}

async function connectMcpClient(gateway: GatewayServer) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([gateway.server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// --- Tests ------------------------------------------------------------------

describe('gateway MCP server — control tools', () => {
  beforeEach(() => {
    runInstallMock.mockReset();
    runUninstallMock.mockReset();
    toggleClientServerMock.mockReset();
    getDaemonStatusMock.mockReset();
    configGetMock.mockReset();
  });

  describe('tool registration', () => {
    it('exposes exactly the 5 mcp_core__ control tools when no backends are registered', async () => {
      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();

      expect(names).toEqual([...GATEWAY_CONTROL_TOOLS].sort());

      await client.close();
      await gateway.server.close();
    });

    it('each control tool has a non-empty description and object inputSchema', async () => {
      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const { tools } = await client.listTools();
      const controlTools = tools.filter((t) => t.name.startsWith('mcp_core__'));

      for (const tool of controlTools) {
        expect(tool.description, `${tool.name} missing description`).toBeTruthy();
        expect((tool.inputSchema as any).type).toBe('object');
      }

      await client.close();
      await gateway.server.close();
    });

    it('includes backend tools with prefix alongside control tools', async () => {
      const backends: BackendInfo[] = [
        { name: 'memory', tools: [{ name: 'store' }, { name: 'retrieve' }], resources: [], prompts: [] },
      ];
      const gateway = await makeGateway(backends);
      const client = await connectMcpClient(gateway);

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain('memory__store');
      expect(names).toContain('memory__retrieve');
      expect(names).toContain('mcp_core__install_server');
      expect(names).toHaveLength(2 + GATEWAY_CONTROL_TOOLS.length);

      await client.close();
      await gateway.server.close();
    });
  });

  describe('mcp_core__list_servers', () => {
    it('returns server map from ConfigStore as array', async () => {
      configGetMock.mockReturnValue({
        version: '1.0.0',
        servers: {
          postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], clientsLinked: ['cursor'] },
        },
      });

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({ name: 'mcp_core__list_servers', arguments: {} });
      expect(result.isError).not.toBe(true);

      const parsed = JSON.parse((result.content as any[])[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('postgres');

      await client.close();
      await gateway.server.close();
    });
  });

  describe('mcp_core__install_server', () => {
    it('delegates to runInstall and returns success', async () => {
      runInstallMock.mockResolvedValue('postgres');

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({
        name: 'mcp_core__install_server',
        arguments: {
          source: '@modelcontextprotocol/server-postgres',
          name: 'postgres',
          env: { DATABASE_URL: 'postgres://localhost' },
        },
      });

      expect(runInstallMock).toHaveBeenCalledTimes(1);
      const [source, name, env] = runInstallMock.mock.calls[0]!;
      expect(source).toBe('@modelcontextprotocol/server-postgres');
      expect(name).toBe('postgres');
      expect(env).toEqual({ DATABASE_URL: 'postgres://localhost' });

      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as any[])[0].text);
      expect(payload.success).toBe(true);
      expect(payload.name).toBe('postgres');

      await client.close();
      await gateway.server.close();
    });

    it('returns isError=true when runInstall throws', async () => {
      runInstallMock.mockRejectedValue(new Error('clone failed'));

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({
        name: 'mcp_core__install_server',
        arguments: { source: 'https://github.com/foo/bar.git' },
      });

      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain('clone failed');

      await client.close();
      await gateway.server.close();
    });
  });

  describe('mcp_core__uninstall_server', () => {
    it('delegates to runUninstall', async () => {
      runUninstallMock.mockReturnValue(undefined);

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({
        name: 'mcp_core__uninstall_server',
        arguments: { name: 'postgres' },
      });

      expect(runUninstallMock).toHaveBeenCalledWith('postgres');
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as any[])[0].text);
      expect(payload.success).toBe(true);

      await client.close();
      await gateway.server.close();
    });

    it('returns isError=true when runUninstall throws', async () => {
      runUninstallMock.mockImplementation(() => {
        throw new Error("El servidor 'ghost' no está registrado.");
      });

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({
        name: 'mcp_core__uninstall_server',
        arguments: { name: 'ghost' },
      });

      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain('no está registrado');

      await client.close();
      await gateway.server.close();
    });
  });

  describe('mcp_core__toggle_client', () => {
    it('delegates to toggleClientServer', async () => {
      toggleClientServerMock.mockReturnValue(undefined);

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({
        name: 'mcp_core__toggle_client',
        arguments: { serverName: 'postgres', clientName: 'cursor', enable: false },
      });

      expect(toggleClientServerMock).toHaveBeenCalledWith('postgres', 'cursor', false);
      expect(result.isError).not.toBe(true);

      await client.close();
      await gateway.server.close();
    });
  });

  describe('mcp_core__get_daemon_status', () => {
    it('returns daemon status', async () => {
      getDaemonStatusMock.mockResolvedValue({
        running: true,
        pid: 42,
        uptimeMs: 12345,
        socketPath: '/tmp/daemon.sock',
      });

      const gateway = await makeGateway();
      const client = await connectMcpClient(gateway);

      const result = await client.callTool({ name: 'mcp_core__get_daemon_status', arguments: {} });
      expect(result.isError).not.toBe(true);

      const payload = JSON.parse((result.content as any[])[0].text);
      expect(payload.running).toBe(true);
      expect(payload.pid).toBe(42);

      await client.close();
      await gateway.server.close();
    });
  });
});

describe('gateway MCP server — tool forwarding', () => {
  it('forwards tool call to the correct backend client', async () => {
    const mockBackend: BackendClient = {
      sendRequest: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'stored' }],
      }),
      close: vi.fn(),
    };

    const backends: BackendInfo[] = [
      { name: 'memory', tools: [{ name: 'store', description: 'Store a value' }], resources: [], prompts: [] },
    ];

    const gateway = createGatewayServer({
      _metaClientFactory: async () => makeMockMetaClient(backends),
      _backendClientFactory: async (_sock, _name) => mockBackend,
    });
    await gateway.start();
    const client = await connectMcpClient(gateway);

    const result = await client.callTool({
      name: 'memory__store',
      arguments: { key: 'foo', value: 'bar' },
    });

    expect(result.isError).not.toBe(true);
    expect(mockBackend.sendRequest).toHaveBeenCalledWith('tools/call', {
      name: 'store',
      arguments: { key: 'foo', value: 'bar' },
    });

    await client.close();
    await gateway.server.close();
  });

  it('returns error for unknown tool', async () => {
    const gateway = await makeGateway();
    const client = await connectMcpClient(gateway);

    const result = await client.callTool({
      name: 'nonexistent__tool',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as any[])[0].text).toContain('Unknown tool');

    await client.close();
    await gateway.server.close();
  });

  it('sanitizes backend and tool names with double underscore prefix', async () => {
    const backends: BackendInfo[] = [
      { name: 'my-backend', tools: [{ name: 'my-tool' }], resources: [], prompts: [] },
    ];
    const gateway = await makeGateway(backends);
    const client = await connectMcpClient(gateway);

    const { tools } = await client.listTools();
    const backendTools = tools.filter((t) => !t.name.startsWith('mcp_core__'));
    expect(backendTools[0].name).toBe('my_backend__my_tool');

    await client.close();
    await gateway.server.close();
  });
});

describe('gateway MCP server — dynamic updates', () => {
  it('updates tool list and notifies client when backends_changed fires', async () => {
    let capturedMetaClient!: DaemonMetaClient;
    const initialBackends: BackendInfo[] = [];
    const updatedBackends: BackendInfo[] = [
      { name: 'fs', tools: [{ name: 'read_file' }], resources: [], prompts: [] },
    ];

    const gateway = createGatewayServer({
      _metaClientFactory: async () => {
        const meta = makeMockMetaClient(initialBackends);
        capturedMetaClient = meta;
        return meta;
      },
    });
    await gateway.start();
    const client = await connectMcpClient(gateway);

    // Initially no backend tools
    const before = await client.listTools();
    expect(before.tools.filter((t) => !t.name.startsWith('mcp_core__'))).toHaveLength(0);

    // Track if list_changed notification was received (via re-listing)
    let notificationReceived = false;
    // SDK client fires list changed event as a notification
    // We verify by re-listing after emitting the event
    capturedMetaClient.emit('backends_changed', updatedBackends);

    // Give async handlers time to run
    await new Promise((r) => setTimeout(r, 50));

    const after = await client.listTools();
    const backendTools = after.tools.filter((t) => !t.name.startsWith('mcp_core__'));
    expect(backendTools).toHaveLength(1);
    expect(backendTools[0].name).toBe('fs__read_file');

    await client.close();
    await gateway.server.close();
  });

  it('closes backend connection when backend is removed via backends_changed', async () => {
    let capturedMetaClient!: DaemonMetaClient;
    const mockBackend: BackendClient = {
      sendRequest: vi.fn(),
      close: vi.fn(),
    };

    const initialBackends: BackendInfo[] = [
      { name: 'memory', tools: [{ name: 'store' }], resources: [], prompts: [] },
    ];

    const gateway = createGatewayServer({
      _metaClientFactory: async () => {
        const meta = makeMockMetaClient(initialBackends);
        capturedMetaClient = meta;
        return meta;
      },
      _backendClientFactory: async () => mockBackend,
    });
    await gateway.start();
    const client = await connectMcpClient(gateway);

    // Trigger a tool call to open the backend connection
    await client.callTool({ name: 'memory__store', arguments: {} });
    expect(mockBackend.sendRequest).toHaveBeenCalled();

    // Emit backends_changed without 'memory' → connection should be closed
    capturedMetaClient.emit('backends_changed', []);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockBackend.close).toHaveBeenCalled();

    await client.close();
    await gateway.server.close();
  });
});

describe('gateway MCP server — resources and prompts', () => {
  it('lists resources with mcp-core:// prefix', async () => {
    const backends: BackendInfo[] = [
      {
        name: 'fs',
        tools: [],
        resources: [{ uri: 'file:///home/user/doc.md', name: 'doc' }],
        prompts: [],
      },
    ];
    const gateway = await makeGateway(backends);
    const client = await connectMcpClient(gateway);

    const { resources } = await client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('mcp-core://fs/file:///home/user/doc.md');

    await client.close();
    await gateway.server.close();
  });

  it('lists prompts with backend prefix', async () => {
    const backends: BackendInfo[] = [
      { name: 'prompts-backend', tools: [], resources: [], prompts: [{ name: 'summarize' }] },
    ];
    const gateway = await makeGateway(backends);
    const client = await connectMcpClient(gateway);

    const { prompts } = await client.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('prompts_backend__summarize');

    await client.close();
    await gateway.server.close();
  });
});
