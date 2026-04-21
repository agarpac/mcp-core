import { describe, it, expect, vi, beforeEach } from 'vitest';

const { notifyDaemonMock } = vi.hoisted(() => ({
  notifyDaemonMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/daemon/notify', () => ({
  notifyDaemon: notifyDaemonMock,
}));

const { removeServerMock } = vi.hoisted(() => ({
  removeServerMock: vi.fn(),
}));

vi.mock('../../src/config/store', () => ({
  ConfigStore: {
    initialize: vi.fn(),
    get: vi.fn(() => ({
      servers: {
        memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
      },
    })),
    removeServer: removeServerMock,
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => false), rmSync: vi.fn(), unlinkSync: vi.fn() },
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../src/config/paths', () => ({
  SERVERS_DIR: '/tmp/mcp-core-servers',
  LOGS_DIR: '/tmp/mcp-core-logs',
  CORE_DIR: '/tmp/mcp-core',
  DAEMON_SOCKET: '/tmp/mcp-core/daemon.sock',
}));

const { removeServerFromClientsMock } = vi.hoisted(() => ({
  removeServerFromClientsMock: vi.fn(),
}));
vi.mock('../../src/cli/injectors/index', () => ({
  addServerToClients: vi.fn(),
  removeServerFromClients: removeServerFromClientsMock,
}));

import { runUninstall } from '../../src/cli/commands/uninstall';

describe('runUninstall', () => {
  beforeEach(() => {
    notifyDaemonMock.mockClear();
    removeServerMock.mockClear();
  });

  it('removes the server from ConfigStore', async () => {
    await runUninstall('memory');
    expect(removeServerMock).toHaveBeenCalledWith('memory');
  });

  it('throws when the server is not registered', async () => {
    const { ConfigStore } = await import('../../src/config/store');
    vi.mocked(ConfigStore.get).mockReturnValueOnce({ servers: {}, version: '1.0.0' });

    await expect(runUninstall('ghost')).rejects.toThrow(/no está registrado/);
  });

  it('notifies the daemon with backend_unregistered', async () => {
    await runUninstall('memory');
    expect(notifyDaemonMock).toHaveBeenCalledOnce();
    const [msg] = notifyDaemonMock.mock.calls[0]!;
    expect(msg.type).toBe('backend_unregistered');
    expect(msg.name).toBe('memory');
  });

  it('does NOT call removeServerFromClients (injection removed in gateway arch)', async () => {
    await runUninstall('memory');
    expect(removeServerFromClientsMock).not.toHaveBeenCalled();
  });

  it('completes successfully even if daemon is not running', async () => {
    notifyDaemonMock.mockResolvedValueOnce(undefined);
    await expect(runUninstall('memory')).resolves.toBeUndefined();
  });
});
