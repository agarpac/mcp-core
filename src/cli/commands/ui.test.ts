import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './ui';
import * as fsMock from 'fs';
import { ConfigStore } from '../../config/store';
import { DAEMON_SOCKET } from '../../config/paths';
import * as installMod from './install';
import * as uninstallMod from './uninstall';
import * as injectorsMod from '../injectors/index';

vi.mock('fs', () => {
  const existsSync = vi.fn();
  return {
    default: { existsSync },
    existsSync,
  };
});
vi.mock('../../config/store', () => ({
  ConfigStore: {
    get: vi.fn(),
  },
}));
vi.mock('./install', () => ({
  runInstall: vi.fn((source: string, name?: string) => name || source),
}));
vi.mock('./uninstall', () => ({
  runUninstall: vi.fn(),
}));
vi.mock('../injectors/index', () => ({
  toggleClientServer: vi.fn(),
}));

const TEST_TOKEN = 'test-token-abc123';

function buildApp() {
  return createApp({ token: TEST_TOKEN });
}

describe('UI Command API Routes', () => {
  let app = buildApp();

  beforeEach(() => {
    // Reset only call history, keep the mock implementations intact
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks resets them
    vi.mocked(installMod.runInstall).mockImplementation(
      (source: string, name?: string) => name || source
    );
  });

  describe('Auth middleware', () => {
    it('rejects with 401 when no token is provided', async () => {
      const response = await request(app).get('/api/system');
      expect(response.status).toBe(401);
    });

    it('accepts Authorization: Bearer header', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      const response = await request(app)
        .get('/api/system')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
    });

    it('accepts ?token query parameter', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      const response = await request(app).get(`/api/system?token=${TEST_TOKEN}`);
      expect(response.status).toBe(200);
    });

    it('rejects invalid token with 401', async () => {
      const response = await request(app)
        .get('/api/system')
        .set('Authorization', 'Bearer wrong-token');
      expect(response.status).toBe(401);
    });
  });

  describe('Host validation middleware', () => {
    it('rejects requests with a non-loopback Host header (DNS rebinding)', async () => {
      const response = await request(app)
        .get('/api/system')
        .set('Host', 'evil.example.com')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(403);
    });

    it('accepts 127.0.0.1 Host header', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      const response = await request(app)
        .get('/api/system')
        .set('Host', '127.0.0.1:3939')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
    });

    it('accepts localhost Host header', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);
      const response = await request(app)
        .get('/api/system')
        .set('Host', 'localhost:3939')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/system', () => {
    it('should return system info with daemonActive true when socket exists', async () => {
      vi.mocked(fsMock.existsSync).mockImplementation(
        (path: any) => path === DAEMON_SOCKET
      );

      const response = await request(app)
        .get('/api/system')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        os: process.platform,
        arch: process.arch,
        node: process.version,
        daemonActive: true,
      });
      // `runtimes` field is added dynamically; just assert it exists.
      expect(response.body).toHaveProperty('runtimes');
    });

    it('should return system info with daemonActive false when socket missing', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(false);

      const response = await request(app)
        .get('/api/system')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
      expect(response.body.daemonActive).toBe(false);
    });
  });

  describe('GET /api/servers', () => {
    it('should return servers from config', async () => {
      const mockServers = {
        'test-server': { command: 'test', args: [] },
      };
      vi.mocked(ConfigStore.get).mockReturnValue({ servers: mockServers, version: '1.0' } as any);

      const response = await request(app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockServers);
    });

    it('should handle config read errors', async () => {
      vi.mocked(ConfigStore.get).mockImplementation(() => {
        throw new Error('Config read failed');
      });

      const response = await request(app)
        .get('/api/servers')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to read servers config' });
    });
  });

  describe('GET /api/clients', () => {
    it('should return mapped clients with existence check', async () => {
      vi.mocked(fsMock.existsSync).mockReturnValue(true);

      const response = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      const cursorClient = response.body.find((c: any) => c.name === 'cursor');
      expect(cursorClient).toBeDefined();
      expect(cursorClient.status).toBe('Installed');
    });
  });

  describe('POST /api/install', () => {
    it('should call install server', async () => {
      vi.mocked(installMod.runInstall).mockResolvedValueOnce({
        name: '@smithery/foo',
        command: 'npx',
        args: ['-y', 'smithery'],
      } as any);
      const response = await request(app)
        .post('/api/install')
        .set('Authorization', `Bearer ${TEST_TOKEN}`)
        .send({ source: 'smithery', name: '@smithery/foo' });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.name).toBe('@smithery/foo');
      expect(installMod.runInstall).toHaveBeenCalledWith(
        'smithery',
        '@smithery/foo',
        undefined,
        expect.any(Object)
      );
    });
  });

  describe('POST /api/uninstall', () => {
    it('should call uninstall server', async () => {
      const response = await request(app)
        .post('/api/uninstall')
        .set('Authorization', `Bearer ${TEST_TOKEN}`)
        .send({ name: 'foo' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, message: 'Server foo uninstalled' });
      expect(uninstallMod.runUninstall).toHaveBeenCalledWith('foo');
    });
  });

  describe('POST /api/toggle-client', () => {
    it('should toggle client', async () => {
      const response = await request(app)
        .post('/api/toggle-client')
        .set('Authorization', `Bearer ${TEST_TOKEN}`)
        .send({ serverName: 'test', clientName: 'cursor', enable: true });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, message: 'Toggled test in cursor to true' });
      expect(injectorsMod.toggleClientServer).toHaveBeenCalledWith('test', 'cursor', true);
    });
  });
});
