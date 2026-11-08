import { defineConfig } from 'vitest/config';

// Seiðr-kit (@seidr/kit) проверяется сам, отдельно от v1 (корневой src/) и от
// web-next: web-next подключает kit как пакет, но тесты kit живут здесь.
// Элементы (S4-00b) рендерятся в jsdom — файл объявляет это сам строкой
// `// @vitest-environment jsdom`, остальные тесты остаются в node.
export default defineConfig({
  // PostCSS — пустой и явный: иначе vite ищет конфиг вверх по дереву и берёт
  // корневой postcss.config.cjs v1 (Mantine-пресет), которого в джобе v2 нет.
  css: { postcss: {} },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Рендер полного списка + axe в jsdom: локально ~3 с на файл, но на раннере,
    // где одновременно идут до 6 джобов, тот же тест не уложился в дефолтные 5 с
    // (#869, 07.11). Таймаут — потолок от зависания, а не норма скорости.
    testTimeout: 20_000,
    // PL-09: в CI контейнер джоба ограничен --memory=6g, а vitest по умолчанию
    // берёт столько воркеров, сколько видит ядер (на ci-server 24), каждый со
    // своим jsdom — джоб убивался OOM (код 137). Локально — по умолчанию.
    maxWorkers: process.env.CI ? 4 : undefined,
  },
});
