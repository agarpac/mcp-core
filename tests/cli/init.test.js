"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// ── os.platform() → always 'darwin' ──────────────────────────────────────────
vitest_1.vi.mock('os', async () => {
    const actual = await vitest_1.vi.importActual('os');
    return { ...actual, default: { ...actual, platform: () => 'darwin', homedir: actual.homedir } };
});
// ── fs mocks ──────────────────────────────────────────────────────────────────
const fsMocks = vitest_1.vi.hoisted(() => ({
    existsSync: vitest_1.vi.fn(() => true),
    readFileSync: vitest_1.vi.fn(() => '{}'),
    writeFileSync: vitest_1.vi.fn(),
    copyFileSync: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('fs', async () => {
    const actual = await vitest_1.vi.importActual('fs');
    return {
        ...actual,
        default: { ...actual, ...fsMocks },
        ...fsMocks,
    };
});
// ── ConfigStore mock ──────────────────────────────────────────────────────────
const storeMocks = vitest_1.vi.hoisted(() => ({
    initialize: vitest_1.vi.fn(),
    get: vitest_1.vi.fn(() => ({ servers: {}, version: '1.0.0' })),
    addServer: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../src/config/store', () => ({
    ConfigStore: storeMocks,
}));
// ── CLIENT_ADAPTERS mock ──────────────────────────────────────────────────────
// Provides a single 'cursor' adapter pointing to a fixed test path.
const CURSOR_PATH = '/tmp/test-cursor-mcp.json';
vitest_1.vi.mock('../../src/config/paths', () => ({
    CLIENT_ADAPTERS: {
        cursor: {
            id: 'cursor',
            displayName: 'Cursor',
            configPath: { darwin: '/tmp/test-cursor-mcp.json', linux: '/tmp/test-cursor-mcp.json' },
            rootKey: 'mcpServers',
            serialize: ({ command, args }) => ({ command, args }),
            readServers: (config) => {
                if (!config || typeof config !== 'object')
                    return {};
                const value = config['mcpServers'];
                if (!value || typeof value !== 'object')
                    return {};
                return value;
            },
            writeServer: (config, name, record) => {
                const base = config && typeof config === 'object' ? { ...config } : {};
                const inner = { ...(base['mcpServers'] || {}) };
                inner[name] = record;
                base['mcpServers'] = inner;
                return base;
            },
            removeServer: (config, name) => {
                const base = config && typeof config === 'object' ? { ...config } : {};
                const existing = base['mcpServers'];
                if (existing && typeof existing === 'object') {
                    const inner = { ...existing };
                    delete inner[name];
                    base['mcpServers'] = inner;
                }
                return base;
            },
        },
    },
    getClientConfigPath: vitest_1.vi.fn(() => '/tmp/test-cursor-mcp.json'),
}));
const init_1 = require("../../src/cli/commands/init");
// ── helpers ───────────────────────────────────────────────────────────────────
function makeCursorConfig(servers) {
    return JSON.stringify({ mcpServers: servers });
}
// ── tests ─────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('runInit — fresh install (no prior entries)', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        fsMocks.readFileSync.mockReturnValue('{}');
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    });
    (0, vitest_1.it)('returns status=done when config is empty', () => {
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.status).toBe('done');
    });
    (0, vitest_1.it)('writes only the gateway entry to the config file', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(fsMocks.writeFileSync).toHaveBeenCalledOnce();
        const written = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1]);
        (0, vitest_1.expect)(Object.keys(written.mcpServers)).toEqual(['mcp-core']);
        (0, vitest_1.expect)(written.mcpServers['mcp-core'].command).toBe('mcp-core-mcp');
    });
    (0, vitest_1.it)('creates a backup before writing', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(fsMocks.copyFileSync).toHaveBeenCalledWith(CURSOR_PATH, `${CURSOR_PATH}.backup`);
    });
    (0, vitest_1.it)('returns empty migratedServers when config has no entries', () => {
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.migratedServers).toEqual([]);
    });
});
(0, vitest_1.describe)('runInit — legacy server migration', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
        fsMocks.readFileSync.mockReturnValue(makeCursorConfig({
            memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
            postgres: { command: 'uvx', args: ['mcp-server-postgres'] },
        }));
    });
    (0, vitest_1.it)('migrates legacy servers to ConfigStore', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(storeMocks.addServer).toHaveBeenCalledWith('memory', vitest_1.expect.objectContaining({ command: 'npx' }));
        (0, vitest_1.expect)(storeMocks.addServer).toHaveBeenCalledWith('postgres', vitest_1.expect.objectContaining({ command: 'uvx' }));
    });
    (0, vitest_1.it)('returns migratedServers list', () => {
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.migratedServers).toContain('memory');
        (0, vitest_1.expect)(r.migratedServers).toContain('postgres');
    });
    (0, vitest_1.it)('removes all legacy entries from the client config', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const written = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1]);
        (0, vitest_1.expect)(written.mcpServers).not.toHaveProperty('memory');
        (0, vitest_1.expect)(written.mcpServers).not.toHaveProperty('postgres');
        (0, vitest_1.expect)(written.mcpServers).toHaveProperty('mcp-core');
    });
    (0, vitest_1.it)('does NOT migrate servers already in ConfigStore', () => {
        storeMocks.get.mockReturnValue({
            servers: { memory: { command: 'npx', args: [] } },
            version: '1.0.0',
        });
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(storeMocks.addServer).not.toHaveBeenCalledWith('memory', vitest_1.expect.anything());
    });
});
(0, vitest_1.describe)('runInit — legacy proxy entries are skipped', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    });
    (0, vitest_1.it)('skips mcp-proxy entries (already migrated previously)', () => {
        fsMocks.readFileSync.mockReturnValue(makeCursorConfig({
            memory: { command: 'mcp-proxy', args: ['memory'] },
        }));
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(storeMocks.addServer).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('skips mcp-core-mcp gateway binary entries', () => {
        fsMocks.readFileSync.mockReturnValue(makeCursorConfig({
            gateway: { command: 'mcp-core-mcp', args: [] },
        }));
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(storeMocks.addServer).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('runInit — already up-to-date', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
        fsMocks.readFileSync.mockReturnValue(makeCursorConfig({ 'mcp-core': { command: 'mcp-core-mcp', args: [] } }));
    });
    (0, vitest_1.it)('returns status=already-up-to-date when only gateway entry exists', () => {
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.status).toBe('already-up-to-date');
    });
    (0, vitest_1.it)('does NOT write or backup the file when already up-to-date', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(fsMocks.writeFileSync).not.toHaveBeenCalled();
        (0, vitest_1.expect)(fsMocks.copyFileSync).not.toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('runInit — skipped (no config file)', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(false);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    });
    (0, vitest_1.it)('returns status=skipped-no-config when config file is absent', () => {
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.status).toBe('skipped-no-config');
    });
});
(0, vitest_1.describe)('runInit — error handling', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    });
    (0, vitest_1.it)('returns status=error when config file cannot be read', () => {
        fsMocks.readFileSync.mockImplementation(() => {
            throw new Error('EACCES: permission denied');
        });
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.status).toBe('error');
        (0, vitest_1.expect)(r.error).toMatch(/EACCES/);
    });
    (0, vitest_1.it)('returns status=error for unknown client id', () => {
        const results = (0, init_1.runInit)({ clients: ['nonexistent'], selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(results[0].status).toBe('error');
        (0, vitest_1.expect)(results[0].error).toMatch(/Unknown client/);
    });
    (0, vitest_1.it)('returns status=error when writeFileSync fails', () => {
        fsMocks.readFileSync.mockReturnValue('{}');
        fsMocks.writeFileSync.mockImplementation(() => {
            throw new Error('ENOSPC: no space left on device');
        });
        const results = (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        const r = results.find((x) => x.client === 'cursor');
        (0, vitest_1.expect)(r.status).toBe('error');
        (0, vitest_1.expect)(r.error).toMatch(/ENOSPC/);
    });
});
(0, vitest_1.describe)('runInit — client filtering', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        fsMocks.readFileSync.mockReturnValue('{}');
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    });
    (0, vitest_1.it)('processes only specified clients when clients option is provided', () => {
        const results = (0, init_1.runInit)({ clients: ['cursor'], selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(results).toHaveLength(1);
        (0, vitest_1.expect)(results[0].client).toBe('cursor');
    });
});
(0, vitest_1.describe)('runInit — env vars preserved during migration', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        fsMocks.existsSync.mockReturnValue(true);
        storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
        fsMocks.readFileSync.mockReturnValue(makeCursorConfig({
            github: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
                env: { GITHUB_TOKEN: 'ghp_test' },
            },
        }));
    });
    (0, vitest_1.it)('preserves env vars when migrating to ConfigStore', () => {
        (0, init_1.runInit)({ selfBinary: 'mcp-core-mcp' });
        (0, vitest_1.expect)(storeMocks.addServer).toHaveBeenCalledWith('github', vitest_1.expect.objectContaining({ env: { GITHUB_TOKEN: 'ghp_test' } }));
    });
});
//# sourceMappingURL=init.test.js.map