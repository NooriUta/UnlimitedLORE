import { defineConfig } from 'vitest/config';

// Seiðr-kit (@seidr/kit) проверяется сам, отдельно от v1 (корневой src/) и от
// web-next: web-next подключает kit как пакет, но тесты kit живут здесь.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
