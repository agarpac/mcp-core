"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @vitest-environment node
const vitest_1 = require("vitest");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const handshake_1 = require("../../src/validate/handshake");
/**
 * Build a tiny Node script that implements just enough of the MCP protocol to
 * satisfy the handshake:
 *   initialize -> respond
 *   notifications/initialized -> swallow
 *   tools/list -> respond
 *
 * The script is written to a temp file and invoked via `node <file>`. This is
 * more reliable than `node -e "..."` (which breaks on shell-sensitive chars),
 * and more realistic than mocking child_process.
 *
 * `behavior` controls what the fake server does.
 */
function writeFakeServer(behavior) {
    const tools = behavior.tools ?? [
        { name: 'echo', description: 'Echoes input' },
        { name: 'add', description: 'Adds numbers' },
    ];
    const serverName = behavior.serverName ?? 'fake-mcp';
    const serverVersion = behavior.serverVersion ?? '0.0.1';
    const protocolVersion = behavior.protocolVersion ?? '2025-06-18';
    const script = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const MODE = ${JSON.stringify(behavior.mode)};
const TOOLS = ${JSON.stringify(tools)};
const SERVER_NAME = ${JSON.stringify(serverName)};
const SERVER_VERSION = ${JSON.stringify(serverVersion)};
const PROTOCOL_VERSION = ${JSON.stringify(protocolVersion)};

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\\n');
}

if (MODE === 'crash') {
  process.stderr.write('fatal: missing env var FOO\\n');
  process.exit(2);
}

if (MODE === 'banner-then-happy') {
  process.stdout.write('Starting fake MCP server...\\n');
  process.stdout.write('[info] ready\\n');
}

if (MODE === 'corrupt-then-happy') {
  process.stdout.write('{not-json at all\\n');
}

rl.on('line', (line) => {
  if (MODE === 'silent') return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return;
  }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    // swallow
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: TOOLS },
    });
  }
});
`;
    const dir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-handshake-test-'));
    const filePath = path_1.default.join(dir, 'fake-server.js');
    fs_1.default.writeFileSync(filePath, script);
    return filePath;
}
(0, vitest_1.describe)('validateMcpServer — MCP handshake over stdio', () => {
    (0, vitest_1.it)('happy path: returns success with tool count, latency, and server info', async () => {
        const script = writeFakeServer({
            mode: 'happy',
            tools: [
                { name: 'echo', description: 'Echoes input' },
                { name: 'add', description: 'Adds numbers' },
                { name: 'sub', description: 'Subtracts numbers' },
            ],
            serverName: 'my-fake',
            serverVersion: '1.2.3',
            protocolVersion: '2025-06-18',
        });
        const result = await (0, handshake_1.validateMcpServer)({
            command: process.execPath,
            args: [script],
            timeoutMs: 5000,
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.tools).toBe(3);
        (0, vitest_1.expect)(result.toolNames).toEqual(['echo', 'add', 'sub']);
        (0, vitest_1.expect)(result.protocolVersion).toBe('2025-06-18');
        (0, vitest_1.expect)(result.serverInfo).toEqual({ name: 'my-fake', version: '1.2.3' });
        (0, vitest_1.expect)(result.latencyMs).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(result.latencyMs).toBeLessThan(5000);
        (0, vitest_1.expect)(result.error).toBeUndefined();
    });
    (0, vitest_1.it)('tolerates non-JSON banner lines on stdout before the handshake', async () => {
        const script = writeFakeServer({ mode: 'banner-then-happy' });
        const result = await (0, handshake_1.validateMcpServer)({
            command: process.execPath,
            args: [script],
            timeoutMs: 5000,
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.tools).toBe(2);
    });
    (0, vitest_1.it)('tolerates a corrupt JSON line on stdout before the handshake', async () => {
        const script = writeFakeServer({ mode: 'corrupt-then-happy' });
        const result = await (0, handshake_1.validateMcpServer)({
            command: process.execPath,
            args: [script],
            timeoutMs: 5000,
        });
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(result.tools).toBe(2);
    });
    (0, vitest_1.it)('times out when the server never responds', async () => {
        const script = writeFakeServer({ mode: 'silent' });
        const result = await (0, handshake_1.validateMcpServer)({
            command: process.execPath,
            args: [script],
            timeoutMs: 300,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.tools).toBe(0);
        (0, vitest_1.expect)(result.error).toMatch(/timeout/i);
    }, 5000);
    (0, vitest_1.it)('reports command-not-found cleanly (ENOENT)', async () => {
        const result = await (0, handshake_1.validateMcpServer)({
            command: 'does-not-exist-cmd-xyz-123',
            args: [],
            timeoutMs: 2000,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.tools).toBe(0);
        (0, vitest_1.expect)(result.error).toMatch(/not found|ENOENT/i);
    });
    (0, vitest_1.it)('captures stderr when the server crashes at startup', async () => {
        const script = writeFakeServer({ mode: 'crash' });
        const result = await (0, handshake_1.validateMcpServer)({
            command: process.execPath,
            args: [script],
            timeoutMs: 2000,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
        (0, vitest_1.expect)(result.tools).toBe(0);
        (0, vitest_1.expect)(result.rawError ?? '').toMatch(/fatal: missing env var FOO/);
    });
});
//# sourceMappingURL=handshake.test.js.map