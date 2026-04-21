"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = __importDefault(require("fs"));
vitest_1.vi.mock('fs');
vitest_1.vi.mock('../../src/config/paths', () => {
    const mockAdapter = (id, rootKey, configPath, serialize) => ({
        id,
        displayName: id,
        configPath: { darwin: configPath, linux: configPath },
        rootKey,
        serialize,
        readServers(config) {
            return (config && config[rootKey]) || {};
        },
        writeServer(config, name, record) {
            const next = { ...(config || {}) };
            next[rootKey] = { ...(next[rootKey] || {}), [name]: record };
            return next;
        },
        removeServer(config, name) {
            const next = { ...(config || {}) };
            if (next[rootKey]) {
                const inner = { ...next[rootKey] };
                delete inner[name];
                next[rootKey] = inner;
            }
            return next;
        },
    });
    const CLIENT_ADAPTERS = {
        cursor: mockAdapter('cursor', 'mcpServers', '/mock/cursor.json', (s) => ({
            command: s.command,
            args: s.args,
        })),
        opencode: mockAdapter('opencode', 'mcp', '/mock/opencode.json', (s) => ({
            type: 'local',
            command: [s.command, ...s.args],
        })),
    };
    return {
        CLIENT_ADAPTERS,
        getClientConfigPath: (id) => CLIENT_ADAPTERS[id]?.configPath.darwin ?? null,
    };
});
const index_1 = require("../../src/cli/injectors/index");
(0, vitest_1.describe)('toggleClientServer', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)('enable=true adds proxy entry to the specified client', () => {
        vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(true);
        vitest_1.vi.spyOn(fs_1.default, 'readFileSync').mockReturnValue(JSON.stringify({}));
        const writeSpy = vitest_1.vi.spyOn(fs_1.default, 'writeFileSync').mockImplementation(() => undefined);
        (0, index_1.toggleClientServer)('test-server', 'opencode', true);
        (0, vitest_1.expect)(writeSpy).toHaveBeenCalledTimes(1);
        const [pathArg, content] = writeSpy.mock.calls[0];
        (0, vitest_1.expect)(pathArg).toBe('/mock/opencode.json');
        const parsed = JSON.parse(content);
        (0, vitest_1.expect)(parsed.mcp['test-server']).toEqual({
            type: 'local',
            command: ['mcp-proxy', 'test-server'],
        });
    });
    (0, vitest_1.it)('enable=false removes entry from the specified client', () => {
        vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(true);
        vitest_1.vi.spyOn(fs_1.default, 'readFileSync').mockReturnValue(JSON.stringify({ mcpServers: { 'test-server': { command: 'mcp-proxy' } } }));
        const writeSpy = vitest_1.vi.spyOn(fs_1.default, 'writeFileSync').mockImplementation(() => undefined);
        (0, index_1.toggleClientServer)('test-server', 'cursor', false);
        const [, content] = writeSpy.mock.calls[0];
        const parsed = JSON.parse(content);
        (0, vitest_1.expect)(parsed.mcpServers['test-server']).toBeUndefined();
    });
    (0, vitest_1.it)('throws when client is unknown', () => {
        (0, vitest_1.expect)(() => (0, index_1.toggleClientServer)('s', 'unknown-client', true)).toThrow(/Unknown client/);
    });
    (0, vitest_1.it)('throws when config file does not exist', () => {
        vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(false);
        (0, vitest_1.expect)(() => (0, index_1.toggleClientServer)('s', 'cursor', true)).toThrow(/not found/);
    });
});
//# sourceMappingURL=injectors.test.js.map