import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── os.platform() → always 'darwin' ──────────────────────────────────────────
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, default: { ...actual, platform: () => 'darwin', homedir: actual.homedir } };
});

// ── fs mocks ──────────────────────────────────────────────────────────────────
const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, ...fsMocks },
    ...fsMocks,
  };
});

// ── ConfigStore mock ──────────────────────────────────────────────────────────
const storeMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  get: vi.fn(() => ({ servers: {}, version: '1.0.0' })),
  addServer: vi.fn(),
}));

vi.mock('../../src/config/store', () => ({
  ConfigStore: storeMocks,
}));

// ── CLIENT_ADAPTERS mock ──────────────────────────────────────────────────────
// Provides a single 'cursor' adapter pointing to a fixed test path.
const CURSOR_PATH = '/tmp/test-cursor-mcp.json';

vi.mock('../../src/config/paths', () => ({
  CLIENT_ADAPTERS: {
    cursor: {
      id: 'cursor',
      displayName: 'Cursor',
      configPath: { darwin: '/tmp/test-cursor-mcp.json', linux: '/tmp/test-cursor-mcp.json' },
      rootKey: 'mcpServers',
      serialize: ({ command, args }: { command: string; args: string[] }) => ({ command, args }),
      readServers: (config: unknown): Record<string, unknown> => {
        if (!config || typeof config !== 'object') return {};
        const value = (config as Record<string, unknown>)['mcpServers'];
        if (!value || typeof value !== 'object') return {};
        return value as Record<string, unknown>;
      },
      writeServer: (config: unknown, name: string, record: unknown): unknown => {
        const base: Record<string, unknown> =
          config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
        const inner: Record<string, unknown> = { ...((base['mcpServers'] as Record<string, unknown>) || {}) };
        inner[name] = record;
        base['mcpServers'] = inner;
        return base;
      },
      removeServer: (config: unknown, name: string): unknown => {
        const base: Record<string, unknown> =
          config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {};
        const existing = base['mcpServers'];
        if (existing && typeof existing === 'object') {
          const inner = { ...(existing as Record<string, unknown>) };
          delete inner[name];
          base['mcpServers'] = inner;
        }
        return base;
      },
    },
  },
  getClientConfigPath: vi.fn(() => '/tmp/test-cursor-mcp.json'),
}));

import { runInit } from '../../src/cli/commands/init';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCursorConfig(servers: Record<string, unknown>) {
  return JSON.stringify({ mcpServers: servers });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('runInit — fresh install (no prior entries)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('{}');
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
  });

  it('returns status=done when config is empty', () => {
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.status).toBe('done');
  });

  it('writes only the gateway entry to the config file', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(fsMocks.writeFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(fsMocks.writeFileSync.mock.calls[0]![1] as string);
    expect(Object.keys(written.mcpServers)).toEqual(['mcp-core']);
    expect(written.mcpServers['mcp-core'].command).toBe('mcp-core-mcp');
  });

  it('creates a backup before writing', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(fsMocks.copyFileSync).toHaveBeenCalledWith(CURSOR_PATH, `${CURSOR_PATH}.backup`);
  });

  it('returns empty migratedServers when config has no entries', () => {
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.migratedServers).toEqual([]);
  });
});

describe('runInit — legacy server migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    fsMocks.readFileSync.mockReturnValue(
      makeCursorConfig({
        memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
        postgres: { command: 'uvx', args: ['mcp-server-postgres'] },
      })
    );
  });

  it('migrates legacy servers to ConfigStore', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(storeMocks.addServer).toHaveBeenCalledWith('memory', expect.objectContaining({ command: 'npx' }));
    expect(storeMocks.addServer).toHaveBeenCalledWith('postgres', expect.objectContaining({ command: 'uvx' }));
  });

  it('returns migratedServers list', () => {
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.migratedServers).toContain('memory');
    expect(r.migratedServers).toContain('postgres');
  });

  it('removes all legacy entries from the client config', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    const written = JSON.parse(fsMocks.writeFileSync.mock.calls[0]![1] as string);
    expect(written.mcpServers).not.toHaveProperty('memory');
    expect(written.mcpServers).not.toHaveProperty('postgres');
    expect(written.mcpServers).toHaveProperty('mcp-core');
  });

  it('does NOT migrate servers already in ConfigStore', () => {
    storeMocks.get.mockReturnValue({
      servers: { memory: { command: 'npx', args: [] } },
      version: '1.0.0',
    });
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(storeMocks.addServer).not.toHaveBeenCalledWith('memory', expect.anything());
  });
});

describe('runInit — legacy proxy entries are skipped', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
  });

  it('skips mcp-proxy entries (already migrated previously)', () => {
    fsMocks.readFileSync.mockReturnValue(
      makeCursorConfig({
        memory: { command: 'mcp-proxy', args: ['memory'] },
      })
    );
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(storeMocks.addServer).not.toHaveBeenCalled();
  });

  it('skips mcp-core-mcp gateway binary entries', () => {
    fsMocks.readFileSync.mockReturnValue(
      makeCursorConfig({
        gateway: { command: 'mcp-core-mcp', args: [] },
      })
    );
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(storeMocks.addServer).not.toHaveBeenCalled();
  });
});

describe('runInit — already up-to-date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    fsMocks.readFileSync.mockReturnValue(
      makeCursorConfig({ 'mcp-core': { command: 'mcp-core-mcp', args: [] } })
    );
  });

  it('returns status=already-up-to-date when only gateway entry exists', () => {
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.status).toBe('already-up-to-date');
  });

  it('does NOT write or backup the file when already up-to-date', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(fsMocks.copyFileSync).not.toHaveBeenCalled();
  });
});

describe('runInit — skipped (no config file)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(false);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
  });

  it('returns status=skipped-no-config when config file is absent', () => {
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.status).toBe('skipped-no-config');
  });
});

describe('runInit — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
  });

  it('returns status=error when config file cannot be read', () => {
    fsMocks.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/EACCES/);
  });

  it('returns status=error for unknown client id', () => {
    const results = runInit({ clients: ['nonexistent'], selfBinary: 'mcp-core-mcp' });
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.error).toMatch(/Unknown client/);
  });

  it('returns status=error when writeFileSync fails', () => {
    fsMocks.readFileSync.mockReturnValue('{}');
    fsMocks.writeFileSync.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    const results = runInit({ selfBinary: 'mcp-core-mcp' });
    const r = results.find((x) => x.client === 'cursor')!;
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/ENOSPC/);
  });
});

describe('runInit — client filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('{}');
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
  });

  it('processes only specified clients when clients option is provided', () => {
    const results = runInit({ clients: ['cursor'], selfBinary: 'mcp-core-mcp' });
    expect(results).toHaveLength(1);
    expect(results[0]!.client).toBe('cursor');
  });
});

describe('runInit — env vars preserved during migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    storeMocks.get.mockReturnValue({ servers: {}, version: '1.0.0' });
    fsMocks.readFileSync.mockReturnValue(
      makeCursorConfig({
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'ghp_test' },
        },
      })
    );
  });

  it('preserves env vars when migrating to ConfigStore', () => {
    runInit({ selfBinary: 'mcp-core-mcp' });
    expect(storeMocks.addServer).toHaveBeenCalledWith(
      'github',
      expect.objectContaining({ env: { GITHUB_TOKEN: 'ghp_test' } })
    );
  });
});
