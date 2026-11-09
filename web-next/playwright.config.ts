// Раскладка экранов v2 в настоящем браузере (SPRINT_UXR_S7A_NEWS/S7A-12).
// jsdom раскладки не считает, поэтому переполнение на 412 px и «лента не на
// первом экране» unit-тесты не ловили. Эти проверки — Playwright на двух
// ширинах: телефон 412×915 и планшет/ноутбук 1280×800.
//
// В CI не запускается (решение владелицы 09.11.2026: «тесты локально»):
//   cd web-next && npx playwright test
// Браузер — установленный Chrome (channel), скачивать Playwright-сборку не нужно.
import { defineConfig } from '@playwright/test';

const PORT = 4419;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  reporter: [['list']],
  fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome', screenshot: 'off' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/news`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_LORE_AUTH_ENABLED: 'false', VITE_NEWS_FIXTURE: 'true' },
  },
  projects: [
    { name: 'phone-412', use: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
