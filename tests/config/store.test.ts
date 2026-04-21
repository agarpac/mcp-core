import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('../../src/config/paths', () => ({
  CORE_DIR: '/mock/.mcp-core',
  CORE_CONFIG_FILE: '/mock/.mcp-core/config.json',
  SERVERS_DIR: '/mock/.mcp-core/servers',
  LOGS_DIR: '/mock/.mcp-core/logs',
}));

import { ConfigStore } from '../../src/config/store';

describe('ConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton state
    // @ts-ignore
    ConfigStore.config = undefined;
  });

  describe('initialize', () => {
    it('creates directories if they do not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

      ConfigStore.initialize();

      expect(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core', { recursive: true });
      expect(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/servers', { recursive: true });
      expect(mkdirSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/logs', { recursive: true });
      expect(writeFileSyncSpy).toHaveBeenCalled();
    });

    it('loads existing config if file exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const readFileSyncSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
        version: '1.0.0',
        servers: { 'test-server': { command: 'test', args: [] } }
      }));

      ConfigStore.initialize();
      const config = ConfigStore.get();

      expect(readFileSyncSpy).toHaveBeenCalledWith('/mock/.mcp-core/config.json', 'utf-8');
      expect(config.servers['test-server']).toBeDefined();
    });
  });

  describe('addServer & removeServer', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    });

    it('adds a server and saves', () => {
      const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync');
      
      ConfigStore.addServer('my-server', { command: 'my-cmd', args: ['--foo'] });
      
      const config = ConfigStore.get();
      expect(config.servers['my-server']).toBeDefined();
      expect(config.servers['my-server'].command).toBe('my-cmd');
      expect(writeFileSyncSpy).toHaveBeenCalled(); // 2 times: init, add
    });

    it('removes a server and saves', () => {
      ConfigStore.addServer('to-delete', { command: 'cmd', args: [] });
      let config = ConfigStore.get();
      expect(config.servers['to-delete']).toBeDefined();

      const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync');
      writeFileSyncSpy.mockClear();

      ConfigStore.removeServer('to-delete');
      config = ConfigStore.get();
      
      expect(config.servers['to-delete']).toBeUndefined();
      expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);
    });
  });
});
