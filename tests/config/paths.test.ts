import { describe, it, expect, afterEach } from 'vitest';
import os from 'os';
import path from 'path';

import {
  CORE_DIR,
  CORE_CONFIG_FILE,
  SERVERS_DIR,
  LOGS_DIR,
  DAEMON_SOCKET,
  CLIENT_ADAPTERS,
  getClientConfigPath,
} from '../../src/config/paths';

describe('paths.ts', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('Constants', () => {
    it('CORE_DIR is in homedir', () => {
      expect(CORE_DIR).toContain('.mcp-core');
    });

    it('other dirs derive from CORE_DIR', () => {
      expect(CORE_CONFIG_FILE).toBe(path.join(CORE_DIR, 'config.json'));
      expect(SERVERS_DIR).toBe(path.join(CORE_DIR, 'servers'));
      expect(LOGS_DIR).toBe(path.join(CORE_DIR, 'logs'));
      expect(DAEMON_SOCKET).toBe(path.join(CORE_DIR, 'daemon.sock'));
    });
  });

  describe('CLIENT_ADAPTERS registry', () => {
    it('exposes cursor, vscode, opencode, claudeDesktop, claudeCode adapters', () => {
      expect(CLIENT_ADAPTERS.cursor).toBeDefined();
      expect(CLIENT_ADAPTERS.vscode).toBeDefined();
      expect(CLIENT_ADAPTERS.opencode).toBeDefined();
      expect(CLIENT_ADAPTERS.claudeDesktop).toBeDefined();
      expect(CLIENT_ADAPTERS.claudeCode).toBeDefined();
    });

    it('no longer exposes chatgpt', () => {
      expect((CLIENT_ADAPTERS as any).chatgpt).toBeUndefined();
    });
  });

  describe('cursor adapter', () => {
    it('uses ~/.cursor/mcp.json on darwin and linux', () => {
      const home = os.homedir();
      expect(CLIENT_ADAPTERS.cursor.configPath.darwin).toBe(path.join(home, '.cursor', 'mcp.json'));
      expect(CLIENT_ADAPTERS.cursor.configPath.linux).toBe(path.join(home, '.cursor', 'mcp.json'));
    });

    it('rootKey is mcpServers', () => {
      expect(CLIENT_ADAPTERS.cursor.rootKey).toBe('mcpServers');
    });

    it('serialize returns { command, args } string-based shape', () => {
      const out = CLIENT_ADAPTERS.cursor.serialize({ name: 's', command: '/bin/foo', args: ['a'] });
      expect(out).toEqual({ command: '/bin/foo', args: ['a'] });
    });

    it('writeServer merges into mcpServers map', () => {
      const cfg = { mcpServers: { existing: { command: 'x', args: [] } } };
      const updated = CLIENT_ADAPTERS.cursor.writeServer(cfg, 's', { command: '/bin/foo', args: ['a'] }) as any;
      expect(updated.mcpServers.existing).toEqual({ command: 'x', args: [] });
      expect(updated.mcpServers.s).toEqual({ command: '/bin/foo', args: ['a'] });
    });

    it('writeServer creates mcpServers key when missing', () => {
      const updated = CLIENT_ADAPTERS.cursor.writeServer({}, 's', { command: 'c', args: [] }) as any;
      expect(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
    });

    it('removeServer deletes entry', () => {
      const cfg = { mcpServers: { s: { command: 'c', args: [] }, t: { command: 'c2', args: [] } } };
      const updated = CLIENT_ADAPTERS.cursor.removeServer(cfg, 's') as any;
      expect(updated.mcpServers.s).toBeUndefined();
      expect(updated.mcpServers.t).toBeDefined();
    });

    it('readServers returns mcpServers map', () => {
      const cfg = { mcpServers: { s: { command: 'c', args: [] } } };
      expect(CLIENT_ADAPTERS.cursor.readServers(cfg)).toEqual({ s: { command: 'c', args: [] } });
    });

    it('readServers returns empty object for malformed config', () => {
      expect(CLIENT_ADAPTERS.cursor.readServers(null)).toEqual({});
      expect(CLIENT_ADAPTERS.cursor.readServers({})).toEqual({});
    });
  });

  describe('vscode adapter', () => {
    it('uses ~/Library/Application Support/Code/User/mcp.json on darwin', () => {
      const home = os.homedir();
      expect(CLIENT_ADAPTERS.vscode.configPath.darwin).toBe(
        path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      );
    });

    it('uses ~/.config/Code/User/mcp.json on linux', () => {
      const home = os.homedir();
      expect(CLIENT_ADAPTERS.vscode.configPath.linux).toBe(
        path.join(home, '.config', 'Code', 'User', 'mcp.json')
      );
    });

    it('rootKey is servers (not mcpServers)', () => {
      expect(CLIENT_ADAPTERS.vscode.rootKey).toBe('servers');
    });

    it('writeServer writes under servers key', () => {
      const updated = CLIENT_ADAPTERS.vscode.writeServer({}, 's', { command: 'c', args: ['a'] }) as any;
      expect(updated.servers.s).toEqual({ command: 'c', args: ['a'] });
    });

    it('removeServer deletes under servers key', () => {
      const cfg = { servers: { s: { command: 'c', args: [] } } };
      const updated = CLIENT_ADAPTERS.vscode.removeServer(cfg, 's') as any;
      expect(updated.servers.s).toBeUndefined();
    });
  });

  describe('opencode adapter', () => {
    it('uses ~/.config/opencode/opencode.json on darwin and linux', () => {
      const home = os.homedir();
      expect(CLIENT_ADAPTERS.opencode.configPath.darwin).toBe(
        path.join(home, '.config', 'opencode', 'opencode.json')
      );
      expect(CLIENT_ADAPTERS.opencode.configPath.linux).toBe(
        path.join(home, '.config', 'opencode', 'opencode.json')
      );
    });

    it('rootKey is mcp (not mcpServers)', () => {
      expect(CLIENT_ADAPTERS.opencode.rootKey).toBe('mcp');
    });

    it('serialize returns { type: "local", command: [cmd, ...args] } array shape', () => {
      const out = CLIENT_ADAPTERS.opencode.serialize({ name: 's', command: '/bin/foo', args: ['a', 'b'] });
      expect(out).toEqual({ type: 'local', command: ['/bin/foo', 'a', 'b'] });
    });

    it('writeServer writes under mcp key using array command', () => {
      const updated = CLIENT_ADAPTERS.opencode.writeServer({}, 's', {
        type: 'local',
        command: ['/bin/foo', 'a'],
      }) as any;
      expect(updated.mcp.s).toEqual({ type: 'local', command: ['/bin/foo', 'a'] });
    });

    it('removeServer deletes under mcp key', () => {
      const cfg = { mcp: { s: { type: 'local', command: ['x'] } } };
      const updated = CLIENT_ADAPTERS.opencode.removeServer(cfg, 's') as any;
      expect(updated.mcp.s).toBeUndefined();
    });

    it('readServers returns mcp map', () => {
      const cfg = { mcp: { s: { type: 'local', command: ['x'] } } };
      expect(CLIENT_ADAPTERS.opencode.readServers(cfg)).toEqual({ s: { type: 'local', command: ['x'] } });
    });
  });

  describe('claudeDesktop adapter', () => {
    it('uses darwin path and linux=null (unsupported)', () => {
      const home = os.homedir();
      expect(CLIENT_ADAPTERS.claudeDesktop.configPath.darwin).toBe(
        path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      );
      expect(CLIENT_ADAPTERS.claudeDesktop.configPath.linux).toBeNull();
    });

    it('rootKey is mcpServers', () => {
      expect(CLIENT_ADAPTERS.claudeDesktop.rootKey).toBe('mcpServers');
    });

    it('writeServer writes under mcpServers', () => {
      const updated = CLIENT_ADAPTERS.claudeDesktop.writeServer({}, 's', { command: 'c', args: [] }) as any;
      expect(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
    });
  });

  describe('claudeCode adapter (project scope)', () => {
    it('uses ./.mcp.json regardless of OS (relative to CWD)', () => {
      // project-scope file lives at the project root; adapter returns relative path
      expect(CLIENT_ADAPTERS.claudeCode.configPath.darwin).toBe(path.resolve(process.cwd(), '.mcp.json'));
      expect(CLIENT_ADAPTERS.claudeCode.configPath.linux).toBe(path.resolve(process.cwd(), '.mcp.json'));
    });

    it('rootKey is mcpServers', () => {
      expect(CLIENT_ADAPTERS.claudeCode.rootKey).toBe('mcpServers');
    });

    it('serialize returns { command, args } shape', () => {
      const out = CLIENT_ADAPTERS.claudeCode.serialize({ name: 's', command: 'c', args: ['a'] });
      expect(out).toEqual({ command: 'c', args: ['a'] });
    });

    it('writeServer and removeServer operate on mcpServers', () => {
      const updated = CLIENT_ADAPTERS.claudeCode.writeServer({}, 's', { command: 'c', args: [] }) as any;
      expect(updated.mcpServers.s).toEqual({ command: 'c', args: [] });
      const removed = CLIENT_ADAPTERS.claudeCode.removeServer(updated, 's') as any;
      expect(removed.mcpServers.s).toBeUndefined();
    });
  });

  describe('getClientConfigPath', () => {
    it('returns darwin path when platform is darwin', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const p = getClientConfigPath('cursor');
      expect(p).toBe(CLIENT_ADAPTERS.cursor.configPath.darwin);
    });

    it('returns linux path when platform is linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const p = getClientConfigPath('vscode');
      expect(p).toBe(CLIENT_ADAPTERS.vscode.configPath.linux);
    });

    it('returns null for claudeDesktop on linux (unsupported)', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(getClientConfigPath('claudeDesktop')).toBeNull();
    });

    it('returns null for unknown platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      expect(getClientConfigPath('opencode')).toBeNull();
    });

    it('returns null for unknown client', () => {
      expect(getClientConfigPath('nonexistent')).toBeNull();
    });
  });
});
