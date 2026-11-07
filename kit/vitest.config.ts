import { defineConfig } from 'vitest/config';

// Seiðr-kit тестируется сам по себе: среда по умолчанию — node; тесты,
// которым нужен DOM (error boundary), включают jsdom докблоком
// `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
