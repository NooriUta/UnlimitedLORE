// Витрина /kit не шире экрана (SPRINT_UXR_S9_SCALE_OPT/S9-12 + элементы фазы ADMIN).
//
// Повод делать это именно здесь: во втором kit-спринте на витрину добавились
// матрица (таблица с колонками по числу осей приложения) и экран выпуска с
// пословным диффом. Таблица на телефоне — ровно тот дефект, который сегодня и
// чинили: бокс без `min-width: 0` раздвигает не себя, а всю страницу.
// jsdom раскладку не считает, поэтому проверка браузерная.
import { expect, test } from '@playwright/test';

test('страница /kit не шире экрана, таблица матрицы листается сама', async ({ page }) => {
  await page.goto('/kit');
  await expect(page.locator('#kit-flow')).toBeVisible();
  const w = page.viewportSize()!.width;
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    bw: document.body.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(r.sw, `документ ${r.sw} px при экране ${w} px`).toBeLessThanOrEqual(w);
  expect(r.bw, `body ${r.bw} px при экране ${w} px`).toBeLessThanOrEqual(w);
  expect(r.iw, `слой раскладки ${r.iw} px при экране ${w} px`).toBeLessThanOrEqual(w);
});

test('элементы фазы ADMIN на витрине видны: шаги, дифф, пачка, матрица, выпуск, секрет', async ({ page }) => {
  await page.goto('/kit');
  for (const sel of ['.sk-steps', '.sk-diff', '.sk-matrix', '.sk-rel', '.sk-secret']) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await expect(el, `${sel} на витрине не нарисован`).toBeVisible();
  }
  // Пачка появляется после «Применить N изменений» — это и есть цепочка.
  await page.locator('[data-testid="kit-diff-apply"]').first().click();
  await expect(page.locator('[data-testid="kit-batch"]')).toBeVisible();
  await expect(page.locator('[data-testid="kit-batch-undo"]')).toContainText(/\d/);
});
