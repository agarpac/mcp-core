"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const path_1 = __importDefault(require("path"));
const { execaMock } = vitest_1.vi.hoisted(() => ({
    execaMock: vitest_1.vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}));
vitest_1.vi.mock('execa', () => ({ execa: execaMock }));
vitest_1.vi.mock('fs', async () => {
    const actual = await vitest_1.vi.importActual('fs');
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vitest_1.vi.fn(() => false),
            mkdirSync: vitest_1.vi.fn(),
            writeFileSync: vitest_1.vi.fn(),
            readFileSync: vitest_1.vi.fn(() => '{}'),
        },
        existsSync: vitest_1.vi.fn(() => false),
        mkdirSync: vitest_1.vi.fn(),
        writeFileSync: vitest_1.vi.fn(),
        readFileSync: vitest_1.vi.fn(() => '{}'),
    };
});
const { addServerMock, notifyDaemonMock } = vitest_1.vi.hoisted(() => ({
    addServerMock: vitest_1.vi.fn(),
    notifyDaemonMock: vitest_1.vi.fn().mockResolvedValue(undefined),
}));
vitest_1.vi.mock('../../src/config/store', () => ({
    ConfigStore: {
        initialize: vitest_1.vi.fn(),
        addServer: addServerMock,
        get: vitest_1.vi.fn(() => ({ servers: {} })),
        removeServer: vitest_1.vi.fn(),
    },
}));
vitest_1.vi.mock('../../src/daemon/notify', () => ({
    notifyDaemon: notifyDaemonMock,
}));
const { addServerToClientsMock } = vitest_1.vi.hoisted(() => ({
    addServerToClientsMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/cli/injectors/index', () => ({
    addServerToClients: addServerToClientsMock,
    removeServerFromClients: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/config/paths', () => ({
    SERVERS_DIR: '/tmp/mcp-core-servers',
    LOGS_DIR: '/tmp/mcp-core-logs',
}));
const { validateMock } = vitest_1.vi.hoisted(() => ({ validateMock: vitest_1.vi.fn() }));
vitest_1.vi.mock('../../src/validate/handshake', () => ({
    validateMcpServer: validateMock,
}));
const install_1 = require("../../src/cli/commands/install");
const progress_singleton_1 = require("../../src/utils/progress-singleton");
(0, vitest_1.describe)('runInstall — command injection hardening', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        addServerMock.mockClear();
        notifyDaemonMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        validateMock.mockResolvedValue({ success: true, tools: 2, latencyMs: 42 });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('does NOT expand shell metacharacters from a malicious git URL', async () => {
        const malicious = 'https://evil.example/repo.git; echo PWNED';
        await (0, install_1.runInstall)(malicious, 'evil-server');
        const gitCall = execaMock.mock.calls.find((c) => c[0] === 'git');
        (0, vitest_1.expect)(gitCall).toBeDefined();
        const [, args] = gitCall;
        (0, vitest_1.expect)(args).toContain(malicious);
        (0, vitest_1.expect)(args).not.toContain('echo');
        (0, vitest_1.expect)(args).not.toContain('PWNED');
    });
    (0, vitest_1.it)('invokes npm install with args as an array (no shell string)', async () => {
        await (0, install_1.runInstall)('https://example.com/repo.git', 'my-server');
        const npmInstall = execaMock.mock.calls.find((c) => c[0] === 'npm' && Array.isArray(c[1]) && c[1][0] === 'install');
        (0, vitest_1.expect)(npmInstall).toBeDefined();
        const [, args] = npmInstall;
        (0, vitest_1.expect)(args).toEqual(['install']);
    });
    (0, vitest_1.it)('invokes git clone with source and target as separate argv entries', async () => {
        const source = 'https://example.com/clean.git';
        await (0, install_1.runInstall)(source, 'clean-server');
        const gitCall = execaMock.mock.calls.find((c) => c[0] === 'git');
        const [, args] = gitCall;
        (0, vitest_1.expect)(args[0]).toBe('clone');
        (0, vitest_1.expect)(args).toContain(source);
        (0, vitest_1.expect)(args).toContain(path_1.default.join('/tmp/mcp-core-servers', 'clean-server'));
    });
    (0, vitest_1.it)('tolerates npm run build failing (optional step)', async () => {
        execaMock.mockImplementation(async (cmd, args) => {
            if (cmd === 'npm' && args[0] === 'run' && args[1] === 'build') {
                throw new Error('no build script');
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        });
        await (0, vitest_1.expect)((0, install_1.runInstall)('https://example.com/repo.git', 'build-fails')).resolves.toBeDefined();
    });
});
(0, vitest_1.describe)('runInstall — env vars', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        addServerMock.mockClear();
        notifyDaemonMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('persists env vars in ConfigStore.addServer', async () => {
        await (0, install_1.runInstall)('some-npm-pkg', 'pkg', { API_KEY: 'secret', DB_URL: 'x' });
        (0, vitest_1.expect)(addServerMock).toHaveBeenCalled();
        const call = addServerMock.mock.calls[0];
        const cfg = call[1];
        (0, vitest_1.expect)(cfg.env).toEqual({ API_KEY: 'secret', DB_URL: 'x' });
    });
});
(0, vitest_1.describe)('runInstall — method selection (npm / uvx / git / auto)', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        addServerMock.mockClear();
        notifyDaemonMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('uses uvx when method is explicitly uvx', async () => {
        await (0, install_1.runInstall)('some-python-mcp', 'py', undefined, { method: 'uvx' });
        (0, vitest_1.expect)(addServerMock).toHaveBeenCalled();
        const [, cfg] = addServerMock.mock.calls[0];
        (0, vitest_1.expect)(cfg.command).toBe('uvx');
        (0, vitest_1.expect)(cfg.args).toEqual(['-y', 'some-python-mcp']);
    });
    (0, vitest_1.it)('auto-detects uvx when source starts with mcp-server-', async () => {
        await (0, install_1.runInstall)('mcp-server-postgres', undefined, undefined, { method: 'auto' });
        const [, cfg] = addServerMock.mock.calls[0];
        (0, vitest_1.expect)(cfg.command).toBe('uvx');
    });
    (0, vitest_1.it)('uses npm when method is npm', async () => {
        await (0, install_1.runInstall)('@modelcontextprotocol/server-memory', 'memory', undefined, { method: 'npm' });
        const [, cfg] = addServerMock.mock.calls[0];
        (0, vitest_1.expect)(cfg.command).toBe('npx');
        (0, vitest_1.expect)(cfg.args).toContain('@modelcontextprotocol/server-memory');
    });
});
(0, vitest_1.describe)('runInstall — daemon notification (no per-client injection)', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        addServerMock.mockClear();
        notifyDaemonMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        validateMock.mockResolvedValue({
            success: true,
            tools: 1,
            latencyMs: 10,
            toolDefinitions: [{ name: 'search', description: 'Search the web' }],
        });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('notifies daemon with backend_registered after install', async () => {
        await (0, install_1.runInstall)('pkg', 'pkg');
        (0, vitest_1.expect)(notifyDaemonMock).toHaveBeenCalledOnce();
        const [msg] = notifyDaemonMock.mock.calls[0];
        (0, vitest_1.expect)(msg.type).toBe('backend_registered');
        (0, vitest_1.expect)(msg.name).toBe('pkg');
        (0, vitest_1.expect)(msg.capabilities.tools).toHaveLength(1);
        (0, vitest_1.expect)(msg.capabilities.tools[0].name).toBe('search');
    });
    (0, vitest_1.it)('sends empty tools in notification when validation is skipped', async () => {
        await (0, install_1.runInstall)('pkg', 'pkg', undefined, { validate: false });
        const [msg] = notifyDaemonMock.mock.calls[0];
        (0, vitest_1.expect)(msg.type).toBe('backend_registered');
        (0, vitest_1.expect)(msg.capabilities.tools).toEqual([]);
    });
    (0, vitest_1.it)('does NOT call the client injectors (injection removed in gateway arch)', async () => {
        await (0, install_1.runInstall)('pkg', 'pkg', undefined, { clients: ['cursor', 'claudeCode'] });
        (0, vitest_1.expect)(addServerToClientsMock).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('runInstall — validation', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('calls validateMcpServer by default after injection', async () => {
        validateMock.mockResolvedValue({ success: true, tools: 7, latencyMs: 120 });
        await (0, install_1.runInstall)('pkg', 'pkg');
        (0, vitest_1.expect)(validateMock).toHaveBeenCalled();
    });
    (0, vitest_1.it)('skips validation when validate=false', async () => {
        await (0, install_1.runInstall)('pkg', 'pkg', undefined, { validate: false });
        (0, vitest_1.expect)(validateMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('returns the validation result alongside the server name', async () => {
        validateMock.mockResolvedValue({ success: true, tools: 3, latencyMs: 80, toolNames: ['a', 'b', 'c'] });
        const res = await (0, install_1.runInstall)('pkg', 'pkg');
        // Backwards-compatible: still a string OR an object with .name. Allow either.
        if (typeof res === 'string') {
            (0, vitest_1.expect)(res).toBe('pkg');
        }
        else {
            (0, vitest_1.expect)(res.name).toBe('pkg');
            (0, vitest_1.expect)(res.validation?.tools).toBe(3);
        }
    });
});
(0, vitest_1.describe)('runInstall — progress events', () => {
    (0, vitest_1.beforeEach)(() => {
        execaMock.mockClear();
        notifyDaemonMock.mockClear();
        validateMock.mockClear();
        execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
        validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
        (0, progress_singleton_1.resetProgressBus)();
    });
    (0, vitest_1.it)('emits resolve, register, validate and done phases (no inject-clients)', async () => {
        const bus = (0, progress_singleton_1.getProgressBus)();
        const phases = [];
        bus.on((e) => phases.push(e.phase));
        await (0, install_1.runInstall)('pkg', 'pkg');
        (0, vitest_1.expect)(phases).toContain('resolve');
        (0, vitest_1.expect)(phases).toContain('register');
        (0, vitest_1.expect)(phases).not.toContain('inject-clients');
        (0, vitest_1.expect)(phases).toContain('validate');
        (0, vitest_1.expect)(phases).toContain('done');
    });
    (0, vitest_1.it)('emits error phase and rethrows on failure', async () => {
        execaMock.mockRejectedValueOnce(new Error('git clone failed'));
        const bus = (0, progress_singleton_1.getProgressBus)();
        const phases = [];
        bus.on((e) => phases.push(e.phase));
        await (0, vitest_1.expect)((0, install_1.runInstall)('https://x.git', 'fail')).rejects.toThrow(/git clone failed/);
        (0, vitest_1.expect)(phases).toContain('error');
    });
});
//# sourceMappingURL=install.test.js.map