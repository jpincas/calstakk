import path from 'node:path'
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
  server: {
    proxy: {
      '/principals': 'http://localhost:5232',
      '/calendars': 'http://localhost:5232',
      // Rewrite absolute Location URLs in 308 redirect so the browser follows
      // back through the Vite proxy instead of hitting :5232 directly (CORS).
      '/.well-known': {
        target: 'http://localhost:5232',
        on: {
          proxyRes: (proxyRes) => {
            if (proxyRes.headers.location) {
              proxyRes.headers.location = proxyRes.headers.location.replace(
                'http://localhost:5232',
                '',
              )
            }
          },
        },
      },
    },
  },
})
