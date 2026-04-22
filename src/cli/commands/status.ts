import net from 'net';
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { DAEMON_SOCKET, CORE_DIR, CLIENT_ADAPTERS, getClientConfigPath } from '../../config/paths';
import { ConfigStore } from '../../config/store';
import { detectRuntimes } from '../../utils/runtime';

const DAEMON_PID_FILE = path.join(CORE_DIR, 'daemon.pid');

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptimeMs: number | null;
  socketPath: string;
}

export interface ActiveServersInfo {
  active: string[];
  cached: string[];
}

/**
 * Ask the daemon which backend processes are alive and which are in the
 * capability cache. Resolves to null if the daemon is unreachable.
 */
export function queryActiveServers(socketPath: string, timeoutMs = 1000): Promise<ActiveServersInfo | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(null);
    const socket = net.createConnection({ path: socketPath });
    let buf = '';
    const done = (value: ActiveServersInfo | null) => {
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'getActiveServers' }) + '\n');
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      try {
        const msg = JSON.parse(buf.slice(0, idx));
        clearTimeout(timer);
        if (msg?.type === 'getActiveServers_response') {
          done({ active: msg.active ?? [], cached: msg.cached ?? [] });
        } else {
          done(null);
        }
      } catch {
        clearTimeout(timer);
        done(null);
      }
    });
    socket.on('error', () => { clearTimeout(timer); done(null); });
  });
}

/**
 * Ask the daemon to stop a specific backend process. The process returns to
 * idle state and will be relaunched lazily on the next tool call.
 * Resolves to false if the daemon is unreachable or the server is not running.
 */
export function stopBackend(socketPath: string, name: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(false);
    const socket = net.createConnection({ path: socketPath });
    let buf = '';
    const done = (value: boolean) => {
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'stopBackend', name }) + '\n');
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      try {
        const msg = JSON.parse(buf.slice(0, idx));
        clearTimeout(timer);
        done(msg?.type === 'stopBackend_response' && msg.success === true);
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
    socket.on('error', () => { clearTimeout(timer); done(false); });
  });
}

/**
 * Ping the daemon over its UNIX socket. Resolves to null if unreachable.
 * The daemon responds to `{"type":"ping"}` with `{"type":"pong","uptime":N}`
 * without requiring a handshake.
 */
export function pingDaemon(socketPath: string, timeoutMs = 500): Promise<{ uptime: number } | null> {
  return new Promise((resolve) => {
    if (!fs.existsSync(socketPath)) return resolve(null);

    const socket = net.createConnection({ path: socketPath });
    let buf = '';
    const done = (value: { uptime: number } | null) => {
      try { socket.destroy(); } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => done(null), timeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ type: 'ping' }) + '\n');
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      try {
        const msg = JSON.parse(buf.slice(0, idx));
        clearTimeout(timer);
        if (msg?.type === 'pong' && typeof msg.uptime === 'number') {
          done({ uptime: msg.uptime });
        } else {
          done(null);
        }
      } catch {
        clearTimeout(timer);
        done(null);
      }
    });
    socket.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
  });
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const pingResult = await pingDaemon(DAEMON_SOCKET);
  let pid: number | null = null;
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try {
      const raw = fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) pid = n;
    } catch {}
  }
  return {
    running: pingResult !== null,
    pid,
    uptimeMs: pingResult?.uptime ?? null,
    socketPath: DAEMON_SOCKET,
  };
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export async function runStatus(): Promise<void> {
  const [daemon, activeInfo] = await Promise.all([
    getDaemonStatus(),
    queryActiveServers(DAEMON_SOCKET),
  ]);

  console.log('\n== mcp-core status ==\n');
  console.log(`Daemon:  ${daemon.running ? '🟢 running' : '🔴 stopped'}`);
  console.log(`Socket:  ${daemon.socketPath}`);
  if (daemon.pid) console.log(`PID:     ${daemon.pid}`);
  if (daemon.uptimeMs !== null) console.log(`Uptime:  ${formatUptime(daemon.uptimeMs)}`);

  ConfigStore.initialize();
  const servers = ConfigStore.get().servers ?? {};
  const names = Object.keys(servers);
  console.log(`\nServers registered in mcp-core: ${names.length}`);
  for (const name of names) {
    const cfg = servers[name];
    if (!cfg) continue;
    const isActive = activeInfo?.active.includes(name) ?? false;
    const isCached = activeInfo?.cached.includes(name) ?? false;
    const stateIcon = isActive ? '🟢' : isCached ? '🟡' : '⚪';
    const stateLabel = isActive ? 'running' : isCached ? 'cached' : 'idle';
    console.log(`  ${stateIcon} ${name.padEnd(16)}  [${stateLabel}]  ${cfg.command} ${(cfg.args || []).join(' ')}`);
  }

  console.log('\nClients detected on this OS:');
  for (const [clientId, adapter] of Object.entries(CLIENT_ADAPTERS)) {
    const configPath = getClientConfigPath(clientId);
    if (!configPath) {
      console.log(`  · ${adapter.displayName.padEnd(18)}  (not supported on this OS)`);
      continue;
    }
    const exists = fs.existsSync(configPath);
    console.log(`  ${exists ? '✓' : '·'} ${adapter.displayName.padEnd(18)}  ${configPath}`);
  }

  console.log('\nRuntimes available:');
  try {
    const report = await detectRuntimes();
    for (const info of Object.values(report.runtimes)) {
      const marker = info.available ? '✓' : '✗';
      const version = info.version ?? '—';
      console.log(`  ${marker} ${info.name.padEnd(10)}  ${version}`);
    }
  } catch (err: any) {
    console.log(`  (runtime detection failed: ${err.message})`);
  }

  console.log('');
}

export function addStatusCommand(program: Command) {
  program
    .command('status')
    .description('Muestra el estado del daemon, servidores registrados y clientes detectados')
    .action(async () => {
      try {
        await runStatus();
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
    });
}
