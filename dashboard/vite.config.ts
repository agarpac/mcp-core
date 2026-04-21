import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api and the SSE stream to the local mcp-core API so the dev
    // server can hit a single origin and avoid the CORS/token-in-URL dance
    // during development.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3939',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true
  }
})
