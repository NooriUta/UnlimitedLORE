import { defineConfig } from 'vitest/config';
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
  // Seiðr-kit — пакет @seidr/kit из реестра (AIDA/lorekit, SPRINT_UXR_S14_KIT5/K5-PACKAGE-DELIVERY):
  // собранный dist, вход по обычным условиям exports. Условие «seidr-source» — только для разработки
  // самого kit: исходников в пакете нет, и потребитель с этим условием получил бы битый вход.
  // dedupe остаётся: peer-зависимости kit (React, @iconify/react, TipTap/ProseMirror, движки графа)
  // держат состояние в модуле — две копии дают «Invalid hook call» и «схему из чужого экземпляра».
  resolve: {
    dedupe: ['echarts', 
      'react', 'react-dom', '@iconify/react',
      '@tiptap/core', '@tiptap/react', '@tiptap/pm', '@tiptap/starter-kit', '@tiptap/extension-image',
      '@tiptap/extension-table', '@tiptap/extension-task-list', '@tiptap/extension-task-item',
      '@tiptap/extension-mention', '@tiptap/suggestion', 'tiptap-markdown',
      'marked', 'katex', 'mermaid', '@mermaid-js/layout-elk', 'bpmn-js', 'dompurify',
      // Вход kit (@seidr/kit/auth, S3-18): в образе у kit нет node_modules.
      'oidc-client-ts',
      // Граф знаний kit (GC-03): движки — peer kit, грузятся лениво; в образе у kit
      // нет node_modules, поэтому разрешаться они обязаны от web-next.
      'force-graph', 'sigma', 'graphology', 'd3-force',
      // GC-02: «Структура» — React Flow и ELK (воркер) — тоже peer kit.
      '@xyflow/react', 'elkjs',
    ],
  },
  // PostCSS — пустой и явный: иначе vite ищет конфиг вверх по дереву и берёт
  // корневой postcss.config.cjs v1 (Mantine-пресет), которого в джобе v2 нет.
  css: { postcss: {} },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/stand/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // K5-PACKAGE-DELIVERY: kit — пакет в node_modules, а vitest такие исполняет мимо себя (externalize).
    // Тогда vi.mock('mermaid' | движков графа …) в тестах web-next не доходил бы до импортов ВНУТРИ kit,
    // и одна копия React/TipTap могла бы раздвоиться. Пока kit был исходником ../kit, он шёл через vite
    // сам — inline сохраняет то же поведение для пакета.
    server: { deps: { inline: ['@seidr/kit'] } },
    env: { VITE_LORE_AUTH_ENABLED: 'false' },
    // CI-WEBNEXT-ISOLATION (14.11.2026): при нехватке CPU (контейнер --cpus 1.5) полный прогон
    // красный 2 из 3 — «Test timed out in 5000ms» у axe по витрине и тяжёлых отрисовок; при
    // 6 ядрах 10 из 10 зелёных. Лимит — потолок от зависания, а не норма скорости; как у kit (#869).
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // PL-09: в CI контейнер джоба ограничен --memory=6g; без потолка vitest берёт
    // воркеров по числу ядер хоста (24) — OOM, код 137. Локально — по умолчанию.
    maxWorkers: process.env.CI ? 4 : undefined,
  },
  server: {
    // v1 в dev на :4400 — v2 рядом, а не вместо.
    port: 4401,
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
