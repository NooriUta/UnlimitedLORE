import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// LORE v2 (SPRINT_UXR_S3_V2_INFRA/S3-01, D-2026-UXR-V2-FOLDER-V1-FROZEN).
// Отдельная сборка рядом с v1 (корневой src/, сервис lore-app). Общего у них
// только бэкенд за прокси /lore/ и /bench/; зависимостей, конфигов и тестов
// друг друга они не видят — корневой vitest ищет только src/**, этот —
// только web-next/src/**.
const api = process.env.VITE_LORE_API_URL ?? 'http://localhost:9100';
const bench = process.env.VITE_BENCH_API_URL ?? 'http://localhost:9100';

export default defineConfig({
  plugins: [react()],
  // Seiðr-kit (../kit, D-2026-UXR-KIT-REACT) подключён ссылкой file:../kit и
  // разрешается в свой реальный путь. Локально у kit есть свой node_modules
  // (для его тестов) — без dedupe его импорт `react` взял бы оттуда вторую
  // копию React, и хуки упали бы «Invalid hook call». @iconify/react (S4-00b) —
  // peer kit: реестр иконок у него модульный, и вторая копия не видела бы
  // набор, зарегистрированный приложением.
  resolve: {
    dedupe: ['react', 'react-dom', '@iconify/react'],
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    env: { VITE_LORE_AUTH_ENABLED: 'false' },
  },
  server: {
    // v1 в dev на :4400 — v2 рядом, а не вместо.
    port: 4401,
    // Исходники kit лежат вне web-next — dev-сервер должен их отдавать.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../kit'] },
    proxy: {
      '/lore/': { target: api, changeOrigin: true },
      '/bench/': { target: bench, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/lore/': { target: api, changeOrigin: true },
      '/bench/': { target: bench, changeOrigin: true },
    },
  },
});
