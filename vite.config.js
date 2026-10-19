import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { serviceWorkerPlugin } from './scripts/vite-sw-plugin.js';

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    assetsInlineLimit: 0, // keeps the CSP strict: no data: fonts or images
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js'],
    setupFiles: ['tests/unit/setup.js'],
  },
});
