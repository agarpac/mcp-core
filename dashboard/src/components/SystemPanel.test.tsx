import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SystemPanel } from './SystemPanel';

describe('SystemPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('renders loading state initially', () => {
    (global.fetch as any).mockResolvedValueOnce(new Promise(() => {})); // pending promise
    render(<SystemPanel />);
    expect(screen.getByText(/Loading system status.../i)).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network Error'));
    render(<SystemPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load system status/i)).toBeInTheDocument();
    });
  });

  it('renders system information after successful fetch', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        os: 'macOS',
        arch: 'arm64',
        node: 'v18.0.0',
        daemonActive: true
      })
    });
    
    render(<SystemPanel />);
    
    await waitFor(() => {
      expect(screen.getByText(/macOS/)).toBeInTheDocument();
      expect(screen.getByText(/arm64/)).toBeInTheDocument();
      expect(screen.getByText(/v18.0.0/)).toBeInTheDocument();
      expect(screen.getByText(/Active/)).toBeInTheDocument();
    });
  });
});
