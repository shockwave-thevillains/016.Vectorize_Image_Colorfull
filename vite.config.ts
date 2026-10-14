import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Path relatif: build bisa disajikan dari sub-path mana pun
    // (mis. https://<user>.github.io/<repo>/) tanpa konfigurasi tambahan.
    base: './',
    plugins: [react(), tailwindcss()],
    worker: {
      format: 'es' as const,
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      port: 3000,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
    },
  };
});
