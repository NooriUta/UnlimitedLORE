// AP-SESSION-BANNER-NARROW (скрин владелицы 15.11, телефон): плашка «Сессия истекла» сжималась в столбец
// по 2–3 буквы, а «Войти снова» занимала всю ширину. Проверка — настоящий CSS kit, ширина 360.
// Запуск: npx playwright test e2e/expired-banner-narrow.spec.ts (сервер не нужен).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

// K5-PACKAGE-DELIVERY: CSS kit — из установленного пакета @seidr/kit (то, что уедет в бандл).
const css = readFileSync(createRequire(import.meta.url).resolve('@seidr/kit/styles/seidr.css'), 'utf8');
const html = `<!doctype html><html><head><style>${css}</style></head><body>
<div class="sk-auth-expired" role="alert" data-auth="expired">
  <span class="sk-icon sk-auth-expired__icon" style="width:16px;height:16px;display:inline-block"></span>
  <span class="sk-auth-expired__text"><b>Сессия истекла.</b> Сервер не принял вход — данные на экране могли не обновиться. Несохранённое останется на месте до входа.</span>
  <button type="button" class="sk-btn">Войти снова</button>
</div></body></html>`;

for (const width of [320, 360]) {
  test(`плашка «Сессия истекла» на ${width}px: текст строками, кнопка под ним`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.setContent(html);
    const text = await page.locator('.sk-auth-expired__text').boundingBox();
    const btn = await page.locator('.sk-auth-expired .sk-btn').boundingBox();
    expect(text!.width, 'текст не столбцом в одно слово').toBeGreaterThan(width * 0.6);
    expect(btn!.y, 'кнопка под текстом').toBeGreaterThanOrEqual(text!.y + text!.height - 1);
    expect(btn!.width, 'кнопка не на всю ширину').toBeLessThan(width * 0.6);
  });
}

test('плашка «Сессия истекла» на 1280px: по центру, не шире 640, кнопка в строке с текстом', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(html);
  const box = (await page.locator('.sk-auth-expired').boundingBox())!;
  const text = (await page.locator('.sk-auth-expired__text').boundingBox())!;
  const btn = (await page.locator('.sk-auth-expired .sk-btn').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(641);
  expect(Math.abs(box.x + box.width / 2 - 640), 'по центру').toBeLessThan(2);
  expect(btn.y, 'кнопка в строке с текстом').toBeLessThan(text.y + text.height);
});
