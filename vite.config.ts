import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4400,
    proxy: {
      // Trailing slash is deliberate: the prefix '/bench' would also swallow the
      // SPA route '/benchmark' (and '/lore' would swallow a hard-reload of the
      // '/lore' page). API calls all hit '/lore/…' and '/bench/…', so the
      // trailing-slash prefixes proxy the API while leaving SPA paths to Vite.
      // Our own standalone backend (UnlimitedLORE/backend) on :9100 — NOT the
      // main project's heimdall-backend :9093. Decoupled per the BE migration.
      '/lore/': {
        target: process.env.VITE_LORE_API_URL ?? 'http://localhost:9100',
        changeOrigin: true,
      },
      '/bench/': {
        target: process.env.VITE_BENCH_API_URL ?? 'http://localhost:9100',
        changeOrigin: true,
      },
    },
  },
});
