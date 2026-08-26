import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: [
      'three',
      '@react-three/fiber',
      '@react-three/drei',
      'react',
      'react-dom',
    ],
    force: true,
  },
  resolve: {
    alias: {
      '#brain': path.resolve(__dirname, './brain'),
      '#memory': path.resolve(__dirname, './memory'),
      '#vision': path.resolve(__dirname, './vision'),
      '#voice': path.resolve(__dirname, './voice'),
      '#services': path.resolve(__dirname, './services'),
      '#tools': path.resolve(__dirname, './tools')
    }
  }
})
