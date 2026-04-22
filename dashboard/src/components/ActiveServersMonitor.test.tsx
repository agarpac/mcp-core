import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ActiveServersMonitor } from './ActiveServersMonitor';

const mockServers = {
  'my-server': { command: 'npx', args: ['my-server'] },
};
const mockSystem = { configPath: '/home/user/.mcp-core/config.json' };
const mockActiveServers = { active: [], cached: [] };
const mockLogs = { name: 'my-server', lines: ['[2026-01-01] startup'], path: '/logs/my-server.log' };

function makeFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockImplementation((url: string) => {
    const base = url.split('?')[0];
    const responses: Record<string, unknown> = {
      '/api/servers': mockServers,
      '/api/system': mockSystem,
      '/api/daemon/active-servers': mockActiveServers,
      '/api/logs/my-server': mockLogs,
      ...overrides,
    };
    const body = responses[base];
    if (body === undefined) return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

describe('ActiveServersMonitor', () => {
  beforeEach(() => {
    sessionStorage.setItem('mcp-core.token', 'test-token');
    Object.defineProperty(window, 'location', { value: { reload: vi.fn(), search: '' }, writable: true });
  });

  it('renders loading state initially', () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ActiveServersMonitor />);
    expect(screen.getByText(/Loading active servers.../i)).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    global.fetch = makeFetch({ '/api/servers': new Error('Network Error') });
    render(<ActiveServersMonitor />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load active servers/i)).toBeInTheDocument();
    });
  });

  it('renders active servers and config path', async () => {
    global.fetch = makeFetch();
    render(<ActiveServersMonitor />);

    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument();
      expect(screen.getByText('npx my-server')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Re-validate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Uninstall/i })).toBeInTheDocument();
    });

    expect(screen.getByText('/home/user/.mcp-core/config.json')).toBeInTheDocument();
    expect(screen.queryByText(/^Clients$/i)).not.toBeInTheDocument();
  });

  it('shows idle dot and label when server is not active', async () => {
    global.fetch = makeFetch({ '/api/daemon/active-servers': { active: [], cached: [] } });
    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getAllByText('my-server').length).toBeGreaterThan(0));
    expect(document.querySelector('.bg-gray-500')).toBeInTheDocument();
    expect(screen.getAllByText('idle').length).toBeGreaterThan(0);
  });

  it('shows green dot and running label when server is active', async () => {
    global.fetch = makeFetch({ '/api/daemon/active-servers': { active: ['my-server'], cached: [] } });
    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getAllByText('my-server').length).toBeGreaterThan(0));
    expect(document.querySelector('.bg-green-500')).toBeInTheDocument();
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
  });

  it('shows yellow dot and cached label when server is cached but not running', async () => {
    global.fetch = makeFetch({ '/api/daemon/active-servers': { active: [], cached: ['my-server'] } });
    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getAllByText('my-server').length).toBeGreaterThan(0));
    expect(document.querySelector('.bg-yellow-500')).toBeInTheDocument();
    expect(screen.getAllByText('cached').length).toBeGreaterThan(0);
  });

  it('opens log modal on Logs button click', async () => {
    global.fetch = makeFetch();
    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getAllByText('my-server').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: /Logs/i })[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/logs\/my-server/),
        expect.any(Object)
      );
    });
    await waitFor(() => {
      expect(screen.getByText('[2026-01-01] startup')).toBeInTheDocument();
    });
  });

  it('calls uninstall endpoint on click', async () => {
    global.fetch = makeFetch();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getAllByText('my-server').length).toBeGreaterThan(0));

    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getAllByRole('button', { name: /Uninstall/i })[0]);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/uninstall',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'my-server' }),
        })
      )
    );
  });
});
