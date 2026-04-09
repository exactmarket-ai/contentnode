import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/portal/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/portal/deliverables': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/portal/feedback': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/writer/verify': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/writer/draft': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/writer/submit': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
