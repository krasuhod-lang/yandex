import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Base '' ensures relative asset paths so the build can be deployed to any
// subdirectory on any static hosting (FTP, GitHub Pages, Netlify, Vercel, CDN)
// without configuration changes.
export default defineConfig({
  plugins: [react()],
  base: '',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    host: true,
  },
})
