import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import readline from 'readline';

/**
 * Options for validating an MCP server by actually launching it and performing
 * a full handshake over stdio transport.
 */
export interface ValidationOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Default: 5000ms. Enforced end-to-end (spawn -> tools/list response). */
  timeoutMs?: number;
}

export interface ValidationResult {
  success: boolean;
  /** Number of tools reported by `tools/list`. 0 on failure. */
  tools: number;
  toolNames?: string[];
  /** Full tool definitions returned by `tools/list` (available on success). */
  toolDefinitions?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  /** Wall-clock milliseconds from spawn() until tools/list response. */
  latencyMs: number;
  protocolVersion?: string;
  serverInfo?: { name: string; version?: string };
  /** Concise error message when success=false. */
  error?: string;
  /** Raw stderr captured from the subprocess — useful for debugging. */
  rawError?: string;
}

/** Shape of the JSON-RPC response we expect from `initialize`. */
interface InitializeResult {
  protocolVersion?: string;
  capabilities?: unknown;
  serverInfo?: { name?: string; version?: string };
}

/** Shape of the JSON-RPC response we expect from `tools/list`. */
interface ToolsListResult {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

/** JSON-RPC 2.0 envelope used by MCP. */
interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const MCP_PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'mcp-core-validator', version: '1.0.0' };
const DEFAULT_TIMEOUT_MS = 5000;
const SIGTERM_GRACE_MS = 500;

/**
 * Spawns the MCP server as a subprocess (stdio transport), performs the
 * official MCP handshake (`initialize` + `notifications/initialized`), then
 * calls `tools/list`. Kills the subprocess on completion. Enforces timeout.
 *
 * Designed to be resilient against real-world MCP servers that:
 *  - emit banners / log lines on stdout before JSON-RPC starts
 *  - emit startup logs on stderr (not treated as errors unless the process dies)
 *  - interleave corrupt lines (we skip un-parseable stdout lines and keep going)
 *
 * Cleanup is guaranteed via try/finally: SIGTERM first, SIGKILL after a grace
 * period if the process is still alive.
 */
export async function validateMcpServer(
  opts: ValidationOptions,
): Promise<ValidationResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  let child: ChildProcessWithoutNullStreams | null = null;
  let stderrBuf = '';
  let timer: NodeJS.Timeout | null = null;

  // Only forward env vars the caller explicitly provided — we don't leak the
  // parent PATH/etc unless the caller wants them. Most MCPs need PATH though,
  // so if caller passes env, we MERGE with process.env to be safe.
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;

  // Failure result builder — keeps construction consistent.
  const fail = (error: string): ValidationResult => ({
    success: false,
    tools: 0,
    latencyMs: Date.now() - startedAt,
    error,
    ...(stderrBuf ? { rawError: stderrBuf.trim() } : {}),
  });

  try {
    try {
      child = spawn(opts.command, opts.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Synchronous spawn errors are rare (usually async via 'error' event),
      // but handle them defensively.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        tools: 0,
        latencyMs: Date.now() - startedAt,
        error: /ENOENT/.test(msg) ? 'command not found' : msg,
      };
    }

    // Capture stderr for diagnostics. Never treat as fatal by itself — many
    // MCP servers log progress here.
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    // Await a JSON-RPC response with a given id. Non-JSON or unrelated lines
    // are ignored — the MCP server may emit banners, info logs, or other
    // JSON-RPC traffic we don't care about.
    const rl = readline.createInterface({ input: child.stdout });
    const pending = new Map<number | string, (msg: JsonRpcMessage) => void>();

    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(trimmed) as JsonRpcMessage;
      } catch {
        // Not JSON (banner, log line, corrupt frame). Keep reading.
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const resolver = pending.get(msg.id)!;
        pending.delete(msg.id);
        resolver(msg);
      }
    });

    // Async errors from spawn (ENOENT is the common case on darwin/linux)
    // arrive here. We surface them via a dedicated promise.
    const spawnError = new Promise<ValidationResult>((resolve) => {
      child!.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          resolve(fail('command not found (ENOENT)'));
        } else {
          resolve(fail(err.message || String(err)));
        }
      });
    });

    // Process exited before we finished the handshake -> report stderr.
    const earlyExit = new Promise<ValidationResult>((resolve) => {
      child!.on('exit', (code, signal) => {
        // If we're still waiting for a pending request, this is a failure.
        if (pending.size === 0 && stderrBuf === '' && code === 0) {
          // Edge case: clean exit with no pending; most likely someone else
          // already resolved. Let the winning promise take over.
          return;
        }
        const sig = signal ? ` (signal ${signal})` : '';
        resolve(fail(`server exited before handshake completed (code ${code ?? 'null'})${sig}`));
      });
    });

    const sendRequest = <T>(id: number | string, method: string, params?: unknown): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        pending.set(id, (msg) => {
          if (msg.error) {
            reject(new Error(`${method} error ${msg.error.code}: ${msg.error.message}`));
            return;
          }
          resolve(msg.result as T);
        });
        const payload: JsonRpcMessage = { jsonrpc: '2.0', id, method };
        if (params !== undefined) payload.params = params;
        child!.stdin.write(JSON.stringify(payload) + '\n');
      });

    const sendNotification = (method: string, params?: unknown): void => {
      const payload: JsonRpcMessage = { jsonrpc: '2.0', method };
      if (params !== undefined) payload.params = params;
      child!.stdin.write(JSON.stringify(payload) + '\n');
    };

    const timeout = new Promise<ValidationResult>((resolve) => {
      timer = setTimeout(() => {
        resolve(fail(`timeout waiting for MCP handshake after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const handshake = (async (): Promise<ValidationResult> => {
      // Step 1: initialize
      const init = await sendRequest<InitializeResult>(1, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });

      // Step 2: notifications/initialized (no response expected)
      sendNotification('notifications/initialized');

      // Step 3: tools/list
      const tools = await sendRequest<ToolsListResult>(2, 'tools/list');

      const toolList = Array.isArray(tools?.tools) ? tools.tools : [];
      const serverInfoName = init?.serverInfo?.name;
      const serverInfoVersion = init?.serverInfo?.version;

      const result: ValidationResult = {
        success: true,
        tools: toolList.length,
        toolNames: toolList.map((t) => t.name),
        toolDefinitions: toolList,
        latencyMs: Date.now() - startedAt,
        ...(init?.protocolVersion ? { protocolVersion: init.protocolVersion } : {}),
        ...(serverInfoName
          ? {
              serverInfo: {
                name: serverInfoName,
                ...(serverInfoVersion ? { version: serverInfoVersion } : {}),
              },
            }
          : {}),
      };
      return result;
    })().catch((err: unknown): ValidationResult => {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(msg);
    });

    // First one to resolve wins. Timeout and spawnError both produce failure
    // results; handshake produces either success or failure.
    return await Promise.race([handshake, timeout, spawnError, earlyExit]);
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) {
      // Graceful termination: SIGTERM, wait, then SIGKILL if still alive.
      try {
        child.stdin.end();
      } catch { /* ignore */ }
      try {
        child.kill('SIGTERM');
      } catch { /* ignore */ }
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            child!.kill('SIGKILL');
          } catch { /* ignore */ }
          resolve();
        }, SIGTERM_GRACE_MS);
        child!.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    }
  }
}
