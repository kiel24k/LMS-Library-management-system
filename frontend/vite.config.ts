import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The backend URL the dev/preview server proxies `/api` to: API_PROXY_TARGET from the shell or from
  // frontend/.env (see .env.example), e.g. `API_PROXY_TARGET=http://localhost:3100 npx vite --port 5180`.
  // It is only used here, never exposed to the browser bundle.
  const env = loadEnv(mode, import.meta.dirname, '')
  const apiProxyTarget = process.env.API_PROXY_TARGET ?? env.API_PROXY_TARGET ?? 'http://localhost:3000'
  const proxy = { '/api': { target: apiProxyTarget, changeOrigin: true } }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    // Own port (not Vite's default 5173, which other projects on this PC use); fail instead of silently
    // moving to another port so the URL is always the same.
    server: { port: 5174, strictPort: true, proxy },
    preview: { proxy },
  }
})
