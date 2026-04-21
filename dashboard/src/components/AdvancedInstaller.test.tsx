import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdvancedInstaller } from './AdvancedInstaller';

describe('AdvancedInstaller', () => {
  it('renders installer form and POSTs to /api/install on click', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    Object.defineProperty(window, 'location', { value: { reload: vi.fn(), search: '' }, writable: true });
    sessionStorage.setItem('mcp-core.token', 'test-token');

    render(<AdvancedInstaller />);

    expect(screen.getByRole('button', { name: /Install Server/i })).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/NPM package \/ Git URL/i);
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'test-pkg' } });
    fireEvent.click(screen.getByRole('button', { name: /Install Server/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/install',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });
});
