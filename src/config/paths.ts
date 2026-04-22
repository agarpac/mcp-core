import os from 'os';
import path from 'path';

export const CORE_DIR = path.join(os.homedir(), '.mcp-core');
export const CORE_CONFIG_FILE = path.join(CORE_DIR, 'config.json');
export const SERVERS_DIR = path.join(CORE_DIR, 'servers');
export const LOGS_DIR = path.join(CORE_DIR, 'logs');

// TODO: Windows Named Pipes si os.platform() === 'win32'
export const DAEMON_SOCKET = path.join(CORE_DIR, 'daemon.sock');

// -----------------------------------------------------------------------------
// Client Adapters Registry
// -----------------------------------------------------------------------------
//
// Each supported AI client stores MCP configuration in a different shape:
//   - Cursor          → ~/.cursor/mcp.json                { mcpServers: { <name>: { command, args } } }
//   - VS Code         → Code/User/mcp.json                { servers:    { <name>: { command, args } } }
//   - Claude Desktop  → Claude/claude_desktop_config.json { mcpServers: { <name>: { command, args } } } (macOS only)
//   - Claude Code     → ./.mcp.json (project scope)       { mcpServers: { <name>: { command, args } } }
//   - OpenCode        → ~/.config/opencode/opencode.json  { mcp:        { <name>: { type, command: [cmd, ...args] } } }
//
// The `ClientAdapter` abstraction captures these differences in one place so
// higher-level code (injectors, init scan) can operate generically.
// -----------------------------------------------------------------------------

export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
}

export interface ClientAdapter {
  /** Stable identifier used by internal APIs (e.g. 'cursor', 'vscode'). */
  id: string;
  /** Human-friendly label for logs/UI. */
  displayName: string;
  /** OS → absolute path. `null` means the client does not support that OS. */
  configPath: Record<'darwin' | 'linux', string | null>;
  /** Root JSON property under which server entries live. */
  rootKey: string;
  /** Transform a generic server spec into the shape this client expects. */
  serialize(server: ServerSpec): unknown;
  /** Extract the server map from a parsed config object. */
  readServers(config: unknown): Record<string, unknown>;
  /** Return a new config object with the server entry merged in. */
  writeServer(config: unknown, name: string, record: unknown): unknown;
  /** Return a new config object with the server entry removed. */
  removeServer(config: unknown, name: string): unknown;
}

const HOME = os.homedir();

/**
 * Default readServers implementation: pulls `config[rootKey]` as a record,
 * returning an empty object for missing/malformed configs.
 */
function defaultReadServers(rootKey: string) {
  return (config: unknown): Record<string, unknown> => {
    if (!config || typeof config !== 'object') return {};
    const value = (config as Record<string, unknown>)[rootKey];
    if (!value || typeof value !== 'object') return {};
    return value as Record<string, unknown>;
  };
}

/**
 * Default writeServer implementation: immutably merges the record under
 * `config[rootKey][name]`.
 */
function defaultWriteServer(rootKey: string) {
  return (config: unknown, name: string, record: unknown): unknown => {
    const base: Record<string, unknown> =
      config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
    const inner: Record<string, unknown> = {
      ...((base[rootKey] as Record<string, unknown>) || {}),
    };
    inner[name] = record;
    base[rootKey] = inner;
    return base;
  };
}

/**
 * Default removeServer implementation: deletes `config[rootKey][name]`.
 */
function defaultRemoveServer(rootKey: string) {
  return (config: unknown, name: string): unknown => {
    const base: Record<string, unknown> =
      config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
    const existing = base[rootKey];
    if (existing && typeof existing === 'object') {
      const inner = { ...(existing as Record<string, unknown>) };
      delete inner[name];
      base[rootKey] = inner;
    }
    return base;
  };
}

// --- Cursor ------------------------------------------------------------------
const cursorAdapter: ClientAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  configPath: {
    darwin: path.join(HOME, '.cursor', 'mcp.json'),
    linux: path.join(HOME, '.cursor', 'mcp.json'),
  },
  rootKey: 'mcpServers',
  serialize: ({ command, args }) => ({ command, args }),
  readServers: defaultReadServers('mcpServers'),
  writeServer: defaultWriteServer('mcpServers'),
  removeServer: defaultRemoveServer('mcpServers'),
};

// --- VS Code -----------------------------------------------------------------
// VS Code reads MCP config from Code/User/mcp.json (the MCP-specific file,
// NOT settings.json). Root key is `servers`, NOT `mcpServers`.
const vscodeAdapter: ClientAdapter = {
  id: 'vscode',
  displayName: 'VS Code',
  configPath: {
    darwin: path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'),
    linux: path.join(HOME, '.config', 'Code', 'User', 'mcp.json'),
  },
  rootKey: 'servers',
  serialize: ({ command, args }) => ({ command, args }),
  readServers: defaultReadServers('servers'),
  writeServer: defaultWriteServer('servers'),
  removeServer: defaultRemoveServer('servers'),
};

// --- OpenCode ----------------------------------------------------------------
// OpenCode stores MCP config at ~/.config/opencode/opencode.json under `mcp`.
// Entries use array-form command (`[cmd, ...args]`) and a `type` field.
const opencodeAdapter: ClientAdapter = {
  id: 'opencode',
  displayName: 'OpenCode (cli)',
  configPath: {
    darwin: path.join(HOME, '.config', 'opencode', 'opencode.json'),
    linux: path.join(HOME, '.config', 'opencode', 'opencode.json'),
  },
  rootKey: 'mcp',
  serialize: ({ command, args }) => ({ type: 'local', command: [command, ...args] }),
  readServers: defaultReadServers('mcp'),
  writeServer: defaultWriteServer('mcp'),
  removeServer: defaultRemoveServer('mcp'),
};

// --- Claude Desktop ----------------------------------------------------------
// Claude Desktop only exists on macOS and Windows. On Linux we expose `null`
// so higher-level code skips it cleanly.
const claudeDesktopAdapter: ClientAdapter = {
  id: 'claudeDesktop',
  displayName: 'Claude Desktop',
  configPath: {
    darwin: path.join(
      HOME,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json'
    ),
    linux: null,
  },
  rootKey: 'mcpServers',
  serialize: ({ command, args }) => ({ command, args }),
  readServers: defaultReadServers('mcpServers'),
  writeServer: defaultWriteServer('mcpServers'),
  removeServer: defaultRemoveServer('mcpServers'),
};

// --- Claude Code (user scope) ------------------------------------------------
// Claude Code CLI stores user-global MCP servers in ~/.claude.json under the
// top-level `mcpServers` key — same path on macOS and Linux.
const claudeCodeAdapter: ClientAdapter = {
  id: 'claudeCode',
  displayName: 'Claude Code',
  configPath: {
    darwin: path.join(HOME, '.claude.json'),
    linux: path.join(HOME, '.claude.json'),
  },
  rootKey: 'mcpServers',
  serialize: ({ command, args }) => ({ command, args }),
  readServers: defaultReadServers('mcpServers'),
  writeServer: defaultWriteServer('mcpServers'),
  removeServer: defaultRemoveServer('mcpServers'),
};

export const CLIENT_ADAPTERS: Record<string, ClientAdapter> = {
  cursor: cursorAdapter,
  vscode: vscodeAdapter,
  opencode: opencodeAdapter,
  claudeDesktop: claudeDesktopAdapter,
  claudeCode: claudeCodeAdapter,
};

/**
 * Return the absolute config path for the given client on the current OS,
 * or `null` if unsupported (unknown client, unsupported OS, or adapter marks
 * this OS as `null`).
 */
export function getClientConfigPath(client: string): string | null {
  const adapter = CLIENT_ADAPTERS[client];
  if (!adapter) return null;
  const platform = os.platform();
  if (platform !== 'darwin' && platform !== 'linux') return null;
  return adapter.configPath[platform] ?? null;
}

// -----------------------------------------------------------------------------
// Backwards-compatible CLIENT_PATHS export
// -----------------------------------------------------------------------------
// Some consumers (e.g. ui.ts) iterate over CLIENT_PATHS expecting a flat
// `{ client: { darwin, linux } }` map. Derive it from CLIENT_ADAPTERS to keep
// them working without modification while the migration progresses.
export const CLIENT_PATHS: Record<string, { darwin: string | null; linux: string | null }> =
  Object.fromEntries(
    Object.entries(CLIENT_ADAPTERS).map(([id, adapter]) => [id, adapter.configPath])
  );
