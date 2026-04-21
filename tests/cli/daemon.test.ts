import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { stopDaemon, readDaemonPid, tailLogs } from '../../src/cli/commands/daemon';

describe('daemon stop/readDaemonPid', () => {
  let tmpDir: string;
  let pidFile: string;
  let socketPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-daemon-test-'));
    pidFile = path.join(tmpDir, 'daemon.pid');
    socketPath = path.join(tmpDir, 'daemon.sock');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('readDaemonPid returns null when pidfile missing', () => {
    expect(readDaemonPid(pidFile)).toBeNull();
  });

  it('readDaemonPid returns the number when file exists with valid pid', () => {
    fs.writeFileSync(pidFile, '42');
    expect(readDaemonPid(pidFile)).toBe(42);
  });

  it('readDaemonPid returns null when file has garbage', () => {
    fs.writeFileSync(pidFile, 'not-a-number');
    expect(readDaemonPid(pidFile)).toBeNull();
  });

  it('stopDaemon reports not-running when no pidfile exists', async () => {
    const res = await stopDaemon({ pidFile, socketPath });
    expect(res.status).toBe('not-running');
  });

  it('stopDaemon cleans stale pidfile when PID is dead', async () => {
    // 2^22 — exceeds typical pid_max
    fs.writeFileSync(pidFile, '4194303');
    fs.writeFileSync(socketPath, 'dangling');
    const res = await stopDaemon({ pidFile, socketPath });
    expect(res.status).toBe('stale-cleaned');
    expect(fs.existsSync(pidFile)).toBe(false);
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

describe('tailLogs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-logs-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('lists available logs when no name is given', async () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.log'), 'x');
    fs.writeFileSync(path.join(tmpDir, 'bar.log'), 'y');
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg?: any) => logs.push(String(msg ?? ''));
    try {
      await tailLogs({ logsDir: tmpDir });
    } finally {
      console.log = origLog;
    }
    const output = logs.join('\n');
    expect(output).toContain('foo');
    expect(output).toContain('bar');
  });

  it('prints the tail of a named log', async () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    fs.writeFileSync(path.join(tmpDir, 'srv.log'), content);

    let out = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => {
      out += s;
      return true;
    };
    try {
      await tailLogs({ name: 'srv', lines: 3, logsDir: tmpDir });
    } finally {
      (process.stdout as any).write = origWrite;
    }

    expect(out).toContain('line 20');
    expect(out).toContain('line 18');
    expect(out).not.toContain('line 1\n');
  });

  it('prints a clear message when the named log does not exist', async () => {
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (msg?: any) => errs.push(String(msg ?? ''));
    try {
      await tailLogs({ name: 'missing', logsDir: tmpDir });
    } finally {
      console.error = origErr;
    }
    expect(errs.join('\n')).toMatch(/No log for server/);
  });
});
