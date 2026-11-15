// Смоук LORE v2 на ЖИВОМ стенде после выкатки в preprod (SPRINT_UXR_S11_TEST_OPT/E2E-STAND).
// Отдельно от обычных e2e (playwright.config.ts игнорирует e2e/stand) и от vitest
// (тот берёт только src/**): бежит против настоящего стенда, со входом.
//
//   LORE_STAND_URL=https://preprod.new.lore.odal.seidrstudio.pro \
//   LORE_STAND_STORAGE_STATE=e2e/stand/.auth/stand.json \
//   npm run e2e:stand
//
// Внимание: http://192.168.3.131:4400 — это НЕ препрод, а пересыльщик прода (редирект на
// lore.odal). v2 препрода — https://preprod.new.lore.odal.seidrstudio.pro (порт 4412 на 131).
// Адреса прода смоук отвергает сам (summary.ts → isForbiddenStandUrl), и по редиректу тоже.
//
// Вход: сохранённое состояние браузера (localStorage с oidc.user:*), сделанное человеком
// один раз — см. e2e/stand/README.md. Нет файла — сценарии «не выполнены», а не зелёные.
// Отчёт: e2e/.stand-report/ (summary.json, summary.md, скрины), в git не идёт.
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { standPreflight } from './src/standSmoke/summary.ts';

const pre = standPreflight({
  standUrl: process.env.LORE_STAND_URL,
  storageState: process.env.LORE_STAND_STORAGE_STATE,
  exists: existsSync,
});

export default defineConfig({
  testDir: 'e2e/stand',
  testMatch: /.*\.stand\.ts/,
  outputDir: 'e2e/.stand-report/.pw',
  globalSetup: './e2e/stand/global-setup.ts',
  reporter: [['list'], ['./e2e/stand/reporter.ts']],
  // Сценарии читают общий стенд; параллельность не нужна, повторы прятали бы регресс.
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: pre.run ? process.env.LORE_STAND_URL : undefined,
    // Без входа не передаём файл вовсе: Playwright упал бы на несуществующем пути
    // до того, как сценарий успел бы честно сказать «не выполнен».
    storageState: pre.run ? process.env.LORE_STAND_STORAGE_STATE : undefined,
    // Локально — Chrome машины; в CI без Chrome — LORE_STAND_CHANNEL= (пусто) даёт
    // Chromium из `npx playwright install chromium`.
    channel: process.env.LORE_STAND_CHANNEL === undefined ? 'chrome' : (process.env.LORE_STAND_CHANNEL.trim() || undefined),
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
  },
});
