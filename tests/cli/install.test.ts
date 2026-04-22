import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

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
      readFileSync: vi.fn(() => '{}'),
    },
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
  };
});

const { addServerMock, notifyDaemonMock } = vi.hoisted(() => ({
  addServerMock: vi.fn(),
  notifyDaemonMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/config/store', () => ({
  ConfigStore: {
    initialize: vi.fn(),
    addServer: addServerMock,
    get: vi.fn(() => ({ servers: {} })),
    removeServer: vi.fn(),
  },
}));

vi.mock('../../src/daemon/notify', () => ({
  notifyDaemon: notifyDaemonMock,
}));

const { addServerToClientsMock } = vi.hoisted(() => ({
  addServerToClientsMock: vi.fn(),
}));
vi.mock('../../src/cli/injectors/index', () => ({
  addServerToClients: addServerToClientsMock,
  removeServerFromClients: vi.fn(),
}));

vi.mock('../../src/config/paths', () => ({
  SERVERS_DIR: '/tmp/mcp-core-servers',
  LOGS_DIR: '/tmp/mcp-core-logs',
}));

const { validateMock } = vi.hoisted(() => ({ validateMock: vi.fn() }));
vi.mock('../../src/validate/handshake', () => ({
  validateMcpServer: validateMock,
}));

import { runInstall } from '../../src/cli/commands/install';
import { getProgressBus, resetProgressBus } from '../../src/utils/progress-singleton';

describe('runInstall — command injection hardening', () => {
  beforeEach(() => {
    execaMock.mockClear();
    addServerMock.mockClear();
    notifyDaemonMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    validateMock.mockResolvedValue({ success: true, tools: 2, latencyMs: 42 });
    resetProgressBus();
  });

  it('does NOT expand shell metacharacters from a malicious git URL', async () => {
    const malicious = 'https://evil.example/repo.git; echo PWNED';
    await runInstall(malicious, 'evil-server');
    const gitCall = execaMock.mock.calls.find((c) => c[0] === 'git');
    expect(gitCall).toBeDefined();
    const [, args] = gitCall as [string, string[]];
    expect(args).toContain(malicious);
    expect(args).not.toContain('echo');
    expect(args).not.toContain('PWNED');
  });

  it('invokes npm install with args as an array (no shell string)', async () => {
    await runInstall('https://example.com/repo.git', 'my-server');
    const npmInstall = execaMock.mock.calls.find(
      (c) => c[0] === 'npm' && Array.isArray(c[1]) && (c[1] as string[])[0] === 'install'
    );
    expect(npmInstall).toBeDefined();
    const [, args] = npmInstall as [string, string[], any];
    expect(args).toEqual(['install']);
  });

  it('invokes git clone with source and target as separate argv entries', async () => {
    const source = 'https://example.com/clean.git';
    await runInstall(source, 'clean-server');
    const gitCall = execaMock.mock.calls.find((c) => c[0] === 'git');
    const [, args] = gitCall as [string, string[]];
    expect(args[0]).toBe('clone');
    expect(args).toContain(source);
    expect(args).toContain(path.join('/tmp/mcp-core-servers', 'clean-server'));
  });

  it('tolerates npm run build failing (optional step)', async () => {
    execaMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'run' && args[1] === 'build') {
        throw new Error('no build script');
      }
      return { stdout: '', stderr: '', exitCode: 0 } as any;
    });
    await expect(runInstall('https://example.com/repo.git', 'build-fails')).resolves.toBeDefined();
  });
});

describe('runInstall — env vars', () => {
  beforeEach(() => {
    execaMock.mockClear();
    addServerMock.mockClear();
    notifyDaemonMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
    resetProgressBus();
  });

  it('persists env vars in ConfigStore.addServer', async () => {
    await runInstall('some-npm-pkg', 'pkg', { API_KEY: 'secret', DB_URL: 'x' });
    expect(addServerMock).toHaveBeenCalled();
    const call = addServerMock.mock.calls[0];
    const cfg = call[1];
    expect(cfg.env).toEqual({ API_KEY: 'secret', DB_URL: 'x' });
  });
});

describe('runInstall — method selection (npm / uvx / git / auto)', () => {
  beforeEach(() => {
    execaMock.mockClear();
    addServerMock.mockClear();
    notifyDaemonMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
    resetProgressBus();
  });

  it('uses uvx when method is explicitly uvx', async () => {
    await runInstall('some-python-mcp', 'py', undefined, { method: 'uvx' });
    expect(addServerMock).toHaveBeenCalled();
    const [, cfg] = addServerMock.mock.calls[0]!;
    expect(cfg.command).toBe('uvx');
    expect(cfg.args).toEqual(['-y', 'some-python-mcp']);
  });

  it('auto-detects uvx when source starts with mcp-server-', async () => {
    await runInstall('mcp-server-postgres', undefined, undefined, { method: 'auto' });
    const [, cfg] = addServerMock.mock.calls[0]!;
    expect(cfg.command).toBe('uvx');
  });

  it('uses npm — installs to shared node_modules and stores node + absolute path', async () => {
    await runInstall('@modelcontextprotocol/server-memory', 'memory', undefined, { method: 'npm' });
    const [, cfg] = addServerMock.mock.calls[0]!;
    expect(cfg.command).toBe('node');
    expect(cfg.args[0]).toContain('@modelcontextprotocol/server-memory');
    expect(cfg.args[0]).toMatch(/\.js$/);
    // path must NOT contain a per-server subdirectory — goes to shared node_modules
    expect(cfg.args[0]).toContain(path.join('node_modules', '@modelcontextprotocol'));
  });

  it('calls npm install <package> in SERVERS_DIR (shared)', async () => {
    await runInstall('@modelcontextprotocol/server-memory', 'memory', undefined, { method: 'npm' });
    const npmCall = execaMock.mock.calls.find(
      (c) => c[0] === 'npm' &&
        (c[1] as string[])[0] === 'install' &&
        (c[1] as string[])[1] === '@modelcontextprotocol/server-memory'
    );
    expect(npmCall).toBeDefined();
    // cwd must be SERVERS_DIR (shared), not a per-server subdirectory
    expect((npmCall as any)[2]?.cwd).toBe('/tmp/mcp-core-servers');
  });

  it('stores pkgName for npm packages to enable clean uninstall', async () => {
    await runInstall('@modelcontextprotocol/server-memory', 'memory', undefined, { method: 'npm' });
    const [, cfg] = addServerMock.mock.calls[0]!;
    expect(cfg.pkgName).toBe('@modelcontextprotocol/server-memory');
  });

  it('does NOT store pkgName for non-npm methods', async () => {
    await runInstall('some-python-mcp', 'py', undefined, { method: 'uvx' });
    const [, cfg] = addServerMock.mock.calls[0]!;
    expect(cfg.pkgName).toBeUndefined();
  });

  it('stores kind matching the install method', async () => {
    await runInstall('@scope/pkg', 'pkg', undefined, { method: 'npm' });
    expect(addServerMock.mock.calls[0]![1].kind).toBe('npm');

    addServerMock.mockClear(); execaMock.mockClear();
    await runInstall('mcp-server-pg', 'pg', undefined, { method: 'uvx' });
    expect(addServerMock.mock.calls[0]![1].kind).toBe('uvx');
  });
});

describe('runInstall — daemon notification (no per-client injection)', () => {
  beforeEach(() => {
    execaMock.mockClear();
    addServerMock.mockClear();
    notifyDaemonMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    validateMock.mockResolvedValue({
      success: true,
      tools: 1,
      latencyMs: 10,
      toolDefinitions: [{ name: 'search', description: 'Search the web' }],
    });
    resetProgressBus();
  });

  it('notifies daemon with backend_registered after install', async () => {
    await runInstall('pkg', 'pkg');
    expect(notifyDaemonMock).toHaveBeenCalledOnce();
    const [msg] = notifyDaemonMock.mock.calls[0]!;
    expect(msg.type).toBe('backend_registered');
    expect(msg.name).toBe('pkg');
    expect(msg.capabilities.tools).toHaveLength(1);
    expect(msg.capabilities.tools[0].name).toBe('search');
  });

  it('sends empty tools in notification when validation is skipped', async () => {
    await runInstall('pkg', 'pkg', undefined, { validate: false });
    const [msg] = notifyDaemonMock.mock.calls[0]!;
    expect(msg.type).toBe('backend_registered');
    expect(msg.capabilities.tools).toEqual([]);
  });

  it('does NOT call the client injectors (injection removed in gateway arch)', async () => {
    await runInstall('pkg', 'pkg', undefined, { clients: ['cursor', 'claudeCode'] });
    expect(addServerToClientsMock).not.toHaveBeenCalled();
  });
});

describe('runInstall — validation', () => {
  beforeEach(() => {
    execaMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    resetProgressBus();
  });

  it('calls validateMcpServer by default after injection', async () => {
    validateMock.mockResolvedValue({ success: true, tools: 7, latencyMs: 120 });
    await runInstall('pkg', 'pkg');
    expect(validateMock).toHaveBeenCalled();
  });

  it('skips validation when validate=false', async () => {
    await runInstall('pkg', 'pkg', undefined, { validate: false });
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('returns the validation result alongside the server name', async () => {
    validateMock.mockResolvedValue({ success: true, tools: 3, latencyMs: 80, toolNames: ['a', 'b', 'c'] });
    const res = await runInstall('pkg', 'pkg');
    // Backwards-compatible: still a string OR an object with .name. Allow either.
    if (typeof res === 'string') {
      expect(res).toBe('pkg');
    } else {
      expect(res.name).toBe('pkg');
      expect(res.validation?.tools).toBe(3);
    }
  });
});

describe('runInstall — progress events', () => {
  beforeEach(() => {
    execaMock.mockClear();
    notifyDaemonMock.mockClear();
    validateMock.mockClear();
    execaMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as any);
    validateMock.mockResolvedValue({ success: true, tools: 1, latencyMs: 10 });
    resetProgressBus();
  });

  it('emits resolve, register, validate and done phases (no inject-clients)', async () => {
    const bus = getProgressBus();
    const phases: string[] = [];
    bus.on((e) => phases.push(e.phase));

    await runInstall('pkg', 'pkg');

    expect(phases).toContain('resolve');
    expect(phases).toContain('register');
    expect(phases).not.toContain('inject-clients');
    expect(phases).toContain('validate');
    expect(phases).toContain('done');
  });

  it('emits error phase and rethrows on failure', async () => {
    execaMock.mockRejectedValueOnce(new Error('git clone failed'));
    const bus = getProgressBus();
    const phases: string[] = [];
    bus.on((e) => phases.push(e.phase));

    await expect(
      runInstall('https://x.git', 'fail')
    ).rejects.toThrow(/git clone failed/);
    expect(phases).toContain('error');
  });
});
