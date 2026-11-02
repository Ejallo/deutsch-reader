import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/
const base = '/deutsch-reader/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Reader web fonts: cache after first use so texts render offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Deutsch Reader',
        short_name: 'Deutsch',
        description: 'Read German texts and learn words',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#faf6ee',
        theme_color: '#faf6ee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
