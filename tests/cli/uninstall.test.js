"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { notifyDaemonMock } = vitest_1.vi.hoisted(() => ({
    notifyDaemonMock: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../../src/daemon/notify', () => ({
    notifyDaemon: notifyDaemonMock,
}));
const { removeServerMock } = vitest_1.vi.hoisted(() => ({
    removeServerMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/config/store', () => ({
    ConfigStore: {
        initialize: vitest_1.vi.fn(),
        get: vitest_1.vi.fn(() => ({
            servers: {
                memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
            },
        })),
        removeServer: removeServerMock,
    },
}));
vitest_1.vi.mock('fs', async () => {
    const actual = await vitest_1.vi.importActual('fs');
    return {
        ...actual,
        default: { ...actual, existsSync: vitest_1.vi.fn(() => false), rmSync: vitest_1.vi.fn(), unlinkSync: vitest_1.vi.fn() },
        existsSync: vitest_1.vi.fn(() => false),
        rmSync: vitest_1.vi.fn(),
        unlinkSync: vitest_1.vi.fn(),
    };
});
vitest_1.vi.mock('../../src/config/paths', () => ({
    SERVERS_DIR: '/tmp/mcp-core-servers',
    LOGS_DIR: '/tmp/mcp-core-logs',
    CORE_DIR: '/tmp/mcp-core',
    DAEMON_SOCKET: '/tmp/mcp-core/daemon.sock',
}));
const { removeServerFromClientsMock } = vitest_1.vi.hoisted(() => ({
    removeServerFromClientsMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/cli/injectors/index', () => ({
    addServerToClients: vitest_1.vi.fn(),
    removeServerFromClients: removeServerFromClientsMock,
}));
const uninstall_1 = require("../../src/cli/commands/uninstall");
(0, vitest_1.describe)('runUninstall', () => {
    (0, vitest_1.beforeEach)(() => {
        notifyDaemonMock.mockClear();
        removeServerMock.mockClear();
    });
    (0, vitest_1.it)('removes the server from ConfigStore', async () => {
        await (0, uninstall_1.runUninstall)('memory');
        (0, vitest_1.expect)(removeServerMock).toHaveBeenCalledWith('memory');
    });
    (0, vitest_1.it)('throws when the server is not registered', async () => {
        const { ConfigStore } = await import('../../src/config/store');
        vitest_1.vi.mocked(ConfigStore.get).mockReturnValueOnce({ servers: {}, version: '1.0.0' });
        await (0, vitest_1.expect)((0, uninstall_1.runUninstall)('ghost')).rejects.toThrow(/no está registrado/);
    });
    (0, vitest_1.it)('notifies the daemon with backend_unregistered', async () => {
        await (0, uninstall_1.runUninstall)('memory');
        (0, vitest_1.expect)(notifyDaemonMock).toHaveBeenCalledOnce();
        const [msg] = notifyDaemonMock.mock.calls[0];
        (0, vitest_1.expect)(msg.type).toBe('backend_unregistered');
        (0, vitest_1.expect)(msg.name).toBe('memory');
    });
    (0, vitest_1.it)('does NOT call removeServerFromClients (injection removed in gateway arch)', async () => {
        await (0, uninstall_1.runUninstall)('memory');
        (0, vitest_1.expect)(removeServerFromClientsMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('completes successfully even if daemon is not running', async () => {
        notifyDaemonMock.mockResolvedValueOnce(undefined);
        await (0, vitest_1.expect)((0, uninstall_1.runUninstall)('memory')).resolves.toBeUndefined();
    });
});
//# sourceMappingURL=uninstall.test.js.map