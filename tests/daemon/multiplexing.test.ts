import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter, PassThrough } from 'stream';
import { createDaemon, type Daemon } from '../../src/daemon/index';

/**
 * Minimal stand-in for child_process.ChildProcess used by the daemon.
 * - stdin is a PassThrough the tests can read from (drives "what daemon sent")
 * - stdout is a PassThrough the tests can write to (simulates MCP server responses)
 * - kill() emits 'exit'
 */
function createFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const ee = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: string) => void;
  };
  ee.stdin = stdin;
  ee.stdout = stdout;
  ee.stderr = stderr;
  ee.kill = (_signal?: string) => {
    process.nextTick(() => ee.emit('exit', 0, _signal ?? null));
  };
  return ee;
}

/**
 * Collect JSONL messages sent on daemon -> server's stdin.
 * Each line = one JSON-RPC frame the daemon forwarded to the MCP server.
 */
function collectStdinLines(fakeChild: ReturnType<typeof createFakeChild>, onLine: (obj: any) => void) {
  let buf = '';
  fakeChild.stdin.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf-8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(JSON.parse(line));
    }
  });
}

/** Connect a raw net.Socket to a UNIX socket and collect JSONL messages from it. */
function connectClient(socketPath: string) {
  const socket = net.createConnection({ path: socketPath });
  const lines: any[] = [];
  const listeners: Array<(obj: any) => void> = [];
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf-8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!raw.trim()) continue;
      const obj = JSON.parse(raw);
      lines.push(obj);
      for (const l of listeners) l(obj);
    }
  });
  const send = (obj: unknown) => socket.write(JSON.stringify(obj) + '\n');
  const waitFor = (predicate: (obj: any) => boolean, timeoutMs = 2000): Promise<any> =>
    new Promise((resolve, reject) => {
      const existing = lines.find(predicate);
      if (existing) return resolve(existing);
      const t = setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
      const listener = (obj: any) => {
        if (predicate(obj)) {
          clearTimeout(t);
          listeners.splice(listeners.indexOf(listener), 1);
          resolve(obj);
        }
      };
      listeners.push(listener);
    });
  const connected = new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  return { socket, lines, send, waitFor, connected };
}

function waitForFile(p: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fs.existsSync(p)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${p}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('createDaemon — handshake and multiplexing', () => {
  let tmpDir: string;
  let socketPath: string;
  let pidFile: string;
  let logsDir: string;
  let daemon: Daemon | undefined;
  let spawnedChildren: Array<{ name: string; child: ReturnType<typeof createFakeChild> }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-daemon-test-'));
    socketPath = path.join(tmpDir, 'daemon.sock');
    pidFile = path.join(tmpDir, 'daemon.pid');
    logsDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    spawnedChildren = [];
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown().catch(() => undefined);
      daemon = undefined;
    }
    // Best-effort cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function makeDaemon(overrides: Partial<Parameters<typeof createDaemon>[0]> = {}) {
    const d = createDaemon({
      socketPath,
      pidFile,
      logsDir,
      autoShutdownMs: 60_000,
      skipCapabilityDiscovery: true,
      getServerConfig: (name: string) => {
        if (name === 'unknown') return null;
        return { command: 'fake', args: [], env: {} };
      },
      spawnFn: (_cmd, _args, _opts) => {
        const child = createFakeChild();
        spawnedChildren.push({ name: _opts?.__serverName ?? 'unknown', child });
        return child as any;
      },
      ...overrides,
    });
    return d;
  }

  it('rejects messages that are not a handshake as the first frame', async () => {
    daemon = makeDaemon();
    await daemon.start();

    const client = connectClient(socketPath);
    await client.connected;

    // Send a non-handshake frame first; daemon must NOT spawn a server
    client.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

    // Give the daemon a tick to process
    await new Promise((r) => setTimeout(r, 50));
    expect(spawnedChildren.length).toBe(0);

    client.socket.end();
  });

  it('rejects handshake for an unknown server with an error and closes the socket', async () => {
    daemon = makeDaemon();
    await daemon.start();

    const client = connectClient(socketPath);
    await client.connected;
    client.send({ type: 'handshake', serverName: 'unknown', clientId: 'A' });

    const err = await client.waitFor((m) => m.error !== undefined);
    expect(err.error.code).toBe(-32601);
    expect(spawnedChildren.length).toBe(0);
  });

  it('multiplexes IDs: two clients using id=1 get their correct responses', async () => {
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
    await vi.waitFor(() => expect(spawnedChildren.length).toBe(1));
    const fake = spawnedChildren[0]!.child;

    // Collect what the daemon forwards to the MCP server
    const forwarded: any[] = [];
    collectStdinLines(fake, (obj) => forwarded.push(obj));

    // Both clients send id=1
    a.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'a' } });
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'b' } });

    // Wait for daemon to rewrite IDs and forward
    await vi.waitFor(() => expect(forwarded.length).toBe(2));
    const forwardedIds = forwarded.map((m) => m.id);
    // IDs must have been rewritten (not both equal to 1 anymore)
    expect(new Set(forwardedIds).size).toBe(2);

    // Simulate the MCP server responding to each rewritten id
    for (const msg of forwarded) {
      const reply = { jsonrpc: '2.0', id: msg.id, result: { echoed: msg.params.name } };
      fake.stdout.write(JSON.stringify(reply) + '\n');
    }

    // Each client must receive a reply with id=1 AND the correct payload
    const replyA = await a.waitFor((m) => m.result !== undefined);
    const replyB = await b.waitFor((m) => m.result !== undefined);

    expect(replyA.id).toBe(1);
    expect(replyA.result.echoed).toBe('a');
    expect(replyB.id).toBe(1);
    expect(replyB.result.echoed).toBe('b');
  });

  it('cleans up socket and kills child processes on shutdown', async () => {
    daemon = makeDaemon();
    await daemon.start();

    // Spawn a child by connecting a client
    const c = connectClient(socketPath);
    await c.connected;
    c.send({ type: 'handshake', serverName: 'serverX', clientId: 'A' });

    await vi.waitFor(() => expect(spawnedChildren.length).toBe(1));
    const fake = spawnedChildren[0]!.child;
    const killSpy = vi.spyOn(fake, 'kill');

    expect(fs.existsSync(socketPath)).toBe(true);

    await daemon.shutdown();
    daemon = undefined;

    expect(killSpy).toHaveBeenCalled();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('auto-shuts down a server after inactivity timeout elapses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      daemon = makeDaemon({ autoShutdownMs: 1000 });
      await daemon.start();

      const c = connectClient(socketPath);
      await c.connected;
      c.send({ type: 'handshake', serverName: 'serverX', clientId: 'A' });

      await vi.waitFor(() => expect(spawnedChildren.length).toBe(1));
      const fake = spawnedChildren[0]!.child;
      const killSpy = vi.spyOn(fake, 'kill');

      // Disconnect the client → triggers auto-shutdown timer
      c.socket.end();
      await new Promise((r) => setTimeout(r, 50));

      // Advance past the autoShutdownMs window
      await vi.advanceTimersByTimeAsync(1100);

      expect(killSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createDaemon — robustness (PID lock, stale socket, health)', () => {
  let tmpDir: string;
  let socketPath: string;
  let pidFile: string;
  let logsDir: string;
  let daemon: Daemon | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-daemon-robust-'));
    socketPath = path.join(tmpDir, 'daemon.sock');
    pidFile = path.join(tmpDir, 'daemon.pid');
    logsDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown().catch(() => undefined);
      daemon = undefined;
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function make(overrides: any = {}) {
    return createDaemon({
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

  it('writes the PID file on start and removes it on shutdown', async () => {
    daemon = make();
    await daemon.start();

    await waitForFile(pidFile);
    const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
    expect(pid).toBe(process.pid);

    await daemon.shutdown();
    daemon = undefined;
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('refuses to start if PID file exists with a live PID', async () => {
    // Our own PID is guaranteed live
    fs.writeFileSync(pidFile, String(process.pid));

    daemon = make();
    await expect(daemon.start()).rejects.toThrow(/already running|daemon/i);
    // Not our daemon anymore; clear ref so afterEach does not shutdown
    daemon = undefined;

    // PID file must NOT have been removed (we didn't own it)
    expect(fs.existsSync(pidFile)).toBe(true);
  });

  it('removes a stale PID file (dead PID) and continues starting', async () => {
    // PID that is (almost certainly) not running. Pick a very high unlikely-to-exist pid.
    // Use 2^22 which exceeds typical Darwin pid_max.
    fs.writeFileSync(pidFile, '4194303');

    daemon = make();
    await daemon.start();

    const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
    expect(pid).toBe(process.pid);
  });

  it('cleans up a stale socket when no live daemon is running', async () => {
    // Create a dangling file at the socket path (not a real socket).
    // It should be cleared before listen().
    fs.writeFileSync(socketPath, 'stale');
    expect(fs.existsSync(socketPath)).toBe(true);

    daemon = make();
    await daemon.start();

    // The socket should now be a real UNIX socket (file still exists), AND accept connections
    const probe = net.createConnection({ path: socketPath });
    await new Promise<void>((resolve, reject) => {
      probe.once('connect', () => resolve());
      probe.once('error', reject);
    });
    probe.end();
  });

  it('responds to {"type":"ping"} with {"type":"pong", uptime}', async () => {
    daemon = make();
    await daemon.start();

    const client = connectClient(socketPath);
    await client.connected;
    client.send({ type: 'ping' });

    const pong = await client.waitFor((m) => m.type === 'pong');
    expect(pong.type).toBe('pong');
    expect(typeof pong.uptime).toBe('number');
    expect(pong.uptime).toBeGreaterThanOrEqual(0);

    client.socket.end();
  });
});

