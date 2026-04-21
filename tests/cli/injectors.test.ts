import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

vi.mock('../../src/config/paths', () => {
  const mockAdapter = (id: string, rootKey: string, configPath: string, serialize: (s: any) => any) => ({
    id,
    displayName: id,
    configPath: { darwin: configPath, linux: configPath },
    rootKey,
    serialize,
    readServers(config: any) {
      return (config && config[rootKey]) || {};
    },
    writeServer(config: any, name: string, record: any) {
      const next = { ...(config || {}) };
      next[rootKey] = { ...(next[rootKey] || {}), [name]: record };
      return next;
    },
    removeServer(config: any, name: string) {
      const next = { ...(config || {}) };
      if (next[rootKey]) {
        const inner = { ...next[rootKey] };
        delete inner[name];
        next[rootKey] = inner;
      }
      return next;
    },
  });

  const CLIENT_ADAPTERS: Record<string, any> = {
    cursor: mockAdapter('cursor', 'mcpServers', '/mock/cursor.json', (s: any) => ({
      command: s.command,
      args: s.args,
    })),
    opencode: mockAdapter('opencode', 'mcp', '/mock/opencode.json', (s: any) => ({
      type: 'local',
      command: [s.command, ...s.args],
    })),
  };

  return {
    CLIENT_ADAPTERS,
    getClientConfigPath: (id: string) => CLIENT_ADAPTERS[id]?.configPath.darwin ?? null,
  };
});

import { toggleClientServer } from '../../src/cli/injectors/index';

describe('toggleClientServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enable=true adds proxy entry to the specified client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({}));
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    toggleClientServer('test-server', 'opencode', true);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [pathArg, content] = writeSpy.mock.calls[0]!;
    expect(pathArg).toBe('/mock/opencode.json');
    const parsed = JSON.parse(content as string);
    expect(parsed.mcp['test-server']).toEqual({
      type: 'local',
      command: ['mcp-proxy', 'test-server'],
    });
  });

  it('enable=false removes entry from the specified client', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ mcpServers: { 'test-server': { command: 'mcp-proxy' } } })
    );
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    toggleClientServer('test-server', 'cursor', false);

    const [, content] = writeSpy.mock.calls[0]!;
    const parsed = JSON.parse(content as string);
    expect(parsed.mcpServers['test-server']).toBeUndefined();
  });

  it('throws when client is unknown', () => {
    expect(() => toggleClientServer('s', 'unknown-client', true)).toThrow(/Unknown client/);
  });

  it('throws when config file does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => toggleClientServer('s', 'cursor', true)).toThrow(/not found/);
  });
});
