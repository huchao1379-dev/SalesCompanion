import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { powerApps } from '@microsoft/power-apps-vite/plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerApps()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        // Prefer IPv4 — on Windows, `localhost` can resolve to ::1 and ECONNREFUSED.
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
