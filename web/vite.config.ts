import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['react-big-calendar/lib/addons/dragAndDrop'],
  },
  server: {
    // Pin the port. strictPort makes vite FAIL if 5173 is taken rather than
    // silently drifting to 5174+ — so a stale server surfaces loudly instead of
    // spawning a duplicate on an unpredictable port. `scripts/dev.sh` clears the
    // port first, so in normal use it's always free.
    port: 5173,
    strictPort: true,
    proxy: {
      '/principals': 'http://localhost:5232',
      '/calendars': 'http://localhost:5232',
      // Rewrite absolute Location URLs in 308 redirect so the browser follows
      // back through the Vite proxy instead of hitting :5232 directly (CORS).
      '/.well-known': {
        target: 'http://localhost:5232',
        // @ts-expect-error — 'on' exists in vite-http-proxy at runtime but is missing from Vite's ProxyOptions type
        on: {
          proxyRes: (proxyRes: IncomingMessage) => {
            const location = proxyRes.headers.location
            if (typeof location === 'string') {
              proxyRes.headers.location = location.replace('http://localhost:5232', '')
            }
          },
        },
      },
    },
  },
})
