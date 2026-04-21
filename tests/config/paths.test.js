"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("../../src/config/paths");
(0, vitest_1.describe)('paths.ts', () => {
    const originalPlatform = process.platform;
    (0, vitest_1.afterEach)(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
    (0, vitest_1.describe)('Constants', () => {
        (0, vitest_1.it)('CORE_DIR is in homedir', () => {
            (0, vitest_1.expect)(paths_1.CORE_DIR).toContain('.mcp-core');
        });
        (0, vitest_1.it)('other dirs derive from CORE_DIR', () => {
            (0, vitest_1.expect)(paths_1.CORE_CONFIG_FILE).toBe(path_1.default.join(paths_1.CORE_DIR, 'config.json'));
            (0, vitest_1.expect)(paths_1.SERVERS_DIR).toBe(path_1.default.join(paths_1.CORE_DIR, 'servers'));
            (0, vitest_1.expect)(paths_1.LOGS_DIR).toBe(path_1.default.join(paths_1.CORE_DIR, 'logs'));
            (0, vitest_1.expect)(paths_1.DAEMON_SOCKET).toBe(path_1.default.join(paths_1.CORE_DIR, 'daemon.sock'));
        });
    });
    (0, vitest_1.describe)('CLIENT_ADAPTERS registry', () => {
        (0, vitest_1.it)('exposes cursor, vscode, opencode, claudeDesktop, claudeCode adapters', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor).toBeDefined();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.vscode).toBeDefined();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.opencode).toBeDefined();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeDesktop).toBeDefined();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeCode).toBeDefined();
        });
        (0, vitest_1.it)('no longer exposes chatgpt', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.chatgpt).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('cursor adapter', () => {
        (0, vitest_1.it)('uses ~/.cursor/mcp.json on darwin and linux', () => {
            const home = os_1.default.homedir();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.configPath.darwin).toBe(path_1.default.join(home, '.cursor', 'mcp.json'));
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.configPath.linux).toBe(path_1.default.join(home, '.cursor', 'mcp.json'));
        });
        (0, vitest_1.it)('rootKey is mcpServers', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.rootKey).toBe('mcpServers');
        });
        (0, vitest_1.it)('serialize returns { command, args } string-based shape', () => {
            const out = paths_1.CLIENT_ADAPTERS.cursor.serialize({ name: 's', command: '/bin/foo', args: ['a'] });
            (0, vitest_1.expect)(out).toEqual({ command: '/bin/foo', args: ['a'] });
        });
        (0, vitest_1.it)('writeServer merges into mcpServers map', () => {
            const cfg = { mcpServers: { existing: { command: 'x', args: [] } } };
            const updated = paths_1.CLIENT_ADAPTERS.cursor.writeServer(cfg, 's', { command: '/bin/foo', args: ['a'] });
            (0, vitest_1.expect)(updated.mcpServers.existing).toEqual({ command: 'x', args: [] });
            (0, vitest_1.expect)(updated.mcpServers.s).toEqual({ command: '/bin/foo', args: ['a'] });
        });
        (0, vitest_1.it)('writeServer creates mcpServers key when missing', () => {
            const updated = paths_1.CLIENT_ADAPTERS.cursor.writeServer({}, 's', { command: 'c', args: [] });
            (0, vitest_1.expect)(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
        });
        (0, vitest_1.it)('removeServer deletes entry', () => {
            const cfg = { mcpServers: { s: { command: 'c', args: [] }, t: { command: 'c2', args: [] } } };
            const updated = paths_1.CLIENT_ADAPTERS.cursor.removeServer(cfg, 's');
            (0, vitest_1.expect)(updated.mcpServers.s).toBeUndefined();
            (0, vitest_1.expect)(updated.mcpServers.t).toBeDefined();
        });
        (0, vitest_1.it)('readServers returns mcpServers map', () => {
            const cfg = { mcpServers: { s: { command: 'c', args: [] } } };
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.readServers(cfg)).toEqual({ s: { command: 'c', args: [] } });
        });
        (0, vitest_1.it)('readServers returns empty object for malformed config', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.readServers(null)).toEqual({});
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.cursor.readServers({})).toEqual({});
        });
    });
    (0, vitest_1.describe)('vscode adapter', () => {
        (0, vitest_1.it)('uses ~/Library/Application Support/Code/User/mcp.json on darwin', () => {
            const home = os_1.default.homedir();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.vscode.configPath.darwin).toBe(path_1.default.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
        });
        (0, vitest_1.it)('uses ~/.config/Code/User/mcp.json on linux', () => {
            const home = os_1.default.homedir();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.vscode.configPath.linux).toBe(path_1.default.join(home, '.config', 'Code', 'User', 'mcp.json'));
        });
        (0, vitest_1.it)('rootKey is servers (not mcpServers)', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.vscode.rootKey).toBe('servers');
        });
        (0, vitest_1.it)('writeServer writes under servers key', () => {
            const updated = paths_1.CLIENT_ADAPTERS.vscode.writeServer({}, 's', { command: 'c', args: ['a'] });
            (0, vitest_1.expect)(updated.servers.s).toEqual({ command: 'c', args: ['a'] });
        });
        (0, vitest_1.it)('removeServer deletes under servers key', () => {
            const cfg = { servers: { s: { command: 'c', args: [] } } };
            const updated = paths_1.CLIENT_ADAPTERS.vscode.removeServer(cfg, 's');
            (0, vitest_1.expect)(updated.servers.s).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('opencode adapter', () => {
        (0, vitest_1.it)('uses ~/.config/opencode/opencode.json on darwin and linux', () => {
            const home = os_1.default.homedir();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.opencode.configPath.darwin).toBe(path_1.default.join(home, '.config', 'opencode', 'opencode.json'));
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.opencode.configPath.linux).toBe(path_1.default.join(home, '.config', 'opencode', 'opencode.json'));
        });
        (0, vitest_1.it)('rootKey is mcp (not mcpServers)', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.opencode.rootKey).toBe('mcp');
        });
        (0, vitest_1.it)('serialize returns { type: "local", command: [cmd, ...args] } array shape', () => {
            const out = paths_1.CLIENT_ADAPTERS.opencode.serialize({ name: 's', command: '/bin/foo', args: ['a', 'b'] });
            (0, vitest_1.expect)(out).toEqual({ type: 'local', command: ['/bin/foo', 'a', 'b'] });
        });
        (0, vitest_1.it)('writeServer writes under mcp key using array command', () => {
            const updated = paths_1.CLIENT_ADAPTERS.opencode.writeServer({}, 's', {
                type: 'local',
                command: ['/bin/foo', 'a'],
            });
            (0, vitest_1.expect)(updated.mcp.s).toEqual({ type: 'local', command: ['/bin/foo', 'a'] });
        });
        (0, vitest_1.it)('removeServer deletes under mcp key', () => {
            const cfg = { mcp: { s: { type: 'local', command: ['x'] } } };
            const updated = paths_1.CLIENT_ADAPTERS.opencode.removeServer(cfg, 's');
            (0, vitest_1.expect)(updated.mcp.s).toBeUndefined();
        });
        (0, vitest_1.it)('readServers returns mcp map', () => {
            const cfg = { mcp: { s: { type: 'local', command: ['x'] } } };
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.opencode.readServers(cfg)).toEqual({ s: { type: 'local', command: ['x'] } });
        });
    });
    (0, vitest_1.describe)('claudeDesktop adapter', () => {
        (0, vitest_1.it)('uses darwin path and linux=null (unsupported)', () => {
            const home = os_1.default.homedir();
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeDesktop.configPath.darwin).toBe(path_1.default.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeDesktop.configPath.linux).toBeNull();
        });
        (0, vitest_1.it)('rootKey is mcpServers', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeDesktop.rootKey).toBe('mcpServers');
        });
        (0, vitest_1.it)('writeServer writes under mcpServers', () => {
            const updated = paths_1.CLIENT_ADAPTERS.claudeDesktop.writeServer({}, 's', { command: 'c', args: [] });
            (0, vitest_1.expect)(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
        });
    });
    (0, vitest_1.describe)('claudeCode adapter (project scope)', () => {
        (0, vitest_1.it)('uses ./.mcp.json regardless of OS (relative to CWD)', () => {
            // project-scope file lives at the project root; adapter returns relative path
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeCode.configPath.darwin).toBe(path_1.default.resolve(process.cwd(), '.mcp.json'));
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeCode.configPath.linux).toBe(path_1.default.resolve(process.cwd(), '.mcp.json'));
        });
        (0, vitest_1.it)('rootKey is mcpServers', () => {
            (0, vitest_1.expect)(paths_1.CLIENT_ADAPTERS.claudeCode.rootKey).toBe('mcpServers');
        });
        (0, vitest_1.it)('serialize returns { command, args } shape', () => {
            const out = paths_1.CLIENT_ADAPTERS.claudeCode.serialize({ name: 's', command: 'c', args: ['a'] });
            (0, vitest_1.expect)(out).toEqual({ command: 'c', args: ['a'] });
        });
        (0, vitest_1.it)('writeServer and removeServer operate on mcpServers', () => {
            const updated = paths_1.CLIENT_ADAPTERS.claudeCode.writeServer({}, 's', { command: 'c', args: [] });
            (0, vitest_1.expect)(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
            const removed = paths_1.CLIENT_ADAPTERS.claudeCode.removeServer(updated, 's');
            (0, vitest_1.expect)(removed.mcpServers.s).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('getClientConfigPath', () => {
        (0, vitest_1.it)('returns darwin path when platform is darwin', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            const p = (0, paths_1.getClientConfigPath)('cursor');
            (0, vitest_1.expect)(p).toBe(paths_1.CLIENT_ADAPTERS.cursor.configPath.darwin);
        });
        (0, vitest_1.it)('returns linux path when platform is linux', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            const p = (0, paths_1.getClientConfigPath)('vscode');
            (0, vitest_1.expect)(p).toBe(paths_1.CLIENT_ADAPTERS.vscode.configPath.linux);
        });
        (0, vitest_1.it)('returns null for claudeDesktop on linux (unsupported)', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            (0, vitest_1.expect)((0, paths_1.getClientConfigPath)('claudeDesktop')).toBeNull();
        });
        (0, vitest_1.it)('returns null for unknown platforms', () => {
            Object.defineProperty(process, 'platform', { value: 'freebsd' });
            (0, vitest_1.expect)((0, paths_1.getClientConfigPath)('opencode')).toBeNull();
        });
        (0, vitest_1.it)('returns null for unknown client', () => {
            (0, vitest_1.expect)((0, paths_1.getClientConfigPath)('nonexistent')).toBeNull();
        });
    });
});
//# sourceMappingURL=paths.test.js.map