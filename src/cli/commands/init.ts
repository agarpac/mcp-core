import fs from 'fs';
import os from 'os';
import { Command } from 'commander';
import { CLIENT_ADAPTERS, ClientAdapter, getClientConfigPath } from '../../config/paths';
import { ConfigStore } from '../../config/store';

/* ------------------------------------------------------------------ *
 * Constants                                                           *
 * ------------------------------------------------------------------ */

const GATEWAY_NAME = 'mcp-core';
const GATEWAY_BINARY = 'mcp-core-mcp';

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

export interface ClientInitResult {
  client: string;
  displayName: string;
  /** Overall outcome for this client. */
  status: 'done' | 'already-up-to-date' | 'skipped-no-config' | 'skipped-unsupported-os' | 'error';
  /** Names of servers that were imported into the central config store. */
  migratedServers: string[];
  path?: string;
  error?: string;
}

export interface InitOptions {
  /** Restrict to these client IDs. Defaults to all detected clients. */
  clients?: string[];
  /**
   * Override the gateway binary name. Useful in tests so we don't require a
   * real `mcp-core-mcp` binary on PATH.
   */
  selfBinary?: string;
}

/* ------------------------------------------------------------------ *
 * Entry normalisation (shared with old init)                          *
 * ------------------------------------------------------------------ */

interface NormalisedEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function normaliseEntry(raw: unknown): NormalisedEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const cmd = entry.command;
  const env = (entry.env as Record<string, string> | undefined) ?? undefined;
  if (typeof cmd === 'string') {
    const args = Array.isArray(entry.args) ? (entry.args as string[]) : [];
    return { command: cmd, args, env };
  }
  if (Array.isArray(cmd) && cmd.length > 0 && typeof cmd[0] === 'string') {
    return { command: cmd[0] as string, args: cmd.slice(1) as string[], env };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Per-client init logic                                               *
 * ------------------------------------------------------------------ */

function processClient(
  clientId: string,
  adapter: ClientAdapter,
  configPath: string,
  gatewayBinary: string,
): ClientInitResult {
  const migratedServers: string[] = [];

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err: any) {
    return { client: clientId, displayName: adapter.displayName, status: 'error', migratedServers, path: configPath, error: err.message };
  }

  const config = raw.trim() ? JSON.parse(raw) : {};
  const servers = adapter.readServers(config);
  const serverEntries = Object.entries(servers);

  // Nothing to do: single gateway entry already present
  if (
    serverEntries.length === 1 &&
    serverEntries[0]![0] === GATEWAY_NAME
  ) {
    return { client: clientId, displayName: adapter.displayName, status: 'already-up-to-date', migratedServers, path: configPath };
  }

  // Migrate non-gateway entries to central config store
  const coreConfig = ConfigStore.get();
  for (const [serverName, rawEntry] of serverEntries) {
    if (serverName === GATEWAY_NAME) continue;  // skip existing gateway entry

    const parsed = normaliseEntry(rawEntry);
    if (!parsed) continue;

    // Legacy mcp-proxy entries are already in ConfigStore from a previous init run
    if (parsed.command === 'mcp-proxy' || parsed.command === GATEWAY_BINARY) continue;

    // Import new server into ConfigStore if not already registered
    if (!coreConfig.servers[serverName]) {
      ConfigStore.addServer(serverName, {
        command: parsed.command,
        args: parsed.args,
        ...(parsed.env ? { env: parsed.env } : {}),
      });
      migratedServers.push(serverName);
    }
  }

  // Build new config with ONLY the gateway entry
  const gatewayRecord = adapter.serialize({
    name: GATEWAY_NAME,
    command: gatewayBinary,
    args: [],
  });

  // Start from an empty server map, then inject gateway
  let newConfig = adapter.removeServer(config, GATEWAY_NAME);  // remove any existing gateway entry first
  // Remove all other entries
  for (const [serverName] of serverEntries) {
    if (serverName !== GATEWAY_NAME) {
      newConfig = adapter.removeServer(newConfig, serverName);
    }
  }
  newConfig = adapter.writeServer(newConfig, GATEWAY_NAME, gatewayRecord);

  // Backup + write
  try {
    fs.copyFileSync(configPath, `${configPath}.backup`);
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
  } catch (err: any) {
    return { client: clientId, displayName: adapter.displayName, status: 'error', migratedServers, path: configPath, error: err.message };
  }

  return { client: clientId, displayName: adapter.displayName, status: 'done', migratedServers, path: configPath };
}

/* ------------------------------------------------------------------ *
 * Public API                                                          *
 * ------------------------------------------------------------------ */

export function runInit(opts: InitOptions = {}): ClientInitResult[] {
  ConfigStore.initialize();

  const gatewayBinary = opts.selfBinary ?? GATEWAY_BINARY;
  const targetIds = opts.clients && opts.clients.length > 0 ? opts.clients : Object.keys(CLIENT_ADAPTERS);
  const results: ClientInitResult[] = [];

  for (const clientId of targetIds) {
    const adapter = CLIENT_ADAPTERS[clientId];
    if (!adapter) {
      results.push({ client: clientId, displayName: clientId, status: 'error', migratedServers: [], error: 'Unknown client' });
      continue;
    }

    const platform = os.platform();
    if (platform !== 'darwin' && platform !== 'linux') {
      results.push({ client: clientId, displayName: adapter.displayName, status: 'skipped-unsupported-os', migratedServers: [] });
      continue;
    }
    const configPath = adapter.configPath[platform] ?? null;
    if (!configPath) {
      results.push({ client: clientId, displayName: adapter.displayName, status: 'skipped-unsupported-os', migratedServers: [] });
      continue;
    }
    if (!fs.existsSync(configPath)) {
      results.push({ client: clientId, displayName: adapter.displayName, status: 'skipped-no-config', migratedServers: [], path: configPath });
      continue;
    }

    results.push(processClient(clientId, adapter, configPath, gatewayBinary));
  }

  return results;
}

/* ------------------------------------------------------------------ *
 * Command registration                                                *
 * ------------------------------------------------------------------ */

function printInitResults(results: ClientInitResult[]): void {
  let done = 0;
  let migrated = 0;
  for (const r of results) {
    switch (r.status) {
      case 'done':
        console.log(`  ✓ ${r.displayName.padEnd(20)}  gateway entry injected${r.migratedServers.length > 0 ? `, migrated: ${r.migratedServers.join(', ')}` : ''}`);
        done++;
        migrated += r.migratedServers.length;
        break;
      case 'already-up-to-date':
        console.log(`  · ${r.displayName.padEnd(20)}  already up-to-date`);
        break;
      case 'skipped-no-config':
        console.log(`  · ${r.displayName.padEnd(20)}  (no config file, skipped)`);
        break;
      case 'skipped-unsupported-os':
        console.log(`  · ${r.displayName.padEnd(20)}  (unsupported on this OS)`);
        break;
      case 'error':
        console.log(`  ✗ ${r.displayName.padEnd(20)}  error: ${r.error}`);
        break;
    }
  }
  console.log(`\nGateway injected into ${done} client(s). Servers migrated: ${migrated}.`);
}

export function addInitCommand(program: Command) {
  program
    .command('init')
    .description('Bootstrap the mcp-core gateway: injects one entry per client and migrates existing servers')
    .option('--clients <ids>', 'Comma-separated client IDs to target', (v, acc: string[]) => [...acc, ...v.split(',').map((s) => s.trim()).filter(Boolean)], [] as string[])
    .action((opts) => {
      try {
        const results = runInit({ clients: (opts.clients as string[]).length > 0 ? opts.clients : undefined });
        printInitResults(results);
        const hasErrors = results.some((r) => r.status === 'error');
        if (hasErrors) process.exit(1);
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });
}
