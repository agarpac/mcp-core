import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import readline from 'readline';
import { DAEMON_SOCKET, LOGS_DIR, CORE_DIR } from '../config/paths';
import { ConfigStore } from '../config/store';

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

export interface ServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string> | undefined;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
}

export interface BackendInfo {
  name: string;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
}

export interface DaemonOptions {
  socketPath: string;
  pidFile: string;
  logsDir: string;
  /** Ms of inactivity after last client leaves before a server is killed. Default 5 min. */
  autoShutdownMs?: number;
  /** Resolver for server configs — lets tests inject fixtures without touching ConfigStore. */
  getServerConfig: (name: string) => ServerConfig | null;
  /** Spawner for MCP server processes. Default: child_process.spawn. Injectable for tests. */
  spawnFn?: (command: string, args: string[], options: SpawnOptions & { __serverName?: string }) => ChildProcess;
  /** Clock, for uptime computation. Defaults to Date.now. */
  now?: () => number;
  /** Return all configured backend names (enables lazy capability discovery in listBackends). */
  listBackendNames?: () => string[];
  /**
   * Skip the MCP initialize handshake against backends on start.
   * Set to true in tests that don't exercise capability discovery.
   */
  skipCapabilityDiscovery?: boolean;
}

export interface Daemon {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  /** Exposed for tests. */
  _activeServerNames(): string[];
  /** Exposed for tests. */
  _subscriberCount(): number;
  /** Exposed for tests. */
  _capabilityCache(): Map<string, BackendInfo>;
}

interface ActiveServer {
  process: ChildProcess;
  clients: Set<net.Socket>;
  name: string;
  shutdownTimer?: NodeJS.Timeout;
  /** True once the MCP initialize/initialized dance is complete (or skipped). */
  initialized: boolean;
  /** Client messages queued while waiting for initialization to finish. */
  pendingMessages: string[];
  /** Resolves when capability discovery completes (or fails gracefully). */
  capabilityDiscovery: Promise<BackendInfo>;
  resolveCapabilityDiscovery: (info: BackendInfo) => void;
}

interface PendingRequest {
  socket: net.Socket;
  originalId: string | number;
}

/* ------------------------------------------------------------------ *
 * PID / lock helpers                                                  *
 * ------------------------------------------------------------------ */

export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

export function acquireDaemonLock(pidFile: string, socketPath: string): void {
  if (fs.existsSync(pidFile)) {
    const raw = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = Number(raw);
    if (Number.isFinite(pid) && isProcessAlive(pid)) {
      throw new Error(
        `[mcp-daemon] Another daemon is already running (PID ${pid}). ` +
          `Stop it first, or remove ${pidFile} if you are sure it is stale.`
      );
    }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  }

  if (fs.existsSync(socketPath)) {
    try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ *
 * Factory                                                             *
 * ------------------------------------------------------------------ */

export function createDaemon(opts: DaemonOptions): Daemon {
  const autoShutdownMs = opts.autoShutdownMs ?? 5 * 60 * 1000;
  const spawnFn = opts.spawnFn ?? ((cmd, args, options) => spawn(cmd, args, options));
  const now = opts.now ?? Date.now;
  const skipCapabilityDiscovery = opts.skipCapabilityDiscovery ?? false;

  const activeServers = new Map<string, ActiveServer>();
  const pendingRequests = new Map<string, PendingRequest>();
  /** Callbacks for in-flight internal capability-discovery requests (keyed by __cap- ID). */
  const capCallbacks = new Map<string, (result: unknown) => void>();
  /** Sockets subscribed to backend-change events. */
  const subscribers = new Set<net.Socket>();
  /** Cache of discovered capabilities, keyed by backend name. */
  const capabilityCache = new Map<string, BackendInfo>();

  let clientIdCounter = 0;
  let startedAt = 0;
  let server: net.Server | null = null;

  /* ---------------------------------------------------------------- *
   * Pub/sub broadcast                                                 *
   * ---------------------------------------------------------------- */

  function broadcastBackendsChanged(): void {
    const backends = [...capabilityCache.values()];
    const line = JSON.stringify({ type: 'backends_changed', backends }) + '\n';
    for (const sub of subscribers) {
      try { sub.write(line); } catch { subscribers.delete(sub); }
    }
  }

  /* ---------------------------------------------------------------- *
   * Capability discovery                                              *
   * ---------------------------------------------------------------- */

  function sendCapRequest(
    activeServer: ActiveServer,
    id: string,
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        capCallbacks.delete(id);
        reject(new Error(`cap-discovery timeout: ${method}`));
      }, 30000);
      capCallbacks.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method };
      if (params !== undefined) msg.params = params;
      activeServer.process.stdin?.write(JSON.stringify(msg) + '\n');
    });
  }

  async function discoverCapabilities(activeServer: ActiveServer): Promise<BackendInfo> {
    const { name } = activeServer;
    const prefix = `__cap-${name}-${Date.now()}`;

    try {
      const initResult = await sendCapRequest(
        activeServer,
        `${prefix}-init`,
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-core', version: '2.0.0' },
        },
      ) as Record<string, unknown> | null;

      activeServer.process.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      );

      const serverCaps = (initResult as any)?.capabilities ?? {};
      let tools: ToolInfo[] = [];
      let resources: ResourceInfo[] = [];
      let prompts: PromptInfo[] = [];

      if (serverCaps.tools !== undefined) {
        try {
          const r = await sendCapRequest(activeServer, `${prefix}-tools`, 'tools/list') as any;
          tools = r?.tools ?? [];
        } catch { /* best effort */ }
      }

      if (serverCaps.resources !== undefined) {
        try {
          const r = await sendCapRequest(activeServer, `${prefix}-resources`, 'resources/list') as any;
          resources = r?.resources ?? [];
        } catch { /* best effort */ }
      }

      if (serverCaps.prompts !== undefined) {
        try {
          const r = await sendCapRequest(activeServer, `${prefix}-prompts`, 'prompts/list') as any;
          prompts = r?.prompts ?? [];
        } catch { /* best effort */ }
      }

      return { name, tools, resources, prompts };
    } catch {
      return { name, tools: [], resources: [], prompts: [] };
    }
  }

  /* ---------------------------------------------------------------- *
   * Backend lifecycle                                                 *
   * ---------------------------------------------------------------- */

  function startServer(serverName: string): ActiveServer | null {
    const config = opts.getServerConfig(serverName);
    if (!config) return null;

    console.log(`[Daemon] Arrancando servidor MCP: ${serverName}`);

    const env = { ...process.env, ...(config.env ?? {}) };
    const child = spawnFn(config.command, config.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      __serverName: serverName,
    });

    let resolveCapabilityDiscovery!: (info: BackendInfo) => void;
    const capabilityDiscovery = new Promise<BackendInfo>((resolve) => {
      resolveCapabilityDiscovery = resolve;
    });

    const activeServer: ActiveServer = {
      process: child,
      clients: new Set(),
      name: serverName,
      initialized: skipCapabilityDiscovery,
      pendingMessages: [],
      capabilityDiscovery,
      resolveCapabilityDiscovery,
    };

    // stderr → log file
    try {
      const logStream = fs.createWriteStream(path.join(opts.logsDir, `${serverName}.log`), { flags: 'a' });
      logStream.on('error', () => { /* logsDir may have been removed (e.g. in tests) */ });
      child.stderr?.on('data', (data) => {
        const timestamp = new Date().toISOString();
        logStream.write(`[${timestamp}] [STDERR] ${data}`);
      });
      (activeServer as any).__logStream = logStream;
    } catch (e) {
      console.error(`[Daemon] Could not open log stream for ${serverName}:`, e);
    }

    // stdout → route back to clients
    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line);

          // Capability discovery interception — never route to clients
          if (typeof msg.id === 'string' && msg.id.startsWith('__cap-')) {
            const cb = capCallbacks.get(msg.id);
            if (cb) { capCallbacks.delete(msg.id); cb(msg.result ?? null); }
            return;
          }

          if (msg.id !== undefined && pendingRequests.has(String(msg.id))) {
            const key = String(msg.id);
            const pending = pendingRequests.get(key)!;
            msg.id = pending.originalId;
            pending.socket.write(JSON.stringify(msg) + '\n');
            pendingRequests.delete(key);
          } else {
            // Notification broadcast
            const outLine = JSON.stringify(msg) + '\n';
            for (const client of activeServer.clients) {
              client.write(outLine);
            }
          }
        } catch {
          const stream = (activeServer as any).__logStream as fs.WriteStream | undefined;
          if (stream) {
            const timestamp = new Date().toISOString();
            stream.write(`[${timestamp}] [STDOUT-NO-JSON] ${line}\n`);
          }
        }
      });
    }

    child.on('exit', (code) => {
      console.log(`[Daemon] Servidor ${serverName} se cerró (código ${code}).`);
      activeServers.delete(serverName);
      if (activeServer.shutdownTimer) clearTimeout(activeServer.shutdownTimer);
      // Ensure the discovery promise resolves even if the process dies early
      activeServer.resolveCapabilityDiscovery({ name: serverName, tools: [], resources: [], prompts: [] });
      // Flush queued messages as errors so clients don't hang waiting for a response
      const errorLine = JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: `Backend '${serverName}' exited unexpectedly (code ${code})` },
        id: null,
      }) + '\n';
      for (const client of activeServer.clients) {
        try { client.write(errorLine); } catch { /* ignore */ }
        client.end();
      }
    });

    activeServers.set(serverName, activeServer);

    if (!skipCapabilityDiscovery) {
      discoverCapabilities(activeServer)
        .then((info) => {
          capabilityCache.set(serverName, info);
          activeServer.resolveCapabilityDiscovery(info);
          activeServer.initialized = true;
          for (const queued of activeServer.pendingMessages) {
            child.stdin?.write(queued);
          }
          activeServer.pendingMessages = [];
          broadcastBackendsChanged();
        })
        .catch(() => {
          // Discovery failed — still let clients through and notify gateway
          activeServer.initialized = true;
          for (const queued of activeServer.pendingMessages) {
            child.stdin?.write(queued);
          }
          activeServer.pendingMessages = [];
          activeServer.resolveCapabilityDiscovery({ name: serverName, tools: [], resources: [], prompts: [] });
          broadcastBackendsChanged();
        });
    } else {
      resolveCapabilityDiscovery({ name: serverName, tools: [], resources: [], prompts: [] });
    }

    return activeServer;
  }

  /* ---------------------------------------------------------------- *
   * Connection handler                                                *
   * ---------------------------------------------------------------- */

  function handleConnection(socket: net.Socket): void {
    const clientId = `client-${++clientIdCounter}`;
    let assignedServer: ActiveServer | null = null;
    let handshaked = false;

    const rl = readline.createInterface({ input: socket });

    rl.on('line', (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error(`[Daemon] Error parseando JSON del cliente ${clientId}:`, e);
        return;
      }

      // Health check: respond to ping without requiring handshake
      if (!handshaked && msg.type === 'ping') {
        const uptime = Math.max(0, now() - startedAt);
        socket.write(JSON.stringify({ type: 'pong', uptime }) + '\n');
        return;
      }

      // Subscribe to backend-change events (allowed before handshake)
      if (msg.type === 'subscribe') {
        subscribers.add(socket);
        socket.write(JSON.stringify({ type: 'subscribed' }) + '\n');
        return;
      }

      // Stop a specific backend process (returns it to idle; relaunches lazily on next request)
      if (msg.type === 'stopBackend') {
        const { name } = msg as { name?: string };
        if (!name || !activeServers.has(name)) {
          socket.write(JSON.stringify({ type: 'stopBackend_response', success: false, error: 'not running' }) + '\n');
          return;
        }
        const srv = activeServers.get(name)!;
        if (srv.shutdownTimer) clearTimeout(srv.shutdownTimer);
        try { srv.process.kill('SIGTERM'); } catch { /* ignore */ }
        activeServers.delete(name);
        socket.write(JSON.stringify({ type: 'stopBackend_response', success: true }) + '\n');
        return;
      }

      // Lightweight status query — returns active process names + cached capability names
      if (msg.type === 'getActiveServers') {
        socket.write(
          JSON.stringify({
            type: 'getActiveServers_response',
            active: Array.from(activeServers.keys()),
            cached: Array.from(capabilityCache.keys()),
          }) + '\n',
        );
        return;
      }

      // List all backends with capabilities
      if (msg.type === 'listBackends') {
        if (!opts.listBackendNames) {
          socket.write(
            JSON.stringify({ type: 'listBackends_response', backends: [...capabilityCache.values()] }) + '\n',
          );
          return;
        }

        const names = opts.listBackendNames();
        const pending: Promise<void>[] = [];
        for (const name of names) {
          if (capabilityCache.has(name)) continue;
          let active = activeServers.get(name);
          if (!active) active = startServer(name) ?? undefined;
          if (active) pending.push(active.capabilityDiscovery.then(() => {}));
        }
        Promise.allSettled(pending).then(() => {
          socket.write(
            JSON.stringify({ type: 'listBackends_response', backends: [...capabilityCache.values()] }) + '\n',
          );
        });
        return;
      }

      // Backend registered notification (from install CLI command)
      if (msg.type === 'backend_registered') {
        const { name, capabilities } = msg as { name?: string; capabilities?: Partial<BackendInfo> };
        if (name) {
          capabilityCache.set(name, {
            name,
            tools: capabilities?.tools ?? [],
            resources: capabilities?.resources ?? [],
            prompts: capabilities?.prompts ?? [],
          });
          broadcastBackendsChanged();
        }
        return;
      }

      // Backend unregistered notification (from uninstall CLI command)
      if (msg.type === 'backend_unregistered') {
        const { name } = msg as { name?: string };
        if (name) {
          capabilityCache.delete(name);
          broadcastBackendsChanged();
        }
        return;
      }

      // Handshake phase
      if (!handshaked && msg.type === 'handshake') {
        const serverName = msg.serverName;
        handshaked = true;

        if (!activeServers.has(serverName)) {
          assignedServer = startServer(serverName);
        } else {
          assignedServer = activeServers.get(serverName)!;
          if (assignedServer.shutdownTimer) {
            clearTimeout(assignedServer.shutdownTimer);
            delete assignedServer.shutdownTimer;
          }
        }

        if (!assignedServer) {
          console.error(`[Daemon] El cliente pidió el servidor '${serverName}' que no existe.`);
          socket.write(
            JSON.stringify({ error: { code: -32601, message: `Server ${serverName} not configured in mcp-core.` } }) + '\n',
          );
          socket.end();
          return;
        }

        assignedServer.clients.add(socket);
        console.log(`[Daemon] Cliente ${clientId} conectado al servidor ${serverName}`);
        return;
      }

      // Non-handshake first message: ignore
      if (!handshaked) {
        console.warn(`[Daemon] Cliente ${clientId} envió un mensaje antes del handshake. Ignorando.`);
        return;
      }

      // Proxification phase
      if (assignedServer) {
        if (msg.id !== undefined) {
          const originalId = msg.id;
          const newId = `${clientId}-${originalId}`;
          pendingRequests.set(newId, { socket, originalId });
          msg.id = newId;
        }
        const serialized = JSON.stringify(msg) + '\n';
        if (!assignedServer.initialized) {
          assignedServer.pendingMessages.push(serialized);
        } else {
          assignedServer.process.stdin?.write(serialized);
        }
      }
    });

    socket.on('close', () => {
      subscribers.delete(socket);

      if (assignedServer) {
        assignedServer.clients.delete(socket);
        console.log(`[Daemon] Cliente ${clientId} desconectado de ${assignedServer.name}`);

        if (assignedServer.clients.size === 0) {
          const srv = assignedServer;
          srv.shutdownTimer = setTimeout(() => {
            if (srv.clients.size === 0) {
              console.log(`[Daemon] Servidor ${srv.name} sin uso. Apagando para ahorrar RAM...`);
              try { srv.process.kill('SIGTERM'); } catch { /* ignore */ }
              activeServers.delete(srv.name);
            }
          }, autoShutdownMs);
          if (typeof srv.shutdownTimer.unref === 'function') srv.shutdownTimer.unref();
        }
      }

      for (const [key, req] of pendingRequests.entries()) {
        if (req.socket === socket) pendingRequests.delete(key);
      }
    });

    socket.on('error', (err) => {
      console.error(`[Daemon] Socket error (${clientId}):`, err.message);
    });
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle                                                         *
   * ---------------------------------------------------------------- */

  async function start(): Promise<void> {
    acquireDaemonLock(opts.pidFile, opts.socketPath);

    const dir = path.dirname(opts.pidFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(opts.pidFile, String(process.pid));
    startedAt = now();

    server = net.createServer(handleConnection);

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(opts.socketPath, () => {
        server!.removeListener('error', reject);
        resolve();
      });
    });
  }

  async function shutdown(): Promise<void> {
    console.log('\n[mcp-daemon] Apagando. Matando subprocesos MCP...');
    for (const [, activeServer] of activeServers.entries()) {
      try { activeServer.process.kill('SIGKILL'); } catch { /* ignore */ }
      if (activeServer.shutdownTimer) clearTimeout(activeServer.shutdownTimer);
    }
    activeServers.clear();
    pendingRequests.clear();
    subscribers.clear();

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = null;
    }

    if (fs.existsSync(opts.socketPath)) {
      try { fs.unlinkSync(opts.socketPath); } catch { /* ignore */ }
    }
    if (fs.existsSync(opts.pidFile)) {
      try {
        const raw = fs.readFileSync(opts.pidFile, 'utf-8').trim();
        if (Number(raw) === process.pid) fs.unlinkSync(opts.pidFile);
      } catch { /* ignore */ }
    }
  }

  return {
    start,
    shutdown,
    _activeServerNames: () => Array.from(activeServers.keys()),
    _subscriberCount: () => subscribers.size,
    _capabilityCache: () => capabilityCache,
  };
}

/* ------------------------------------------------------------------ *
 * CLI entrypoint                                                      *
 * ------------------------------------------------------------------ */

export const DAEMON_PID_FILE = path.join(CORE_DIR, 'daemon.pid');

function bootstrap(): void {
  const daemon = createDaemon({
    socketPath: DAEMON_SOCKET,
    pidFile: DAEMON_PID_FILE,
    logsDir: LOGS_DIR,
    getServerConfig: (name: string) => {
      const cfg = ConfigStore.get().servers[name];
      if (!cfg) return null;
      return { command: cfg.command, args: cfg.args, env: cfg.env };
    },
    listBackendNames: () => Object.keys(ConfigStore.get().servers),
  });

  daemon
    .start()
    .then(() => console.log(`[mcp-daemon] Escuchando en ${DAEMON_SOCKET}...`))
    .catch((err) => {
      console.error(`[mcp-daemon] Fallo al arrancar: ${err.message}`);
      process.exit(1);
    });

  const handleSignal = async () => {
    await daemon.shutdown().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

if (require.main === module) {
  bootstrap();
}
