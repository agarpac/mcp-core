"use strict";
/**
 * Tests for the gateway MCP server.
 *
 * Strategy:
 *   - Inject a mock DaemonMetaClient (no real socket, no subprocess).
 *   - Use `InMemoryTransport.createLinkedPair()` for client ↔ server transport.
 *   - Mock the underlying CLI commands for the mcp_core__ control tools.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const events_1 = require("events");
// --- Mocks ------------------------------------------------------------------
const { runInstallMock, runUninstallMock, toggleClientServerMock, getDaemonStatusMock, configGetMock } = vitest_1.vi.hoisted(() => ({
    runInstallMock: vitest_1.vi.fn(),
    runUninstallMock: vitest_1.vi.fn(),
    toggleClientServerMock: vitest_1.vi.fn(),
    getDaemonStatusMock: vitest_1.vi.fn(),
    configGetMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/cli/commands/install', () => ({ runInstall: runInstallMock }));
vitest_1.vi.mock('../../src/cli/commands/uninstall', () => ({ runUninstall: runUninstallMock }));
vitest_1.vi.mock('../../src/cli/injectors/index', () => ({
    toggleClientServer: toggleClientServerMock,
    addServerToClients: vitest_1.vi.fn(),
    removeServerFromClients: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/cli/commands/status', () => ({ getDaemonStatus: getDaemonStatusMock }));
vitest_1.vi.mock('../../src/config/store', () => ({
    ConfigStore: {
        initialize: vitest_1.vi.fn(),
        get: configGetMock,
        addServer: vitest_1.vi.fn(),
        removeServer: vitest_1.vi.fn(),
    },
}));
const server_1 = require("../../src/mcp/server");
// --- Helpers ----------------------------------------------------------------
function makeMockMetaClient(backends = []) {
    const ee = new events_1.EventEmitter();
    ee.listBackends = async () => backends;
    ee.close = () => { };
    return ee;
}
async function makeGateway(backends = []) {
    const gateway = (0, server_1.createGatewayServer)({
        _metaClientFactory: async () => makeMockMetaClient(backends),
    });
    await gateway.start();
    return gateway;
}
async function connectMcpClient(gateway) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([gateway.server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
}
// --- Tests ------------------------------------------------------------------
(0, vitest_1.describe)('gateway MCP server — control tools', () => {
    (0, vitest_1.beforeEach)(() => {
        runInstallMock.mockReset();
        runUninstallMock.mockReset();
        toggleClientServerMock.mockReset();
        getDaemonStatusMock.mockReset();
        configGetMock.mockReset();
    });
    (0, vitest_1.describe)('tool registration', () => {
        (0, vitest_1.it)('exposes exactly the 5 mcp_core__ control tools when no backends are registered', async () => {
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const { tools } = await client.listTools();
            const names = tools.map((t) => t.name).sort();
            (0, vitest_1.expect)(names).toEqual([...server_1.GATEWAY_CONTROL_TOOLS].sort());
            await client.close();
            await gateway.server.close();
        });
        (0, vitest_1.it)('each control tool has a non-empty description and object inputSchema', async () => {
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const { tools } = await client.listTools();
            const controlTools = tools.filter((t) => t.name.startsWith('mcp_core__'));
            for (const tool of controlTools) {
                (0, vitest_1.expect)(tool.description, `${tool.name} missing description`).toBeTruthy();
                (0, vitest_1.expect)(tool.inputSchema.type).toBe('object');
            }
            await client.close();
            await gateway.server.close();
        });
        (0, vitest_1.it)('includes backend tools with prefix alongside control tools', async () => {
            const backends = [
                { name: 'memory', tools: [{ name: 'store' }, { name: 'retrieve' }], resources: [], prompts: [] },
            ];
            const gateway = await makeGateway(backends);
            const client = await connectMcpClient(gateway);
            const { tools } = await client.listTools();
            const names = tools.map((t) => t.name);
            (0, vitest_1.expect)(names).toContain('memory__store');
            (0, vitest_1.expect)(names).toContain('memory__retrieve');
            (0, vitest_1.expect)(names).toContain('mcp_core__install_server');
            (0, vitest_1.expect)(names).toHaveLength(2 + server_1.GATEWAY_CONTROL_TOOLS.length);
            await client.close();
            await gateway.server.close();
        });
    });
    (0, vitest_1.describe)('mcp_core__list_servers', () => {
        (0, vitest_1.it)('returns server map from ConfigStore as array', async () => {
            configGetMock.mockReturnValue({
                version: '1.0.0',
                servers: {
                    postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], clientsLinked: ['cursor'] },
                },
            });
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({ name: 'mcp_core__list_servers', arguments: {} });
            (0, vitest_1.expect)(result.isError).not.toBe(true);
            const parsed = JSON.parse(result.content[0].text);
            (0, vitest_1.expect)(parsed).toHaveLength(1);
            (0, vitest_1.expect)(parsed[0].name).toBe('postgres');
            await client.close();
            await gateway.server.close();
        });
    });
    (0, vitest_1.describe)('mcp_core__install_server', () => {
        (0, vitest_1.it)('delegates to runInstall and returns success', async () => {
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
            (0, vitest_1.expect)(runInstallMock).toHaveBeenCalledTimes(1);
            const [source, name, env] = runInstallMock.mock.calls[0];
            (0, vitest_1.expect)(source).toBe('@modelcontextprotocol/server-postgres');
            (0, vitest_1.expect)(name).toBe('postgres');
            (0, vitest_1.expect)(env).toEqual({ DATABASE_URL: 'postgres://localhost' });
            (0, vitest_1.expect)(result.isError).not.toBe(true);
            const payload = JSON.parse(result.content[0].text);
            (0, vitest_1.expect)(payload.success).toBe(true);
            (0, vitest_1.expect)(payload.name).toBe('postgres');
            await client.close();
            await gateway.server.close();
        });
        (0, vitest_1.it)('returns isError=true when runInstall throws', async () => {
            runInstallMock.mockRejectedValue(new Error('clone failed'));
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({
                name: 'mcp_core__install_server',
                arguments: { source: 'https://github.com/foo/bar.git' },
            });
            (0, vitest_1.expect)(result.isError).toBe(true);
            (0, vitest_1.expect)(result.content[0].text).toContain('clone failed');
            await client.close();
            await gateway.server.close();
        });
    });
    (0, vitest_1.describe)('mcp_core__uninstall_server', () => {
        (0, vitest_1.it)('delegates to runUninstall', async () => {
            runUninstallMock.mockReturnValue(undefined);
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({
                name: 'mcp_core__uninstall_server',
                arguments: { name: 'postgres' },
            });
            (0, vitest_1.expect)(runUninstallMock).toHaveBeenCalledWith('postgres');
            (0, vitest_1.expect)(result.isError).not.toBe(true);
            const payload = JSON.parse(result.content[0].text);
            (0, vitest_1.expect)(payload.success).toBe(true);
            await client.close();
            await gateway.server.close();
        });
        (0, vitest_1.it)('returns isError=true when runUninstall throws', async () => {
            runUninstallMock.mockImplementation(() => {
                throw new Error("El servidor 'ghost' no está registrado.");
            });
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({
                name: 'mcp_core__uninstall_server',
                arguments: { name: 'ghost' },
            });
            (0, vitest_1.expect)(result.isError).toBe(true);
            (0, vitest_1.expect)(result.content[0].text).toContain('no está registrado');
            await client.close();
            await gateway.server.close();
        });
    });
    (0, vitest_1.describe)('mcp_core__toggle_client', () => {
        (0, vitest_1.it)('delegates to toggleClientServer', async () => {
            toggleClientServerMock.mockReturnValue(undefined);
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({
                name: 'mcp_core__toggle_client',
                arguments: { serverName: 'postgres', clientName: 'cursor', enable: false },
            });
            (0, vitest_1.expect)(toggleClientServerMock).toHaveBeenCalledWith('postgres', 'cursor', false);
            (0, vitest_1.expect)(result.isError).not.toBe(true);
            await client.close();
            await gateway.server.close();
        });
    });
    (0, vitest_1.describe)('mcp_core__get_daemon_status', () => {
        (0, vitest_1.it)('returns daemon status', async () => {
            getDaemonStatusMock.mockResolvedValue({
                running: true,
                pid: 42,
                uptimeMs: 12345,
                socketPath: '/tmp/daemon.sock',
            });
            const gateway = await makeGateway();
            const client = await connectMcpClient(gateway);
            const result = await client.callTool({ name: 'mcp_core__get_daemon_status', arguments: {} });
            (0, vitest_1.expect)(result.isError).not.toBe(true);
            const payload = JSON.parse(result.content[0].text);
            (0, vitest_1.expect)(payload.running).toBe(true);
            (0, vitest_1.expect)(payload.pid).toBe(42);
            await client.close();
            await gateway.server.close();
        });
    });
});
(0, vitest_1.describe)('gateway MCP server — tool forwarding', () => {
    (0, vitest_1.it)('forwards tool call to the correct backend client', async () => {
        const mockBackend = {
            sendRequest: vitest_1.vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'stored' }],
            }),
            close: vitest_1.vi.fn(),
        };
        const backends = [
            { name: 'memory', tools: [{ name: 'store', description: 'Store a value' }], resources: [], prompts: [] },
        ];
        const gateway = (0, server_1.createGatewayServer)({
            _metaClientFactory: async () => makeMockMetaClient(backends),
            _backendClientFactory: async (_sock, _name) => mockBackend,
        });
        await gateway.start();
        const client = await connectMcpClient(gateway);
        const result = await client.callTool({
            name: 'memory__store',
            arguments: { key: 'foo', value: 'bar' },
        });
        (0, vitest_1.expect)(result.isError).not.toBe(true);
        (0, vitest_1.expect)(mockBackend.sendRequest).toHaveBeenCalledWith('tools/call', {
            name: 'store',
            arguments: { key: 'foo', value: 'bar' },
        });
        await client.close();
        await gateway.server.close();
    });
    (0, vitest_1.it)('returns error for unknown tool', async () => {
        const gateway = await makeGateway();
        const client = await connectMcpClient(gateway);
        const result = await client.callTool({
            name: 'nonexistent__tool',
            arguments: {},
        });
        (0, vitest_1.expect)(result.isError).toBe(true);
        (0, vitest_1.expect)(result.content[0].text).toContain('Unknown tool');
        await client.close();
        await gateway.server.close();
    });
    (0, vitest_1.it)('sanitizes backend and tool names with double underscore prefix', async () => {
        const backends = [
            { name: 'my-backend', tools: [{ name: 'my-tool' }], resources: [], prompts: [] },
        ];
        const gateway = await makeGateway(backends);
        const client = await connectMcpClient(gateway);
        const { tools } = await client.listTools();
        const backendTools = tools.filter((t) => !t.name.startsWith('mcp_core__'));
        (0, vitest_1.expect)(backendTools[0].name).toBe('my_backend__my_tool');
        await client.close();
        await gateway.server.close();
    });
});
(0, vitest_1.describe)('gateway MCP server — dynamic updates', () => {
    (0, vitest_1.it)('updates tool list and notifies client when backends_changed fires', async () => {
        let capturedMetaClient;
        const initialBackends = [];
        const updatedBackends = [
            { name: 'fs', tools: [{ name: 'read_file' }], resources: [], prompts: [] },
        ];
        const gateway = (0, server_1.createGatewayServer)({
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
        (0, vitest_1.expect)(before.tools.filter((t) => !t.name.startsWith('mcp_core__'))).toHaveLength(0);
        // Track if list_changed notification was received (via re-listing)
        let notificationReceived = false;
        // SDK client fires list changed event as a notification
        // We verify by re-listing after emitting the event
        capturedMetaClient.emit('backends_changed', updatedBackends);
        // Give async handlers time to run
        await new Promise((r) => setTimeout(r, 50));
        const after = await client.listTools();
        const backendTools = after.tools.filter((t) => !t.name.startsWith('mcp_core__'));
        (0, vitest_1.expect)(backendTools).toHaveLength(1);
        (0, vitest_1.expect)(backendTools[0].name).toBe('fs__read_file');
        await client.close();
        await gateway.server.close();
    });
    (0, vitest_1.it)('closes backend connection when backend is removed via backends_changed', async () => {
        let capturedMetaClient;
        const mockBackend = {
            sendRequest: vitest_1.vi.fn(),
            close: vitest_1.vi.fn(),
        };
        const initialBackends = [
            { name: 'memory', tools: [{ name: 'store' }], resources: [], prompts: [] },
        ];
        const gateway = (0, server_1.createGatewayServer)({
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
        (0, vitest_1.expect)(mockBackend.sendRequest).toHaveBeenCalled();
        // Emit backends_changed without 'memory' → connection should be closed
        capturedMetaClient.emit('backends_changed', []);
        await new Promise((r) => setTimeout(r, 20));
        (0, vitest_1.expect)(mockBackend.close).toHaveBeenCalled();
        await client.close();
        await gateway.server.close();
    });
});
(0, vitest_1.describe)('gateway MCP server — resources and prompts', () => {
    (0, vitest_1.it)('lists resources with mcp-core:// prefix', async () => {
        const backends = [
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
        (0, vitest_1.expect)(resources).toHaveLength(1);
        (0, vitest_1.expect)(resources[0].uri).toBe('mcp-core://fs/file:///home/user/doc.md');
        await client.close();
        await gateway.server.close();
    });
    (0, vitest_1.it)('lists prompts with backend prefix', async () => {
        const backends = [
            { name: 'prompts-backend', tools: [], resources: [], prompts: [{ name: 'summarize' }] },
        ];
        const gateway = await makeGateway(backends);
        const client = await connectMcpClient(gateway);
        const { prompts } = await client.listPrompts();
        (0, vitest_1.expect)(prompts).toHaveLength(1);
        (0, vitest_1.expect)(prompts[0].name).toBe('prompts_backend__summarize');
        await client.close();
        await gateway.server.close();
    });
});
//# sourceMappingURL=server.test.js.map