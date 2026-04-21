import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getToken,
  resetTokenCache,
  fetchSystem,
  fetchServers,
  fetchClients,
  install,
  uninstall,
  toggleClient,
} from './client';

const TOKEN = 'sekret-token-123';

function mockOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function mockErr(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

describe('api/client - token handling', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetTokenCache();
    // Reset URL search params for each test
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the token from the URL on first load and caches it in sessionStorage', () => {
    window.history.replaceState({}, '', `/?token=${TOKEN}`);
    const t = getToken();
    expect(t).toBe(TOKEN);
    expect(sessionStorage.getItem('mcp-core.token')).toBe(TOKEN);
  });

  it('falls back to sessionStorage on subsequent calls', () => {
    sessionStorage.setItem('mcp-core.token', TOKEN);
    const t = getToken();
    expect(t).toBe(TOKEN);
  });

  it('returns empty string when no token is available', () => {
    const t = getToken();
    expect(t).toBe('');
  });
});

describe('api/client - endpoint wrappers', () => {
  beforeEach(() => {
    sessionStorage.setItem('mcp-core.token', TOKEN);
    resetTokenCache();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('fetchSystem sends Authorization: Bearer <token>', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ os: 'darwin' }));
    await fetchSystem();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/system'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    );
  });

  it('fetchServers returns parsed JSON', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ foo: { command: 'npx' } }));
    const res = await fetchServers();
    expect(res).toEqual({ foo: { command: 'npx' } });
  });

  it('fetchClients returns parsed JSON', async () => {
    (global.fetch as any).mockResolvedValueOnce(
      mockOk([{ name: 'cursor', status: 'Installed', configPath: '/p', enabled: true }])
    );
    const res = await fetchClients();
    expect(res[0].name).toBe('cursor');
  });

  it('install POSTs the body as JSON with auth header', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ success: true }));
    await install({ source: 'foo', name: 'bar' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/install'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ source: 'foo', name: 'bar' }),
      })
    );
  });

  it('uninstall POSTs the name', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ success: true }));
    await uninstall({ name: 'foo' });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/uninstall'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'foo' }),
      })
    );
  });

  it('toggleClient POSTs the triple', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ success: true }));
    await toggleClient({ serverName: 's', clientName: 'cursor', enable: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/toggle-client'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ serverName: 's', clientName: 'cursor', enable: true }),
      })
    );
  });

  it('throws with message from server on !ok responses', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockErr(401, { error: 'Unauthorized' }));
    await expect(fetchSystem()).rejects.toThrow(/Unauthorized/);
  });
});
