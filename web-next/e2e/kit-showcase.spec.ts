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

// K4-PHONE-PAGE-OVERFLOW (приёмка 14.11, 300 px: документ 349). Документ мог бы
// уложиться, а раздел — нет (рамка .kitp__sec срезает и прячет край), поэтому
// мерится и каждый раздел: широкое обязано листаться в СВОЕЙ рамке.
test('K4: ни один раздел витрины не шире своей рамки', async ({ page }) => {
  await page.goto('/kit');
  await expect(page.locator('#kit-content .sk-md__toolbar')).toBeVisible();
  const over = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.kitp__sec')]
    .filter(s => s.scrollWidth > s.clientWidth + 1)
    .map(s => `${s.id}: ${s.scrollWidth}/${s.clientWidth}`));
  expect(over).toEqual([]);
});

// K4-PHONE-TAP-TARGETS: на сенсоре у каждой цели ≥ 44 px по высоте — сам элемент
// или его невидимая зона ::after (D-2026-UXR-MOBILE-FOLLOWS-V1: элемент плотный,
// растёт зона). По ширине — так же, кроме плотной панели TipTap: там зона нарочно
// равна кнопке (30 px, решение владелицы 11.11 — иначе зоны соседей перекрываются).
test('K4: у каждой цели витрины на сенсоре зона касания ≥ 44 px', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'зона касания — только на сенсоре (pointer: coarse)');
  await page.goto('/kit');
  await expect(page.locator('#kit-content .sk-md__toolbar')).toBeVisible();
  const small = await page.evaluate(() => {
    const SEL = 'a[href], button, summary, [role=button], [role=tab], [role=option], [role=menuitem], [role=radio], [role=checkbox]';
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (el as HTMLButtonElement).disabled) continue;
      if (el.closest('.sk-prose, .sk-md__doc')) continue; // ссылка в тексте MD: цель — строка
      const af = getComputedStyle(el, '::after');
      const on = af.content !== 'none' && af.position === 'absolute';
      const h = Math.max(r.height, on ? parseFloat(af.height) : 0);
      const w = Math.max(r.width, on ? parseFloat(af.width) : 0);
      const denseRow = el.matches('.sk-md__toolbar--narrow .sk-md__btn');
      if (h < 43.5 || (!denseRow && w < 43.5)) out.push(`${el.className} «${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}» ${Math.round(w)}×${Math.round(h)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
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
