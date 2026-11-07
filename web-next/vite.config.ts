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
  // MD/HTML-элементы kit (@seidr/kit/content, S4-00d) — тоже peer: TipTap и
  // ProseMirror держат состояние в модуле (две копии @tiptap/pm = «схема из
  // чужого экземпляра»), а в образе у kit своего node_modules нет вовсе —
  // импорт из исходников kit обязан разрешаться от web-next.
  resolve: {
    dedupe: [
      'react', 'react-dom', '@iconify/react',
      '@tiptap/core', '@tiptap/react', '@tiptap/pm', '@tiptap/starter-kit', '@tiptap/extension-image',
      '@tiptap/extension-table', '@tiptap/extension-task-list', '@tiptap/extension-task-item',
      '@tiptap/extension-mention', '@tiptap/suggestion', 'tiptap-markdown',
      'marked', 'mermaid', '@mermaid-js/layout-elk', 'bpmn-js', 'dompurify',
    ],
  },
  // PostCSS — пустой и явный: иначе vite ищет конфиг вверх по дереву и берёт
  // корневой postcss.config.cjs v1 (Mantine-пресет), которого в джобе v2 нет.
  css: { postcss: {} },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
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
