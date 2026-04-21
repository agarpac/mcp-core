import { jsx as _jsx } from "react/jsx-runtime";
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
describe('MCP Core Dashboard', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockImplementation((url) => {
            if (url.includes('/api/system')) {
                return Promise.resolve({ ok: true, json: async () => ({ os: 'macOS', arch: 'arm64', node: 'v18', daemonActive: true }) });
            }
            if (url.includes('/api/servers')) {
                return Promise.resolve({ ok: true, json: async () => ({ 'github-mcp': { command: 'npx' } }) });
            }
            return Promise.reject(new Error('not found'));
        });
    });
    it('renders dashboard heading', () => {
        render(_jsx(App, {}));
        expect(screen.getByText('MCP Core Dashboard')).toBeInTheDocument();
    });
    it('renders connected MCP servers eventually', async () => {
        render(_jsx(App, {}));
        await waitFor(() => {
            expect(screen.getByText(/github-mcp/i)).toBeInTheDocument();
        });
    });
});
//# sourceMappingURL=App.test.js.map