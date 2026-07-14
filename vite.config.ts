import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Vitest's default include glob would otherwise also pick up mcp-server/**/*.test.ts
  // (a sibling folder, not an npm workspace) when run from this root — that suite has
  // its own package.json/test script and should stay isolated from this one.
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('mermaid') || id.includes('cytoscape') || id.includes('dagre')) {
            return 'mermaid';
          }
        },
      },
    },
  },
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
  // `vite preview` serves the production build (dist/), where mermaid + the ELK
  // layout engine are pre-bundled — so heavy diagrams render the same as they do
  // behind nginx (:4400), unlike the dev server where the unbundled ELK layout
  // can stall the renderer. API is proxied to the running backend the same way.
  preview: {
    proxy: {
      '/lore/': { target: process.env.VITE_LORE_API_URL ?? 'http://localhost:9100', changeOrigin: true },
      '/bench/': { target: process.env.VITE_BENCH_API_URL ?? 'http://localhost:9100', changeOrigin: true },
    },
  },
});
