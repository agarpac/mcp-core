import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { Command } from 'commander';
import { DAEMON_SOCKET, CORE_DIR, LOGS_DIR } from '../../config/paths';
import { isProcessAlive } from '../../daemon/index';

const DAEMON_PID_FILE = path.join(CORE_DIR, 'daemon.pid');

export type DaemonStopResult =
  | { status: 'stopped'; pid: number }
  | { status: 'not-running' }
  | { status: 'stale-cleaned'; pid: number }
  | { status: 'signal-failed'; pid: number; error: string };

/**
 * Read PID from the daemon.pid file. Returns null if absent or unparseable.
 */
export function readDaemonPid(pidFile: string = DAEMON_PID_FILE): number | null {
  if (!fs.existsSync(pidFile)) return null;
  try {
    const raw = fs.readFileSync(pidFile, 'utf-8').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  return false;
}

/**
 * Stop the daemon gracefully: SIGTERM → wait → SIGKILL if still alive.
 * Cleans up PID file and socket on success.
 */
export async function stopDaemon(options: {
  pidFile?: string;
  socketPath?: string;
  graceMs?: number;
} = {}): Promise<DaemonStopResult> {
  const pidFile = options.pidFile ?? DAEMON_PID_FILE;
  const socketPath = options.socketPath ?? DAEMON_SOCKET;
  const graceMs = options.graceMs ?? 3000;

  const pid = readDaemonPid(pidFile);
  if (pid === null) return { status: 'not-running' };

  if (!isProcessAlive(pid)) {
    // Stale pidfile — clean it up.
    try { fs.unlinkSync(pidFile); } catch {}
    try { fs.unlinkSync(socketPath); } catch {}
    return { status: 'stale-cleaned', pid };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: any) {
    return { status: 'signal-failed', pid, error: err.message ?? String(err) };
  }

  const exited = await waitForExit(pid, graceMs);
  if (!exited) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    await waitForExit(pid, 500);
  }

  // Belt-and-suspenders cleanup (the daemon should clean these itself on exit).
  try { fs.unlinkSync(pidFile); } catch {}
  try { fs.unlinkSync(socketPath); } catch {}

  return { status: 'stopped', pid };
}

/**
 * Restart the daemon: stop it (if running), then spawn a new detached instance.
 * Returns the new PID once the daemon has recreated the socket file.
 */
export async function restartDaemon(): Promise<{ previous: DaemonStopResult; newPid: number | null }> {
  const previous = await stopDaemon();
  // Brief pause so the kernel fully releases the socket file.
  await new Promise<void>((r) => setTimeout(r, 100));

  const daemonScript = path.join(__dirname, '..', '..', 'daemon', 'index.js');
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait up to 3s for the new socket to appear.
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (fs.existsSync(DAEMON_SOCKET)) {
      return { previous, newPid: readDaemonPid() };
    }
    await new Promise<void>((r) => setTimeout(r, 100));
  }
  return { previous, newPid: null };
}

/**
 * Tail a log file. If `name` is given, tails `<LOGS_DIR>/<name>.log`. Otherwise
 * lists available log files and asks the caller to pick one.
 *
 * When `follow=true`, streams new lines until interrupted.
 */
export async function tailLogs(options: {
  name?: string;
  follow?: boolean;
  lines?: number;
  logsDir?: string;
}): Promise<void> {
  const logsDir = options.logsDir ?? LOGS_DIR;
  if (!fs.existsSync(logsDir)) {
    console.error(`[daemon logs] Logs directory does not exist: ${logsDir}`);
    return;
  }

  if (!options.name) {
    const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
    if (files.length === 0) {
      console.log('(no logs yet)');
      return;
    }
    console.log('Available logs:');
    for (const f of files) console.log(`  - ${f.replace(/\.log$/, '')}`);
    return;
  }

  const file = path.join(logsDir, `${options.name}.log`);
  if (!fs.existsSync(file)) {
    console.error(`[daemon logs] No log for server '${options.name}' at ${file}`);
    return;
  }

  const content = fs.readFileSync(file, 'utf-8');
  const allLines = content.split('\n');
  const lastN = options.lines ?? 100;
  const tail = allLines.slice(-lastN).join('\n');
  process.stdout.write(tail);
  if (!tail.endsWith('\n')) process.stdout.write('\n');

  if (!options.follow) return;

  // Follow mode: watch the file and stream appended lines.
  let size = fs.statSync(file).size;
  const watcher = fs.watch(file, () => {
    try {
      const stat = fs.statSync(file);
      if (stat.size < size) {
        size = 0; // truncation
      }
      if (stat.size > size) {
        const stream = fs.createReadStream(file, { start: size, end: stat.size });
        const rl = readline.createInterface({ input: stream });
        rl.on('line', (line) => process.stdout.write(line + '\n'));
        size = stat.size;
      }
    } catch {
      /* file may have been rotated; ignore */
    }
  });

  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      watcher.close();
      resolve();
    });
  });
}

export function addDaemonCommands(program: Command) {
  const daemon = program
    .command('daemon')
    .description('Daemon lifecycle commands (stop, restart, logs)');

  daemon
    .command('stop')
    .description('Stop the running daemon')
    .action(async () => {
      const res = await stopDaemon();
      switch (res.status) {
        case 'not-running':
          console.log('Daemon is not running.');
          break;
        case 'stale-cleaned':
          console.log(`Stale PID file cleaned (PID ${res.pid} was dead).`);
          break;
        case 'signal-failed':
          console.error(`Failed to signal PID ${res.pid}: ${res.error}`);
          process.exit(1);
          break;
        case 'stopped':
          console.log(`Daemon stopped (PID ${res.pid}).`);
          break;
      }
    });

  daemon
    .command('restart')
    .description('Restart the daemon')
    .action(async () => {
      const res = await restartDaemon();
      if (res.newPid !== null) {
        console.log(`Daemon restarted (new PID ${res.newPid}).`);
      } else {
        console.log('Daemon restart initiated but socket did not appear within 3s.');
      }
    });

  daemon
    .command('logs [name]')
    .description('Tail logs for a registered server (omit name to list available logs)')
    .option('-f, --follow', 'Follow the log in real-time')
    .option('-n, --lines <count>', 'Number of lines to show from the tail', (v) => parseInt(v, 10), 100)
    .action(async (name, opts) => {
      await tailLogs({
        ...(name ? { name } : {}),
        follow: !!opts.follow,
        lines: opts.lines,
      });
    });
}
