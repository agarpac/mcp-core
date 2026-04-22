import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('execa', () => ({ execa: execaMock }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => JSON.stringify({ bin: './dist/index.js' })),
    },
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => JSON.stringify({ bin: './dist/index.js' })),
  };
});

const { addServerMock, getServersMock } = vi.hoisted(() => ({
  addServerMock: vi.fn(),
  getServersMock: vi.fn(),
}));

vi.mock('../../src/config/store', () => ({
  ConfigStore: {
    initialize: vi.fn(),
    addServer: addServerMock,
    get: getServersMock,
    removeServer: vi.fn(),
  },
}));

vi.mock('../../src/daemon/notify', () => ({
  notifyDaemon: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/cli/injectors/index', () => ({
  addServerToClients: vi.fn(),
  removeServerFromClients: vi.fn(),
}));

vi.mock('../../src/config/paths', () => ({
  SERVERS_DIR: '/tmp/mcp-core-servers',
  LOGS_DIR: '/tmp/mcp-core-logs',
}));

vi.mock('../../src/validate/handshake', () => ({
  validateMcpServer: vi.fn().mockResolvedValue({ success: true, tools: 5, latencyMs: 100 }),
}));

vi.mock('../../src/utils/progress-singleton', () => ({
  getProgressBus: () => ({ emit: vi.fn(), on: vi.fn() }),
}));

const EXTERNAL_PATH = '/external/mcp-servers-config/node_modules';

describe('planMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects npm packages from external node_modules (scoped)', async () => {
    getServersMock.mockReturnValue({
      servers: {
        context7: {
          command: 'npx',
          args: ['-y', `${EXTERNAL_PATH}/@upstash/context7-mcp`],
        },
      },
    });
    const { planMigration } = await import('../../src/cli/commands/migrate');
    const { candidates, skipped } = planMigration();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('context7');
    expect(candidates[0].pkg).toBe('@upstash/context7-mcp');
    expect(skipped).toHaveLength(0);
  });

  it('detects npm packages from external node_modules (unscoped)', async () => {
    getServersMock.mockReturnValue({
      servers: {
        'mcp-qase': {
          command: `${EXTERNAL_PATH}/mcp-qase/build/index.js`,
          args: [],
          env: { QASE_API_TOKEN: 'abc' },
        },
      },
    });
    const { planMigration } = await import('../../src/cli/commands/migrate');
    const { candidates } = planMigration();
    expect(candidates[0].pkg).toBe('mcp-qase');
    expect(candidates[0].env).toEqual({ QASE_API_TOKEN: 'abc' });
  });

  it('skips servers with pkgName already set', async () => {
    getServersMock.mockReturnValue({
      servers: {
        'my-server': {
          command: 'node',
          args: ['/tmp/mcp-core-servers/node_modules/my-server/dist/index.js'],
          pkgName: 'my-server',
        },
      },
    });
    const { planMigration } = await import('../../src/cli/commands/migrate');
    const { candidates, skipped } = planMigration();
    expect(candidates).toHaveLength(0);
    expect(skipped[0].name).toBe('my-server');
    expect(skipped[0].reason).toMatch(/pkgName/);
  });

  it('skips servers already pointing to SERVERS_DIR', async () => {
    getServersMock.mockReturnValue({
      servers: {
        'my-server': {
          command: 'node',
          args: ['/tmp/mcp-core-servers/node_modules/my-server/dist/index.js'],
        },
      },
    });
    const { planMigration } = await import('../../src/cli/commands/migrate');
    const { candidates, skipped } = planMigration();
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/already in/);
  });

  it('skips system binaries without node_modules in path', async () => {
    getServersMock.mockReturnValue({
      servers: {
        engram: {
          command: '/opt/homebrew/bin/engram',
          args: ['mcp', '--tools=agent'],
        },
      },
    });
    const { planMigration } = await import('../../src/cli/commands/migrate');
    const { candidates, skipped } = planMigration();
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/system binary/);
  });
});

describe('runMigrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls npm install for each candidate', async () => {
    getServersMock.mockReturnValue({
      servers: {
        context7: {
          command: 'npx',
          args: ['-y', `${EXTERNAL_PATH}/@upstash/context7-mcp`],
        },
        playwright: {
          command: 'npx',
          args: [`${EXTERNAL_PATH}/@playwright/mcp`],
        },
      },
    });
    const { runMigrate } = await import('../../src/cli/commands/migrate');
    await runMigrate();
    expect(execaMock).toHaveBeenCalledWith(
      'npm', ['install', '@upstash/context7-mcp'], expect.objectContaining({ cwd: '/tmp/mcp-core-servers' })
    );
    expect(execaMock).toHaveBeenCalledWith(
      'npm', ['install', '@playwright/mcp'], expect.objectContaining({ cwd: '/tmp/mcp-core-servers' })
    );
  });

  it('dry run does not call npm install', async () => {
    getServersMock.mockReturnValue({
      servers: {
        context7: {
          command: 'npx',
          args: ['-y', `${EXTERNAL_PATH}/@upstash/context7-mcp`],
        },
      },
    });
    const { runMigrate } = await import('../../src/cli/commands/migrate');
    await runMigrate({ dryRun: true });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('prints nothing to migrate when all servers are managed', async () => {
    getServersMock.mockReturnValue({
      servers: {
        'my-server': {
          command: 'node',
          args: ['/tmp/mcp-core-servers/node_modules/my-server/dist/index.js'],
          pkgName: 'my-server',
        },
      },
    });
    const consoleSpy = vi.spyOn(console, 'log');
    const { runMigrate } = await import('../../src/cli/commands/migrate');
    await runMigrate();
    expect(execaMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Nothing to migrate/));
  });
});
