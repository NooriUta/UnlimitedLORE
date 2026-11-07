import { defineConfig } from 'vitest/config';

// Seiðr-kit (@seidr/kit) проверяется сам, отдельно от v1 (корневой src/) и от
// web-next: web-next подключает kit как пакет, но тесты kit живут здесь.
// Элементы (S4-00b) рендерятся в jsdom — файл объявляет это сам строкой
// `// @vitest-environment jsdom`, остальные тесты остаются в node.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
