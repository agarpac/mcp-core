import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ActiveServersMonitor } from './ActiveServersMonitor';

describe('ActiveServersMonitor', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    sessionStorage.setItem('mcp-core.token', 'test-token');
    Object.defineProperty(window, 'location', { value: { reload: vi.fn(), search: '' }, writable: true });
  });

  it('renders loading state initially', () => {
    (global.fetch as any).mockResolvedValueOnce(new Promise(() => {}));
    render(<ActiveServersMonitor />);
    expect(screen.getByText(/Loading active servers.../i)).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network Error'));
    render(<ActiveServersMonitor />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load active servers/i)).toBeInTheDocument();
    });
  });

  it('renders active servers from API without per-client columns', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'my-server': {
          command: 'npx',
          args: ['my-server'],
        },
      }),
    });

    render(<ActiveServersMonitor />);

    await waitFor(() => {
      expect(screen.getByText('my-server')).toBeInTheDocument();
      expect(screen.getByText('npx my-server')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Re-validate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Uninstall/i })).toBeInTheDocument();
    });

    // No "Clients" column in gateway mode
    expect(screen.queryByText(/^Clients$/i)).not.toBeInTheDocument();
  });

  it('calls uninstall endpoint on click', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        'my-server': { command: 'npx', args: ['my-server'] },
      }),
    });

    render(<ActiveServersMonitor />);
    await waitFor(() => expect(screen.getByText('my-server')).toBeInTheDocument());

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
