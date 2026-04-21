"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const net_1 = __importDefault(require("net"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const status_1 = require("../../src/cli/commands/status");
function startFakeDaemon(socketPath, handler) {
    const server = net_1.default.createServer((socket) => {
        let buf = '';
        socket.on('data', (chunk) => {
            buf += chunk.toString('utf-8');
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                if (line.trim())
                    handler(line, socket);
            }
        });
    });
    const listening = new Promise((resolve) => server.listen(socketPath, () => resolve()));
    return {
        server,
        listening,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
(0, vitest_1.describe)('pingDaemon', () => {
    let tmpDir;
    let socketPath;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-status-test-'));
        socketPath = path_1.default.join(tmpDir, 'daemon.sock');
    });
    (0, vitest_1.afterEach)(() => {
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { }
    });
    (0, vitest_1.it)('returns null when the socket file does not exist', async () => {
        const res = await (0, status_1.pingDaemon)(socketPath, 100);
        (0, vitest_1.expect)(res).toBeNull();
    });
    (0, vitest_1.it)('resolves with uptime on a valid pong', async () => {
        const fake = startFakeDaemon(socketPath, (line, socket) => {
            const msg = JSON.parse(line);
            if (msg.type === 'ping') {
                socket.write(JSON.stringify({ type: 'pong', uptime: 12345 }) + '\n');
            }
        });
        await fake.listening;
        try {
            const res = await (0, status_1.pingDaemon)(socketPath, 500);
            (0, vitest_1.expect)(res).toEqual({ uptime: 12345 });
        }
        finally {
            await fake.close();
        }
    });
    (0, vitest_1.it)('returns null when the peer never responds within the timeout', async () => {
        const fake = startFakeDaemon(socketPath, () => { });
        await fake.listening;
        try {
            const res = await (0, status_1.pingDaemon)(socketPath, 80);
            (0, vitest_1.expect)(res).toBeNull();
        }
        finally {
            await fake.close();
        }
    });
});
(0, vitest_1.describe)('status CLI registration', () => {
    (0, vitest_1.it)('is registered under the mcp-core program', async () => {
        vitest_1.vi.resetModules();
        const { createCLI } = await import('../../src/cli/index');
        const program = createCLI();
        const names = program.commands.map((c) => c.name());
        (0, vitest_1.expect)(names).toContain('status');
    });
});
//# sourceMappingURL=status.test.js.map