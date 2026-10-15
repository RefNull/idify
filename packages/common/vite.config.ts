import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { backgroundRemovalAssets } from './build/backgroundRemovalAssets'

// Dev playground for the shared package. The installable PWA lives in
// packages/web; this package is a library and does not register one.
export default defineConfig({
  plugins: [react(), backgroundRemovalAssets({ searchPaths: [__dirname] })],
  server: {
    // Local only by default; use `vite --host` to expose it on the LAN.
    host: 'localhost',
    fs: {
      allow: [__dirname, path.resolve(__dirname, '../../node_modules')],
    },
  },
})
