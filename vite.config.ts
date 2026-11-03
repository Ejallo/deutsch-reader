import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/
const base = '/deutsch-reader/';
const build = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base,
  define: {
    // Shown in settings to tell which version is running
    __BUILD__: JSON.stringify(build),
  },
  plugins: [
    react(),
    // version.json next to the app: a stuck old version fetches it from the network and learns it is outdated.
    // JSON isn't in the service worker's precache globs, so it is never served from cache.
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      // Custom service worker (src/sw.js) so it can show reminder notifications
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Deutsch Reader',
        short_name: 'Deutsch',
        description: 'Read German texts and learn words',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#fbf6ee',
        theme_color: '#fbf6ee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
