// Сборка выдачи Seiðr-kit для single-file HTML (SPRINT_UXR_S10_SEIDR_KIT/K-08,
// D-2026-UXR-KIT-REACT вариант «б»): `npm run build:bundle` в kit/ →
//   dist/seidr-kit.js  — ESM, React внутри, один файл (без догружаемых чанков);
//   dist/seidr-kit.css — слой Seiðr (seidr.css) + стили MD-диаграмм.
// Файлы коммитятся (выдача = файлы в репо); src/bundle/dist.test.ts сверяет их
// с версией пакета.
import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version } from './package.json';

const SRC = fileURLToPath(new URL('./src/', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Подмножество game-icons вместо 6 МБ набора: слаги, которые kit упоминает в
 * своём коде строковыми литералами. Иконки конфига приложение даёт само
 * (mount(..., { icons }) / SeidrKit.registerIcons).
 */
function bundledIcons(): Plugin {
  return {
    name: 'seidr-kit-bundled-icons',
    load(id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/bundle/bundledIcons.ts')) return null;
      const set = JSON.parse(readFileSync(fileURLToPath(new URL('./node_modules/@iconify-json/game-icons/icons.json', import.meta.url)), 'utf8'));
      const literals = new Set<string>();
      for (const f of walk(SRC)) {
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.(ts|tsx)$/.test(f) || /[\\/]test[\\/]/.test(f)) continue;
        for (const m of readFileSync(f, 'utf8').matchAll(/['"`]([a-z0-9]+(?:-[a-z0-9]+)*)['"`]/g)) literals.add(m[1]);
      }
      const icons: Record<string, unknown> = {};
      const aliases: Record<string, { parent: string }> = {};
      for (const s of literals) {
        if (set.icons[s]) icons[s] = set.icons[s];
        else if (set.aliases?.[s] && set.icons[set.aliases[s].parent]) {
          aliases[s] = set.aliases[s];
          icons[set.aliases[s].parent] = set.icons[set.aliases[s].parent];
        }
      }
      const subset = { prefix: set.prefix, width: set.width, height: set.height, icons, aliases };
      return `export const BUNDLED_ICONS = ${JSON.stringify(subset)};`;
    },
  };
}

/**
 * Слой Seiðr в CSS бандла. Компоненты kit CSS не импортируют (single-layer
 * тест: вид — только из seidr.css, который подключает приложение), поэтому
 * для выдачи его подключает сборка — к входу бандла.
 */
function seidrLayer(): Plugin {
  return {
    name: 'seidr-kit-css-layer',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/bundle/mount.tsx')) return null;
      return { code: `import '../styles/seidr.css';\n${code}`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [bundledIcons(), seidrLayer()],
  // Тяжёлое, без чего single-file HTML обходится: BPMN (bpmn-js + его CSS со
  // встроенным шрифтом) и ELK-раскладка mermaid. Заглушки отвечают честной
  // плашкой ошибки на месте диаграммы. Полный набор — у импорта пакета.
  resolve: {
    alias: [
      { find: /^bpmn-js\/lib\/NavigatedViewer$/, replacement: fileURLToPath(new URL('./bundle-stubs/bpmn-viewer.js', import.meta.url)) },
      { find: /^bpmn-js\/dist\/assets\/.*\.css$/, replacement: fileURLToPath(new URL('./bundle-stubs/empty.css', import.meta.url)) },
      { find: /^@mermaid-js\/layout-elk$/, replacement: fileURLToPath(new URL('./bundle-stubs/elk-layouts.js', import.meta.url)) },
    ],
  },
  // PostCSS — пустой и явный (см. vitest.config.ts).
  css: { postcss: {} },
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/bundle/mount.tsx', import.meta.url)),
      formats: ['es'],
      fileName: () => 'seidr-kit.js',
      cssFileName: 'seidr-kit',
    },
    rollupOptions: {
      // React и всё остальное — внутри: single-file HTML без сборщика не
      // разрешит голый импорт пакета.
      external: [],
      output: {
        inlineDynamicImports: true,
        // Библиотечный режим vite пробелы в ES не сжимает — бандл не для
        // дальнейшей сборки, а для <script type="module">, поэтому жмём сами.
        minify: true,
        // postBanner — после минификации (обычный banner она срезает).
        postBanner: `/*! seidr-kit v${version} — Seiðr-kit (@seidr/kit), SeidrKit.mount(el, config, data) */`,
      },
    },
  },
});
