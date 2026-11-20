// Раскладка экранов v2 в настоящем браузере (SPRINT_UXR_S7A_NEWS/S7A-12).
// jsdom раскладки не считает, поэтому переполнение на 412 px и «лента не на
// первом экране» unit-тесты не ловили. Эти проверки — Playwright: телефон
// 412×915, ноутбук 1280×800 и (экраны новостей) планшет 768×1024 и 1024×768.
//
// В CI не запускается (решение владелицы 09.11.2026: «тесты локально»):
//   cd web-next && npx playwright test
// Браузер — установленный Chrome (channel), скачивать Playwright-сборку не нужно.
import { defineConfig } from '@playwright/test';

// E2E_PORT — свой порт для параллельной сессии (reuseExistingServer иначе подхватит чужой vite с чужим кодом).
const PORT = Number(process.env.E2E_PORT ?? 4419);

export default defineConfig({
  testDir: 'e2e',
  // Смоук живого стенда (E2E-STAND) — свой конфиг playwright.stand.config.ts, здесь не бежит.
  testIgnore: ['**/stand/**'],
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
    // Узкий телефон (SPRINT_UXR_S13_KIT4/K4-PHONE-PAGE-OVERFLOW): приёмка 14.11 мерила
    // витрину на 300 px — на 412 сетка с колонкой 320 ещё помещалась, на 300 уже нет.
    { name: 'phone-300', testMatch: /kit-showcase\.spec\.ts/, use: { viewport: { width: 300, height: 800 }, isMobile: true, hasTouch: true } },
    // Админка 1.18 на телефоне (снимки с ryzenai 19.11: таблицы режут колонки) — 390×844.
    { name: 'admin-390', testMatch: /admin-phone\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    // Экран «Модель» админки (SPRINT_LORE_MODEL_AS_CONFIG/MC-06): владелица работает с телефона 19.11 —
    // «HTML админки не адаптирован под телефон». 390×844; сценарий сам проверяет и 360.
    // 20.11.2026: и расхождения спек и кода (метрики гейта, сохранённые виды) — те же 390.
    { name: 'phone-390', testMatch: /(model-admin|spec-fields)\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    // Паспорт не сбрасывает список (SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET): телефон 390×844.
    { name: 'list-390', testMatch: /list-no-reset\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    // Планшет (жалобы владелицы 08.11 и 10.11 — скрины с планшета): палец, а не
    // мышь, поэтому невидимые зоны касания 44 px включены. Только экраны
    // новостей: остальные e2e под планшет не размечены.
    { name: 'tablet-768', testMatch: /news-.*\.spec\.ts/, use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    { name: 'tablet-1024', testMatch: /news-.*\.spec\.ts/, use: { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true } },
  ],
});
