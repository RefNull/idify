import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { backgroundRemovalAssets } from '../common/build/backgroundRemovalAssets'
import { contentSecurityPolicy } from '../common/build/contentSecurityPolicy'

const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  plugins: [
    react(),
    backgroundRemovalAssets({
      searchPaths: [__dirname, path.resolve(__dirname, '../common')],
    }),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registers via an external /registerSW.js script (allowed by the CSP).
      injectRegister: 'script',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Idify',
        short_name: 'Idify',
        description:
          'Make ID photos locally in your browser. No uploads, no telemetry.',
        theme_color: '#1976d2',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only. The background-removal runtime and
        // models (~200 MB of .wasm/.onnx, up to ~19 MB each) are cached on
        // first use instead, so installing the PWA does not download them all.
        // The small face-detection model (~230 KB) is precached for offline use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,webp,woff2,onnx}'],
        globIgnores: ['**/assets/background-removal/**'],
        // The main chunk bundles onnxruntime-web and is close to workbox's
        // 2 MiB default; allow some headroom, still far below any model file.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, url }) =>
              sameOrigin &&
              url.pathname.startsWith('/assets/background-removal/') &&
              /\.(wasm|onnx)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'background-removal-assets',
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: '/src',
      },
    ],
  },
  server: {
    // Local only by default; use `pnpm dev --host` to expose it on the LAN.
    host: 'localhost',
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, '../common'),
        // pnpm keeps every dependency (fonts, onnx runtime, ...) here.
        path.join(repoRoot, 'node_modules'),
      ],
    },
  },
  preview: {
    host: 'localhost',
  },
})
