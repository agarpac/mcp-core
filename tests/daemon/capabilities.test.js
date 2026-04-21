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
/* ------------------------------------------------------------------ *
 * Helpers shared with multiplexing tests                              *
 * ------------------------------------------------------------------ */
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
 * A fake child that auto-responds to MCP capability-discovery requests
 * (__cap-* IDs) sent on its stdin.
 */
function createCapAwareFakeChild(mockTools = []) {
    const child = createFakeChild();
    let buf = '';
    child.stdin.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (!line.trim())
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (typeof msg.id === 'string' && msg.id.endsWith('-init')) {
                // Respond to initialize
                const reply = {
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: mockTools.length > 0 ? {} : undefined,
                        },
                        serverInfo: { name: 'test-server', version: '1.0.0' },
                    },
                };
                // Remove undefined capabilities
                if (!reply.result.capabilities.tools)
                    delete reply.result.capabilities.tools;
                child.stdout.write(JSON.stringify(reply) + '\n');
                return;
            }
            if (typeof msg.id === 'string' && msg.id.endsWith('-tools')) {
                child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: mockTools } }) + '\n');
                return;
            }
            if (typeof msg.id === 'string' && msg.id.endsWith('-resources')) {
                child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } }) + '\n');
                return;
            }
            if (typeof msg.id === 'string' && msg.id.endsWith('-prompts')) {
                child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } }) + '\n');
                return;
            }
        }
    });
    return child;
}
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
    const waitFor = (predicate, timeoutMs = 3000) => new Promise((resolve, reject) => {
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
/* ------------------------------------------------------------------ *
 * Tests                                                               *
 * ------------------------------------------------------------------ */
(0, vitest_1.describe)('createDaemon — listBackends', () => {
    let tmpDir;
    let socketPath;
    let pidFile;
    let logsDir;
    let daemon;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-cap-test-'));
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
    (0, vitest_1.it)('returns empty list when no backends are registered', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'listBackends' });
        const resp = await client.waitFor((m) => m.type === 'listBackends_response');
        (0, vitest_1.expect)(resp.backends).toEqual([]);
        client.socket.end();
    });
    (0, vitest_1.it)('returns capabilities added via backend_registered', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        // Notify the daemon that a backend was installed
        client.send({
            type: 'backend_registered',
            name: 'memory',
            capabilities: {
                tools: [{ name: 'store', description: 'Store a value' }],
                resources: [],
                prompts: [],
            },
        });
        // Give daemon a tick to process
        await new Promise((r) => setTimeout(r, 20));
        client.send({ type: 'listBackends' });
        const resp = await client.waitFor((m) => m.type === 'listBackends_response');
        (0, vitest_1.expect)(resp.backends).toHaveLength(1);
        (0, vitest_1.expect)(resp.backends[0].name).toBe('memory');
        (0, vitest_1.expect)(resp.backends[0].tools).toHaveLength(1);
        (0, vitest_1.expect)(resp.backends[0].tools[0].name).toBe('store');
        client.socket.end();
    });
    (0, vitest_1.it)('reflects removal after backend_unregistered', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({
            type: 'backend_registered',
            name: 'memory',
            capabilities: { tools: [{ name: 'store' }], resources: [], prompts: [] },
        });
        await new Promise((r) => setTimeout(r, 20));
        client.send({ type: 'backend_unregistered', name: 'memory' });
        await new Promise((r) => setTimeout(r, 20));
        client.send({ type: 'listBackends' });
        const resp = await client.waitFor((m) => m.type === 'listBackends_response');
        (0, vitest_1.expect)(resp.backends).toEqual([]);
        client.socket.end();
    });
    (0, vitest_1.it)('discovers capabilities via MCP handshake when listBackendNames is provided', async () => {
        const mockTools = [{ name: 'search', description: 'Search the web' }];
        let spawnedChild = null;
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            getServerConfig: (name) => name === 'brave' ? { command: 'fake', args: [] } : null,
            listBackendNames: () => ['brave'],
            spawnFn: () => {
                spawnedChild = createCapAwareFakeChild(mockTools);
                return spawnedChild;
            },
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'listBackends' });
        const resp = await client.waitFor((m) => m.type === 'listBackends_response', 6000);
        (0, vitest_1.expect)(resp.backends).toHaveLength(1);
        (0, vitest_1.expect)(resp.backends[0].name).toBe('brave');
        (0, vitest_1.expect)(resp.backends[0].tools).toHaveLength(1);
        (0, vitest_1.expect)(resp.backends[0].tools[0].name).toBe('search');
        client.socket.end();
    });
    (0, vitest_1.it)('returns cached result on second listBackends without re-spawning', async () => {
        let spawnCount = 0;
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            getServerConfig: (name) => name === 'fs' ? { command: 'fake', args: [] } : null,
            listBackendNames: () => ['fs'],
            spawnFn: () => {
                spawnCount++;
                return createCapAwareFakeChild([{ name: 'read_file' }]);
            },
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'listBackends' });
        await client.waitFor((m) => m.type === 'listBackends_response', 6000);
        // Second call — should return from cache, no extra spawn
        client.send({ type: 'listBackends' });
        const resp2 = await client.waitFor((m) => m.type === 'listBackends_response' && m !== client.lines[client.lines.length - 2], 3000);
        (0, vitest_1.expect)(resp2.backends[0].tools[0].name).toBe('read_file');
        (0, vitest_1.expect)(spawnCount).toBe(1);
        client.socket.end();
    });
    (0, vitest_1.it)('capability cache is also accessible via _capabilityCache()', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({
            type: 'backend_registered',
            name: 'weather',
            capabilities: { tools: [{ name: 'get_weather' }], resources: [], prompts: [] },
        });
        await new Promise((r) => setTimeout(r, 20));
        const cache = daemon._capabilityCache();
        (0, vitest_1.expect)(cache.get('weather')?.tools[0].name).toBe('get_weather');
        client.socket.end();
    });
});
(0, vitest_1.describe)('createDaemon — pub/sub', () => {
    let tmpDir;
    let socketPath;
    let pidFile;
    let logsDir;
    let daemon;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-pubsub-test-'));
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
    (0, vitest_1.it)('responds to subscribe with subscribed confirmation', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'subscribe' });
        const ack = await client.waitFor((m) => m.type === 'subscribed');
        (0, vitest_1.expect)(ack.type).toBe('subscribed');
        (0, vitest_1.expect)(daemon._subscriberCount()).toBe(1);
        client.socket.end();
    });
    (0, vitest_1.it)('subscriber receives backends_changed when backend_registered is sent', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        // Subscriber connects and subscribes
        const subscriber = connectClient(socketPath);
        await subscriber.connected;
        subscriber.send({ type: 'subscribe' });
        await subscriber.waitFor((m) => m.type === 'subscribed');
        // Another connection registers a backend
        const notifier = connectClient(socketPath);
        await notifier.connected;
        notifier.send({
            type: 'backend_registered',
            name: 'memory',
            capabilities: { tools: [{ name: 'store' }], resources: [], prompts: [] },
        });
        const event = await subscriber.waitFor((m) => m.type === 'backends_changed');
        (0, vitest_1.expect)(event.backends).toHaveLength(1);
        (0, vitest_1.expect)(event.backends[0].name).toBe('memory');
        (0, vitest_1.expect)(event.backends[0].tools[0].name).toBe('store');
        subscriber.socket.end();
        notifier.socket.end();
    });
    (0, vitest_1.it)('subscriber receives backends_changed when backend_unregistered is sent', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const notifier = connectClient(socketPath);
        await notifier.connected;
        notifier.send({
            type: 'backend_registered',
            name: 'memory',
            capabilities: { tools: [], resources: [], prompts: [] },
        });
        await new Promise((r) => setTimeout(r, 20));
        // Subscribe AFTER initial registration
        const subscriber = connectClient(socketPath);
        await subscriber.connected;
        subscriber.send({ type: 'subscribe' });
        await subscriber.waitFor((m) => m.type === 'subscribed');
        // Now unregister
        notifier.send({ type: 'backend_unregistered', name: 'memory' });
        const event = await subscriber.waitFor((m) => m.type === 'backends_changed');
        (0, vitest_1.expect)(event.backends).toHaveLength(0);
        subscriber.socket.end();
        notifier.socket.end();
    });
    (0, vitest_1.it)('multiple subscribers all receive the backends_changed event', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const sub1 = connectClient(socketPath);
        const sub2 = connectClient(socketPath);
        await Promise.all([sub1.connected, sub2.connected]);
        sub1.send({ type: 'subscribe' });
        sub2.send({ type: 'subscribe' });
        await Promise.all([
            sub1.waitFor((m) => m.type === 'subscribed'),
            sub2.waitFor((m) => m.type === 'subscribed'),
        ]);
        (0, vitest_1.expect)(daemon._subscriberCount()).toBe(2);
        const notifier = connectClient(socketPath);
        await notifier.connected;
        notifier.send({
            type: 'backend_registered',
            name: 'fs',
            capabilities: { tools: [{ name: 'read' }], resources: [], prompts: [] },
        });
        const [e1, e2] = await Promise.all([
            sub1.waitFor((m) => m.type === 'backends_changed'),
            sub2.waitFor((m) => m.type === 'backends_changed'),
        ]);
        (0, vitest_1.expect)(e1.backends[0].name).toBe('fs');
        (0, vitest_1.expect)(e2.backends[0].name).toBe('fs');
        sub1.socket.end();
        sub2.socket.end();
        notifier.socket.end();
    });
    (0, vitest_1.it)('subscriber count decrements after socket closes', async () => {
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            skipCapabilityDiscovery: true,
            getServerConfig: () => null,
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'subscribe' });
        await client.waitFor((m) => m.type === 'subscribed');
        (0, vitest_1.expect)(daemon._subscriberCount()).toBe(1);
        await new Promise((resolve) => {
            client.socket.once('close', resolve);
            client.socket.end();
        });
        // Give daemon a tick to process the close event
        await new Promise((r) => setTimeout(r, 20));
        (0, vitest_1.expect)(daemon._subscriberCount()).toBe(0);
    });
    (0, vitest_1.it)('subscriber receives backends_changed after capability discovery completes', async () => {
        const mockTools = [{ name: 'fetch', description: 'HTTP fetch' }];
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            getServerConfig: (name) => name === 'fetch' ? { command: 'fake', args: [] } : null,
            listBackendNames: () => ['fetch'],
            spawnFn: () => createCapAwareFakeChild(mockTools),
        });
        await daemon.start();
        // Subscribe before triggering discovery
        const subscriber = connectClient(socketPath);
        await subscriber.connected;
        subscriber.send({ type: 'subscribe' });
        await subscriber.waitFor((m) => m.type === 'subscribed');
        // Trigger discovery via listBackends
        const requester = connectClient(socketPath);
        await requester.connected;
        requester.send({ type: 'listBackends' });
        // Subscriber should get backends_changed when discovery completes
        const event = await subscriber.waitFor((m) => m.type === 'backends_changed', 6000);
        (0, vitest_1.expect)(event.backends[0].name).toBe('fetch');
        (0, vitest_1.expect)(event.backends[0].tools[0].name).toBe('fetch');
        subscriber.socket.end();
        requester.socket.end();
    });
});
(0, vitest_1.describe)('createDaemon — capability discovery message queuing', () => {
    let tmpDir;
    let socketPath;
    let pidFile;
    let logsDir;
    let daemon;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'mcp-core-queue-test-'));
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
    (0, vitest_1.it)('client requests sent before initialization are queued and flushed after discovery', async () => {
        const mockTools = [{ name: 'echo' }];
        let spawnedChild = null;
        const receivedByBackend = [];
        daemon = (0, index_1.createDaemon)({
            socketPath, pidFile, logsDir,
            getServerConfig: (name) => name === 'echo' ? { command: 'fake', args: [] } : null,
            spawnFn: () => {
                spawnedChild = createCapAwareFakeChild(mockTools);
                // Track non-cap messages that arrive after initialization
                let buf2 = '';
                spawnedChild.stdin.on('data', (chunk) => {
                    buf2 += chunk.toString('utf-8');
                    let idx;
                    while ((idx = buf2.indexOf('\n')) !== -1) {
                        const line = buf2.slice(0, idx);
                        buf2 = buf2.slice(idx + 1);
                        if (!line.trim())
                            continue;
                        let m;
                        try {
                            m = JSON.parse(line);
                        }
                        catch {
                            continue;
                        }
                        if (typeof m.id !== 'string' || !m.id.startsWith('__cap-')) {
                            if (m.method !== 'notifications/initialized') {
                                receivedByBackend.push(m);
                            }
                        }
                    }
                });
                return spawnedChild;
            },
        });
        await daemon.start();
        const client = connectClient(socketPath);
        await client.connected;
        client.send({ type: 'handshake', serverName: 'echo', clientId: 'A' });
        // Immediately send a request (initialization is not done yet)
        client.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } });
        // Simulate the backend responding to the tools/call
        // We need to wait for initialization to finish first, then the backend will receive the message
        await new Promise((resolve) => {
            const check = () => {
                if (receivedByBackend.length > 0)
                    return resolve();
                setTimeout(check, 50);
            };
            setTimeout(check, 100);
        });
        (0, vitest_1.expect)(receivedByBackend.length).toBeGreaterThanOrEqual(1);
        // The tools/call should have arrived AFTER initialization (contains client-prefixed ID)
        const toolsCall = receivedByBackend.find((m) => m.method === 'tools/call');
        (0, vitest_1.expect)(toolsCall).toBeDefined();
        client.socket.end();
    });
});
//# sourceMappingURL=capabilities.test.js.map