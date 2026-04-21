import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pingDaemon } from '../../src/cli/commands/status';

function startFakeDaemon(socketPath: string, handler: (line: string, socket: net.Socket) => void) {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) handler(line, socket);
      }
    });
  });
  const listening = new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
  return {
    server,
    listening,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('pingDaemon', () => {
  let tmpDir: string;
  let socketPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-core-status-test-'));
    socketPath = path.join(tmpDir, 'daemon.sock');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns null when the socket file does not exist', async () => {
    const res = await pingDaemon(socketPath, 100);
    expect(res).toBeNull();
  });

  it('resolves with uptime on a valid pong', async () => {
    const fake = startFakeDaemon(socketPath, (line, socket) => {
      const msg = JSON.parse(line);
      if (msg.type === 'ping') {
        socket.write(JSON.stringify({ type: 'pong', uptime: 12345 }) + '\n');
      }
    });
    await fake.listening;
    try {
      const res = await pingDaemon(socketPath, 500);
      expect(res).toEqual({ uptime: 12345 });
    } finally {
      await fake.close();
    }
  });

  it('returns null when the peer never responds within the timeout', async () => {
    const fake = startFakeDaemon(socketPath, () => { /* silent */ });
    await fake.listening;
    try {
      const res = await pingDaemon(socketPath, 80);
      expect(res).toBeNull();
    } finally {
      await fake.close();
    }
  });
});

describe('status CLI registration', () => {
  it('is registered under the mcp-core program', async () => {
    vi.resetModules();
    const { createCLI } = await import('../../src/cli/index');
    const program = createCLI();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('status');
  });
});
