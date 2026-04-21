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
const stream_1 = require("stream");
const index_1 = require("../../src/daemon/index");
/**
 * Minimal stand-in for child_process.ChildProcess used by the daemon.
 * - stdin is a PassThrough the tests can read from (drives "what daemon sent")
 * - stdout is a PassThrough the tests can write to (simulates MCP server responses)
 * - kill() emits 'exit'
 */
function createFakeChild() {
    const stdin = new stream_1.PassThrough();
    const stdout = new stream_1.PassThrough();
    const stderr = new stream_1.PassThrough();
    const ee = new stream_1.EventEmitter();
    ee.stdin = stdin;
    ee.stdout = stdout;
    ee.stderr = stderr;
    ee.kill = (_signal) => {
        process.nextTick(() => ee.emit('exit', 0, _signal ?? null));
    };
    return ee;
}
/**
 * Collect JSONL messages sent on daemon -> server's stdin.
 * Each line = one JSON-RPC frame the daemon forwarded to the MCP server.
 */
function collectStdinLines(fakeChild, onLine) {
    let buf = '';
    fakeChild.stdin.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.trim())
                onLine(JSON.parse(line));
        }
    });
}
/** Connect a raw net.Socket to a UNIX socket and collect JSONL messages from it. */
function connectClient(socketPath) {
    const socket = net_1.default.createConnection({ path: socketPath });
    const lines = [];
    const listeners = [];
    let buf = '';
    socket.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!raw.trim())
                continue;
            const obj = JSON.parse(raw);
            lines.push(obj);
            for (const l of listeners)
                l(obj);
        }
    });
    const send = (obj) => socket.write(JSON.stringify(obj) + '\n');
    const waitFor = (predicate, timeoutMs = 2000) => new Promise((resolve, reject) => {
        const existing = lines.find(predicate);
        if (existing)
            return resolve(existing);
        const t = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
        const listener = (obj) => {
            if (predicate(obj)) {
                clearTimeout(t);
                listeners.splice(listeners.indexOf(listener), 1);
                resolve(obj);
            }
        };
        listeners.push(listener);
    });
    const connected = new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', reject);
    });
    return { socket, lines, send, waitFor, connected };
}
function waitForFile(p, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (fs_1.default.existsSync(p))
                return resolve();
            if (Date.now() - start > timeoutMs)
                return reject(new Error(`timeout waiting for ${p}`));
            setTimeout(tick, 20);
        };
        tick();
    });
}
(0, vitest_1.describe)('createDaemon — handshake and multiplexing', () => {
    let tmpDir;
    let socketPath;
    let pidFile;
    let logsDir;
    let daemon;
    let spawnedChildren;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-daemon-test-'));
        socketPath = path_1.default.join(tmpDir, 'daemon.sock');
        pidFile = path_1.default.join(tmpDir, 'daemon.pid');
        logsDir = path_1.default.join(tmpDir, 'logs');
        fs_1.default.mkdirSync(logsDir, { recursive: true });
        spawnedChildren = [];
    });
    (0, vitest_1.afterEach)(async () => {
        if (daemon) {
            await daemon.shutdown().catch(() => undefined);
            daemon = undefined;
        }
        // Best-effort cleanup
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch {
            /* ignore */
        }
    });
    function makeDaemon(overrides = {}) {
        const d = (0, index_1.createDaemon)({
            socketPath,
            pidFile,
            logsDir,
            autoShutdownMs: 60_000,
            skipCapabilityDiscovery: true,
            getServerConfig: (name) => {
                if (name === 'unknown')
                    return null;
                return { command: 'fake', args: [], env: {} };
            },
            spawnFn: (_cmd, _args, _opts) => {
                const child = createFakeChild();
                spawnedChildren.push({ name: _opts?.__serverName ?? 'unknown', child });
                return child;
            },
            ...overrides,
        });
        return d;
    }
    (0, vitest_1.it)('rejects messages that are not a handshake as the first frame', async () => {
        daemon = makeDaemon();
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        // Send a non-handshake frame first; daemon must NOT spawn a server
        client.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        // Give the daemon a tick to process
        await new Promise((r) => setTimeout(r, 50));
        (0, vitest_1.expect)(spawnedChildren.length).toBe(0);
        client.socket.end();
    });
    (0, vitest_1.it)('rejects handshake for an unknown server with an error and closes the socket', async () => {
        daemon = makeDaemon();
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'handshake', serverName: 'unknown', clientId: 'A' });
        const err = await client.waitFor((m) => m.error !== undefined);
        (0, vitest_1.expect)(err.error.code).toBe(-32601);
        (0, vitest_1.expect)(spawnedChildren.length).toBe(0);
    });
    (0, vitest_1.it)('multiplexes IDs: two clients using id=1 get their correct responses', async () => {
        daemon = makeDaemon();
        await daemon.start();
        // Client A connects, handshakes
        const a = connectClient(socketPath);
        await a.connected;
        a.send({ type: 'handshake', serverName: 'serverX', clientId: 'A' });
        // Client B connects, handshakes
        const b = connectClient(socketPath);
        await b.connected;
        b.send({ type: 'handshake', serverName: 'serverX', clientId: 'B' });
        // Wait for the fake child to exist (only one spawned: shared server)
        await vitest_1.vi.waitFor(() => (0, vitest_1.expect)(spawnedChildren.length).toBe(1));
        const fake = spawnedChildren[0].child;
        // Collect what the daemon forwards to the MCP server
        const forwarded = [];
        collectStdinLines(fake, (obj) => forwarded.push(obj));
        // Both clients send id=1
        a.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'a' } });
        b.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'b' } });
        // Wait for daemon to rewrite IDs and forward
        await vitest_1.vi.waitFor(() => (0, vitest_1.expect)(forwarded.length).toBe(2));
        const forwardedIds = forwarded.map((m) => m.id);
        // IDs must have been rewritten (not both equal to 1 anymore)
        (0, vitest_1.expect)(new Set(forwardedIds).size).toBe(2);
        // Simulate the MCP server responding to each rewritten id
        for (const msg of forwarded) {
            const reply = { jsonrpc: '2.0', id: msg.id, result: { echoed: msg.params.name } };
            fake.stdout.write(JSON.stringify(reply) + '\n');
        }
        // Each client must receive a reply with id=1 AND the correct payload
        const replyA = await a.waitFor((m) => m.result !== undefined);
        const replyB = await b.waitFor((m) => m.result !== undefined);
        (0, vitest_1.expect)(replyA.id).toBe(1);
        (0, vitest_1.expect)(replyA.result.echoed).toBe('a');
        (0, vitest_1.expect)(replyB.id).toBe(1);
        (0, vitest_1.expect)(replyB.result.echoed).toBe('b');
    });
    (0, vitest_1.it)('cleans up socket and kills child processes on shutdown', async () => {
        daemon = makeDaemon();
        await daemon.start();
        // Spawn a child by connecting a client
        const c = connectClient(socketPath);
        await c.connected;
        c.send({ type: 'handshake', serverName: 'serverX', clientId: 'A' });
        await vitest_1.vi.waitFor(() => (0, vitest_1.expect)(spawnedChildren.length).toBe(1));
        const fake = spawnedChildren[0].child;
        const killSpy = vitest_1.vi.spyOn(fake, 'kill');
        (0, vitest_1.expect)(fs_1.default.existsSync(socketPath)).toBe(true);
        await daemon.shutdown();
        daemon = undefined;
        (0, vitest_1.expect)(killSpy).toHaveBeenCalled();
        (0, vitest_1.expect)(fs_1.default.existsSync(socketPath)).toBe(false);
    });
    (0, vitest_1.it)('auto-shuts down a server after inactivity timeout elapses', async () => {
        vitest_1.vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            daemon = makeDaemon({ autoShutdownMs: 1000 });
            await daemon.start();
            const c = connectClient(socketPath);
            await c.connected;
            c.send({ type: 'handshake', serverName: 'serverX', clientId: 'A' });
            await vitest_1.vi.waitFor(() => (0, vitest_1.expect)(spawnedChildren.length).toBe(1));
            const fake = spawnedChildren[0].child;
            const killSpy = vitest_1.vi.spyOn(fake, 'kill');
            // Disconnect the client → triggers auto-shutdown timer
            c.socket.end();
            await new Promise((r) => setTimeout(r, 50));
            // Advance past the autoShutdownMs window
            await vitest_1.vi.advanceTimersByTimeAsync(1100);
            (0, vitest_1.expect)(killSpy).toHaveBeenCalled();
        }
        finally {
            vitest_1.vi.useRealTimers();
        }
    });
});
(0, vitest_1.describe)('createDaemon — robustness (PID lock, stale socket, health)', () => {
    let tmpDir;
    let socketPath;
    let pidFile;
    let logsDir;
    let daemon;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-daemon-robust-'));
        socketPath = path_1.default.join(tmpDir, 'daemon.sock');
        pidFile = path_1.default.join(tmpDir, 'daemon.pid');
        logsDir = path_1.default.join(tmpDir, 'logs');
        fs_1.default.mkdirSync(logsDir, { recursive: true });
    });
    (0, vitest_1.afterEach)(async () => {
        if (daemon) {
            await daemon.shutdown().catch(() => undefined);
            daemon = undefined;
        }
        try {
            fs_1.default.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    });
    function make(overrides = {}) {
        return (0, index_1.createDaemon)({
            socketPath,
            pidFile,
            logsDir,
            autoShutdownMs: 60_000,
            skipCapabilityDiscovery: true,
            getServerConfig: () => ({ command: 'x', args: [], env: {} }),
            spawnFn: () => {
                // not used in these tests
                throw new Error('spawn not expected');
            },
            ...overrides,
        });
    }
    (0, vitest_1.it)('writes the PID file on start and removes it on shutdown', async () => {
        daemon = make();
        await daemon.start();
        await waitForFile(pidFile);
        const pid = Number(fs_1.default.readFileSync(pidFile, 'utf-8'));
        (0, vitest_1.expect)(pid).toBe(process.pid);
        await daemon.shutdown();
        daemon = undefined;
        (0, vitest_1.expect)(fs_1.default.existsSync(pidFile)).toBe(false);
    });
    (0, vitest_1.it)('refuses to start if PID file exists with a live PID', async () => {
        // Our own PID is guaranteed live
        fs_1.default.writeFileSync(pidFile, String(process.pid));
        daemon = make();
        await (0, vitest_1.expect)(daemon.start()).rejects.toThrow(/already running|daemon/i);
        // Not our daemon anymore; clear ref so afterEach does not shutdown
        daemon = undefined;
        // PID file must NOT have been removed (we didn't own it)
        (0, vitest_1.expect)(fs_1.default.existsSync(pidFile)).toBe(true);
    });
    (0, vitest_1.it)('removes a stale PID file (dead PID) and continues starting', async () => {
        // PID that is (almost certainly) not running. Pick a very high unlikely-to-exist pid.
        // Use 2^22 which exceeds typical Darwin pid_max.
        fs_1.default.writeFileSync(pidFile, '4194303');
        daemon = make();
        await daemon.start();
        const pid = Number(fs_1.default.readFileSync(pidFile, 'utf-8'));
        (0, vitest_1.expect)(pid).toBe(process.pid);
    });
    (0, vitest_1.it)('cleans up a stale socket when no live daemon is running', async () => {
        // Create a dangling file at the socket path (not a real socket).
        // It should be cleared before listen().
        fs_1.default.writeFileSync(socketPath, 'stale');
        (0, vitest_1.expect)(fs_1.default.existsSync(socketPath)).toBe(true);
        daemon = make();
        await daemon.start();
        // The socket should now be a real UNIX socket (file still exists), AND accept connections
        const probe = net_1.default.createConnection({ path: socketPath });
        await new Promise((resolve, reject) => {
            probe.once('connect', () => resolve());
            probe.once('error', reject);
        });
        probe.end();
    });
    (0, vitest_1.it)('responds to {"type":"ping"} with {"type":"pong", uptime}', async () => {
        daemon = make();
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'ping' });
        const pong = await client.waitFor((m) => m.type === 'pong');
        (0, vitest_1.expect)(pong.type).toBe('pong');
        (0, vitest_1.expect)(typeof pong.uptime).toBe('number');
        (0, vitest_1.expect)(pong.uptime).toBeGreaterThanOrEqual(0);
        client.socket.end();
    });
});
//# sourceMappingURL=multiplexing.test.js.map