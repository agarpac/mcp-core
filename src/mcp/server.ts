#!/usr/bin/env node
/**
 * Gateway MCP server: exposes all daemon-managed backends (plus the 5 mcp_core__
 * control tools) through a single MCP entry point. Tools, resources, and prompts
 * from each backend are prefixed with the backend name (e.g. memory__store).
 */

import net from 'net';
import readline from 'readline';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import type { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js';
import { DAEMON_SOCKET } from '../config/paths';
import { ConfigStore } from '../config/store';
import { runInstall } from '../cli/commands/install';
import { runUninstall } from '../cli/commands/uninstall';
import { toggleClientServer } from '../cli/injectors/index';
import { getDaemonStatus } from '../cli/commands/status';
import type { BackendInfo } from '../daemon/index';

/* ------------------------------------------------------------------ *
 * Naming helpers                                                       *
 * ------------------------------------------------------------------ */

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase().replace(/^_|_$/g, '');
}

export function prefixedToolName(backend: string, tool: string): string {
  return `${sanitizeName(backend)}__${sanitizeName(tool)}`;
}

export function prefixedResourceUri(backend: string, uri: string): string {
  return `mcp-core://${backend}/${uri}`;
}

export function prefixedPromptName(backend: string, prompt: string): string {
  return `${sanitizeName(backend)}__${sanitizeName(prompt)}`;
}

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

type McpTextResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: unknown): McpTextResponse {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function fail(err: unknown): McpTextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: message }], isError: true };
}

export interface DaemonMetaClient extends EventEmitter {
  listBackends(): Promise<BackendInfo[]>;
  close(): void;
}

export interface BackendClient {
  sendRequest(method: string, params?: unknown): Promise<unknown>;
  close(): void;
  isClosed(): boolean;
}

export interface GatewayOptions {
  daemonSocketPath?: string;
  spawnDaemonFn?: () => void;
  /** For testing: inject a mock meta-client factory. */
  _metaClientFactory?: (socketPath: string, spawnFn?: () => void) => Promise<DaemonMetaClient>;
  /** For testing: inject a mock backend-client factory. */
  _backendClientFactory?: (
    socketPath: string,
    backendName: string,
    spawnFn?: () => void,
  ) => Promise<BackendClient>;
}

export interface GatewayServer {
  /** The low-level MCP Server (connect a transport to serve MCP clients). */
  server: MCPServer;
  /** Connect to daemon, load initial backends, start listening for changes. */
  start(): Promise<void>;
  /** Disconnect from daemon and all backend clients. */
  stop(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Real DaemonMetaClient (production)                                  *
 * ------------------------------------------------------------------ */

class RealDaemonMetaClient extends EventEmitter implements DaemonMetaClient {
  private readonly socket: net.Socket;

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;
    const rl = readline.createInterface({ input: socket });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (msg['type'] === 'backends_changed') {
          this.emit('backends_changed', msg['backends']);
        } else if (msg['type'] === 'listBackends_response') {
          this.emit('_listBackends_response', msg['backends']);
        }
      } catch { /* ignore malformed lines */ }
    });
    socket.on('close', () => this.emit('close'));
    socket.on('error', (err) => this.emit('error', err));
  }

  listBackends(): Promise<BackendInfo[]> {
    return new Promise((resolve) => {
      this.once('_listBackends_response', (backends: BackendInfo[]) => resolve(backends));
      this.socket.write(JSON.stringify({ type: 'listBackends' }) + '\n');
    });
  }

  close(): void { this.socket.destroy(); }

  static async connect(
    socketPath: string,
    spawnDaemonFn?: () => void,
  ): Promise<RealDaemonMetaClient> {
    const socket = await connectWithBackoff(socketPath, spawnDaemonFn);
    const client = new RealDaemonMetaClient(socket);
    socket.write(JSON.stringify({ type: 'subscribe' }) + '\n');
    return client;
  }
}

/* ------------------------------------------------------------------ *
 * Real BackendClient (production)                                     *
 * ------------------------------------------------------------------ */

class RealBackendClient implements BackendClient {
  private readonly socket: net.Socket;
  private readonly pending = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: unknown) => void }
  >();
  private counter = 0;
  private _closed = false;

  constructor(socket: net.Socket) {
    this.socket = socket;
    const rl = readline.createInterface({ input: socket });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        const id = msg['id'] as number | undefined;
        if (id !== undefined) {
          const cb = this.pending.get(id);
          if (cb) {
            this.pending.delete(id);
            if (msg['error']) cb.reject(msg['error']);
            else cb.resolve(msg['result']);
          }
        }
      } catch { /* ignore */ }
    });
    socket.on('close', () => {
      this._closed = true;
      for (const cb of this.pending.values()) {
        cb.reject(new Error('daemon connection closed'));
      }
      this.pending.clear();
    });
    socket.on('error', () => { this.socket.destroy(); });
  }

  isClosed(): boolean { return this._closed; }

  sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close(): void {
    for (const cb of this.pending.values()) {
      cb.reject(new Error('backend client closed'));
    }
    this.pending.clear();
    this.socket.destroy();
  }

  static async connect(
    socketPath: string,
    backendName: string,
    spawnDaemonFn?: () => void,
  ): Promise<RealBackendClient> {
    const socket = await connectWithBackoff(socketPath, spawnDaemonFn);
    socket.write(JSON.stringify({ type: 'handshake', serverName: backendName }) + '\n');
    return new RealBackendClient(socket);
  }
}

/* ------------------------------------------------------------------ *
 * Connection helpers                                                   *
 * ------------------------------------------------------------------ */

function tryConnect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    const onError = (err: unknown) => { socket.removeListener('connect', onConnect); reject(err); };
    const onConnect = () => { socket.removeListener('error', onError); resolve(socket); };
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}

async function connectWithBackoff(
  socketPath: string,
  spawnDaemonFn?: () => void,
  opts: { maxRetries?: number; initialBackoffMs?: number; spawnAfterAttempts?: number } = {},
): Promise<net.Socket> {
  const maxRetries = opts.maxRetries ?? 6;
  const initialBackoffMs = opts.initialBackoffMs ?? 100;
  const spawnAfterAttempts = opts.spawnAfterAttempts ?? 2;
  let spawned = false;
  let lastErr: unknown = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await tryConnect(socketPath);
    } catch (err) {
      lastErr = err;
      if (!spawned && i + 1 >= spawnAfterAttempts) {
        spawned = true;
        spawnDaemonFn?.();
      }
      await new Promise<void>((r) => setTimeout(r, initialBackoffMs * Math.pow(2, i)));
    }
  }
  throw new Error(
    `[mcp-core-mcp] daemon unreachable at ${socketPath} after ${maxRetries} attempts ` +
    `(${(lastErr as Error)?.message ?? 'unknown'})`,
  );
}

/* ------------------------------------------------------------------ *
 * Control tools (mcp_core__ prefix)                                   *
 * ------------------------------------------------------------------ */

export const GATEWAY_CONTROL_TOOLS = [
  'mcp_core__install_server',
  'mcp_core__uninstall_server',
  'mcp_core__list_servers',
  'mcp_core__toggle_client',
  'mcp_core__get_daemon_status',
] as const;

/** @deprecated Use GATEWAY_CONTROL_TOOLS */
export const META_MCP_TOOL_NAMES = GATEWAY_CONTROL_TOOLS;

function getControlToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return [
    {
      name: 'mcp_core__install_server',
      description:
        'Install a new MCP server into mcp-core. Accepts an npm package, a git URL, or a local path.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'npm package name, git URL, or local path' },
          name: { type: 'string', description: 'Optional alias' },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment variables persisted with the server',
          },
        },
        required: ['source'],
      },
    },
    {
      name: 'mcp_core__uninstall_server',
      description: 'Uninstall a registered MCP server from mcp-core.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Registered server name' } },
        required: ['name'],
      },
    },
    {
      name: 'mcp_core__list_servers',
      description: 'List every MCP server currently registered in mcp-core.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'mcp_core__toggle_client',
      description: 'Enable or disable a server inside a specific AI client (visibility filter).',
      inputSchema: {
        type: 'object',
        properties: {
          serverName: { type: 'string' },
          clientName: {
            type: 'string',
            description: 'One of: cursor, vscode, claudeDesktop, claudeCode, opencode',
          },
          enable: { type: 'boolean' },
        },
        required: ['serverName', 'clientName', 'enable'],
      },
    },
    {
      name: 'mcp_core__get_daemon_status',
      description:
        'Return daemon status: whether it is running, its PID, uptime in ms, and socket path.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

async function dispatchControlTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpTextResponse | null> {
  switch (name) {
    case 'mcp_core__install_server': {
      try {
        const res = await runInstall(
          args['source'] as string,
          args['name'] as string | undefined,
          args['env'] as Record<string, string> | undefined,
        );
        const installedName = typeof res === 'string' ? res : (res as any).name;
        return ok({ success: true, name: installedName, message: `Server ${installedName} installed` });
      } catch (err) {
        return fail(err);
      }
    }
    case 'mcp_core__uninstall_server': {
      try {
        await runUninstall(args['name'] as string);
        return ok({ success: true, name: args['name'], message: `Server ${args['name']} uninstalled` });
      } catch (err) {
        return fail(err);
      }
    }
    case 'mcp_core__list_servers': {
      try {
        ConfigStore.initialize();
        const servers = ConfigStore.get().servers ?? {};
        const records = Object.entries(servers).map(([n, cfg]: [string, any]) => ({
          name: n,
          command: cfg.command,
          args: cfg.args ?? [],
          clientsLinked: cfg.clientsLinked ?? [],
        }));
        return ok(records);
      } catch (err) {
        return fail(err);
      }
    }
    case 'mcp_core__toggle_client': {
      try {
        toggleClientServer(
          args['serverName'] as string,
          args['clientName'] as string,
          args['enable'] as boolean,
        );
        return ok({ success: true, ...args });
      } catch (err) {
        return fail(err);
      }
    }
    case 'mcp_core__get_daemon_status': {
      try {
        const status = await getDaemonStatus();
        return ok(status);
      } catch (err) {
        return fail(err);
      }
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Gateway factory                                                      *
 * ------------------------------------------------------------------ */

export function createGatewayServer(opts: GatewayOptions = {}): GatewayServer {
  const socketPath = opts.daemonSocketPath ?? DAEMON_SOCKET;
  const spawnFn = opts.spawnDaemonFn ?? defaultSpawnDaemon;

  const metaFactory =
    opts._metaClientFactory ??
    ((p, s) => RealDaemonMetaClient.connect(p, s));
  const backendFactory =
    opts._backendClientFactory ??
    ((p, name, s) => RealBackendClient.connect(p, name, s));

  /** How long (ms) a backend connection can sit idle before the gateway closes it.
   *  Allows the daemon's own auto-shutdown timer to fire and kill the backend process. */
  const POOL_IDLE_MS = 30_000;

  let metaClient: DaemonMetaClient | null = null;
  const backendPool = new Map<string, BackendClient>();
  const poolIdleTimers = new Map<string, NodeJS.Timeout>();
  const poolActiveCounts = new Map<string, number>();

  function cancelPoolIdleTimer(backendName: string): void {
    const t = poolIdleTimers.get(backendName);
    if (t) { clearTimeout(t); poolIdleTimers.delete(backendName); }
  }

  function schedulePoolIdleTimer(backendName: string): void {
    cancelPoolIdleTimer(backendName);
    const t = setTimeout(() => {
      poolIdleTimers.delete(backendName);
      const client = backendPool.get(backendName);
      if (client) { client.close(); backendPool.delete(backendName); }
    }, POOL_IDLE_MS);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    poolIdleTimers.set(backendName, t);
  }

  async function withBackendClient<T>(backendName: string, fn: (c: BackendClient) => Promise<T>): Promise<T> {
    cancelPoolIdleTimer(backendName);
    const client = await getOrCreateBackendClient(backendName);
    poolActiveCounts.set(backendName, (poolActiveCounts.get(backendName) ?? 0) + 1);
    try {
      return await fn(client);
    } finally {
      const remaining = (poolActiveCounts.get(backendName) ?? 1) - 1;
      poolActiveCounts.set(backendName, remaining);
      if (remaining === 0) schedulePoolIdleTimer(backendName);
    }
  }

  // Current tool/resource/prompt registries (rebuilt on every backends_changed)
  type ToolEntry = { name: string; description?: string; inputSchema: Record<string, unknown> };
  type ResourceEntry = { uri: string; name?: string; description?: string; mimeType?: string };
  type PromptEntry = { name: string; description?: string };

  const toolRegistry: ToolEntry[] = [];
  const resourceRegistry: ResourceEntry[] = [];
  const promptRegistry: PromptEntry[] = [];

  const toolDispatch = new Map<string, { backendName: string; originalName: string }>();
  const resourceDispatch = new Map<string, { backendName: string; originalUri: string }>();
  const promptDispatch = new Map<string, { backendName: string; originalName: string }>();

  /* ---- MCP Server ---- */

  const {
    Server,
  } = require('@modelcontextprotocol/sdk/server/index.js') as typeof import('@modelcontextprotocol/sdk/server/index.js');

  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
  } = require('@modelcontextprotocol/sdk/types.js') as typeof import('@modelcontextprotocol/sdk/types.js');

  const mcpServer = new Server(
    { name: 'mcp-core', version: '2.0.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
    },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...getControlToolSchemas(), ...toolRegistry],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = (req.params as any).name as string;
    const args = ((req.params as any).arguments ?? {}) as Record<string, unknown>;

    const control = await dispatchControlTool(name, args);
    if (control !== null) return control;

    const dispatch = toolDispatch.get(name);
    if (!dispatch) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const result = await withBackendClient(dispatch.backendName, (c) =>
        c.sendRequest('tools/call', { name: dispatch.originalName, arguments: args }),
      );
      return result ?? { content: [] };
    } catch (err: unknown) {
      return fail(err);
    }
  });

  mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceRegistry,
  }));

  mcpServer.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = (req.params as any).uri as string;
    const dispatch = resourceDispatch.get(uri);
    if (!dispatch) {
      throw new Error(`Unknown resource: ${uri}`);
    }
    return withBackendClient(dispatch.backendName, (c) =>
      c.sendRequest('resources/read', { uri: dispatch.originalUri }),
    ) as any;
  });

  mcpServer.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptRegistry,
  }));

  mcpServer.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const name = (req.params as any).name as string;
    const args = (req.params as any).arguments;
    const dispatch = promptDispatch.get(name);
    if (!dispatch) {
      throw new Error(`Unknown prompt: ${name}`);
    }
    return withBackendClient(dispatch.backendName, (c) =>
      c.sendRequest('prompts/get', { name: dispatch.originalName, arguments: args }),
    ) as any;
  });

  /* ---- Registry helpers ---- */

  function updateRegistries(backends: BackendInfo[]): void {
    toolRegistry.length = 0;
    resourceRegistry.length = 0;
    promptRegistry.length = 0;
    toolDispatch.clear();
    resourceDispatch.clear();
    promptDispatch.clear();

    for (const backend of backends) {
      const bPrefix = sanitizeName(backend.name);

      for (const tool of backend.tools) {
        const prefixed = `${bPrefix}__${sanitizeName(tool.name)}`;
        toolRegistry.push({
          name: prefixed,
          description: tool.description,
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        });
        toolDispatch.set(prefixed, { backendName: backend.name, originalName: tool.name });
      }

      for (const resource of backend.resources) {
        const prefixedUri = prefixedResourceUri(backend.name, resource.uri);
        resourceRegistry.push({
          uri: prefixedUri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        });
        resourceDispatch.set(prefixedUri, {
          backendName: backend.name,
          originalUri: resource.uri,
        });
      }

      for (const prompt of backend.prompts) {
        const prefixed = `${bPrefix}__${sanitizeName(prompt.name)}`;
        promptRegistry.push({ name: prefixed, description: prompt.description });
        promptDispatch.set(prefixed, { backendName: backend.name, originalName: prompt.name });
      }
    }
  }

  async function getOrCreateBackendClient(backendName: string): Promise<BackendClient> {
    const existing = backendPool.get(backendName);
    if (existing) {
      if (!existing.isClosed()) return existing;
      backendPool.delete(backendName);
    }
    const client = await backendFactory(socketPath, backendName, spawnFn);
    backendPool.set(backendName, client);
    return client;
  }

  /* ---- Lifecycle ---- */

  async function start(): Promise<void> {
    await connectMetaClient(true);
  }

  async function connectMetaClient(initial: boolean): Promise<void> {
    const mc = await metaFactory(socketPath, spawnFn);
    metaClient = mc;

    mc.on('backends_changed', async (backends: BackendInfo[]) => {
      const newNames = new Set(backends.map((b) => b.name));
      for (const [name, client] of backendPool) {
        if (!newNames.has(name)) {
          cancelPoolIdleTimer(name);
          poolActiveCounts.delete(name);
          client.close();
          backendPool.delete(name);
        }
      }
      updateRegistries(backends);
      try {
        await mcpServer.sendToolListChanged();
        await mcpServer.sendResourceListChanged();
        await mcpServer.sendPromptListChanged();
      } catch {
        // Not connected yet or client disconnected — safe to ignore
      }
    });

    mc.on('close', () => {
      if (metaClient !== mc) return;
      metaClient = null;
      // Daemon connection lost — every pooled BackendClient is stale
      for (const client of backendPool.values()) client.close();
      backendPool.clear();
      // Reconnect in the background; connectWithBackoff retries + respawns daemon
      connectMetaClient(false).catch(() => { /* unrecoverable */ });
    });

    mc.on('error', () => { /* surfaced via 'close' */ });

    const backends = await mc.listBackends();
    updateRegistries(backends);

    if (!initial) {
      try {
        await mcpServer.sendToolListChanged();
        await mcpServer.sendResourceListChanged();
        await mcpServer.sendPromptListChanged();
      } catch {
        // Not connected yet or client disconnected — safe to ignore
      }
    }
  }

  async function stop(): Promise<void> {
    for (const t of poolIdleTimers.values()) clearTimeout(t);
    poolIdleTimers.clear();
    poolActiveCounts.clear();
    for (const client of backendPool.values()) client.close();
    backendPool.clear();
    metaClient?.close();
    metaClient = null;
  }

  return { server: mcpServer, start, stop };
}

/* ------------------------------------------------------------------ *
 * Backward-compat export                                              *
 * ------------------------------------------------------------------ */

/** @deprecated Use createGatewayServer */
export function createMcpCoreServer() {
  return createGatewayServer()['server'];
}

/* ------------------------------------------------------------------ *
 * CLI entrypoint                                                      *
 * ------------------------------------------------------------------ */

function defaultSpawnDaemon(): void {
  const daemonScript = path.join(__dirname, '..', 'daemon', 'index.js');
  const daemon = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
  });
  daemon.unref();
}

async function bootstrap(): Promise<void> {
  const {
    StdioServerTransport,
  } = require('@modelcontextprotocol/sdk/server/stdio.js') as typeof import('@modelcontextprotocol/sdk/server/stdio.js');

  const gateway = createGatewayServer({ spawnDaemonFn: defaultSpawnDaemon });
  await gateway.start();

  const transport = new StdioServerTransport();
  await gateway.server.connect(transport);

  const cleanup = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('[mcp-core-mcp] fatal:', err);
    process.exit(1);
  });
}
