"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
vitest_1.vi.mock('fs');
vitest_1.vi.mock('../../src/config/paths', () => ({
    CORE_DIR: '/mock/.mcp-core',
    CORE_CONFIG_FILE: '/mock/.mcp-core/config.json',
    SERVERS_DIR: '/mock/.mcp-core/servers',
    LOGS_DIR: '/mock/.mcp-core/logs',
}));
const store_1 = require("../../src/config/store");
(0, vitest_1.describe)('ConfigStore', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        // Reset singleton state
        // @ts-ignore
        store_1.ConfigStore.config = undefined;
    });
    (0, vitest_1.describe)('initialize', () => {
        (0, vitest_1.it)('creates directories if they do not exist', () => {
            vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(false);
            const mkdirSyncSpy = vitest_1.vi.spyOn(fs_1.default, 'mkdirSync').mockImplementation(() => undefined);
            const writeFileSyncSpy = vitest_1.vi.spyOn(fs_1.default, 'writeFileSync').mockImplementation(() => undefined);
            store_1.ConfigStore.initialize();
            (0, vitest_1.expect)(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core', { recursive: true });
            (0, vitest_1.expect)(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/servers', { recursive: true });
            (0, vitest_1.expect)(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/logs', { recursive: true });
            (0, vitest_1.expect)(writeFileSyncSpy).toHaveBeenCalled();
        });
        (0, vitest_1.it)('loads existing config if file exists', () => {
            vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(true);
            const readFileSyncSpy = vitest_1.vi.spyOn(fs_1.default, 'readFileSync').mockReturnValue(JSON.stringify({
                version: '1.0.0',
                servers: { 'test-server': { command: 'test', args: [] } }
            }));
            store_1.ConfigStore.initialize();
            const config = store_1.ConfigStore.get();
            (0, vitest_1.expect)(readFileSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/config.json', 'utf-8');
            (0, vitest_1.expect)(config.servers['test-server']).toBeDefined();
        });
    });
    (0, vitest_1.describe)('addServer & removeServer', () => {
        (0, vitest_1.beforeEach)(() => {
            vitest_1.vi.spyOn(fs_1.default, 'existsSync').mockReturnValue(false);
            vitest_1.vi.spyOn(fs_1.default, 'mkdirSync').mockImplementation(() => undefined);
            vitest_1.vi.spyOn(fs_1.default, 'writeFileSync').mockImplementation(() => undefined);
        });
        (0, vitest_1.it)('adds a server and saves', () => {
            const writeFileSyncSpy = vitest_1.vi.spyOn(fs_1.default, 'writeFileSync');
            store_1.ConfigStore.addServer('my-server', { command: 'my-cmd', args: ['--foo'] });
            const config = store_1.ConfigStore.get();
            (0, vitest_1.expect)(config.servers['my-server']).toBeDefined();
            (0, vitest_1.expect)(config.servers['my-server'].command).toBe('my-cmd');
            (0, vitest_1.expect)(writeFileSyncSpy).toHaveBeenCalled(); // 2 times: init, add
        });
        (0, vitest_1.it)('removes a server and saves', () => {
            store_1.ConfigStore.addServer('to-delete', { command: 'cmd', args: [] });
            let config = store_1.ConfigStore.get();
            (0, vitest_1.expect)(config.servers['to-delete']).toBeDefined();
            const writeFileSyncSpy = vitest_1.vi.spyOn(fs_1.default, 'writeFileSync');
            writeFileSyncSpy.mockClear();
            store_1.ConfigStore.removeServer('to-delete');
            config = store_1.ConfigStore.get();
            (0, vitest_1.expect)(config.servers['to-delete']).toBeUndefined();
            (0, vitest_1.expect)(writeFileSyncSpy).toHaveBeenCalledTimes(1);
        });
    });
});
//# sourceMappingURL=store.test.js.map