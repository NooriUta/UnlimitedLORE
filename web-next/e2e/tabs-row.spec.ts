// Ряд вкладок в настоящем браузере: ровный шаг, значок при подписи, не шире
// экрана (B13 ревью владелицы 10.11.2026: «строка связей плывёт на 3–4 строки
// с рваными промежутками; иконки отрываются от подписей»).
//
// Почему именно браузер: jsdom раскладку не считает — ни переносов внутри
// чипа, ни промежутков между строками ряда. Правила CSS unit-тест проверяет по
// тексту файла, но «ровный шаг» виден только в измерении.
import { expect, test } from '@playwright/test';

test('ряд вкладок: один шаг по обеим осям, подпись с числом не разрывается', async ({ page }) => {
  await page.goto('/kit');
  const row = page.locator('.sk-tabs').first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();

  const m = await row.evaluate((el: HTMLElement) => {
    const cs = getComputedStyle(el);
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.sk-tab'));
    return {
      rowGap: cs.rowGap, colGap: cs.columnGap, align: cs.alignItems,
      tabs: tabs.map(t => {
        const s = getComputedStyle(t);
        const r = t.getBoundingClientRect();
        // Высота одной строки текста против высоты чипа: если чип выше своей
        // строки больше чем на паддинги, подпись перенеслась внутри — ровно то,
        // что выглядит как «иконка оторвалась от подписи».
        const lines = Math.round(r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom));
        return { label: t.textContent ?? '', nowrap: s.whiteSpace, grow: s.flexGrow, shrink: s.flexShrink, h: Math.round(r.height), inner: lines };
      }),
    };
  });

  expect(m.tabs.length, 'ряд вкладок пуст — проверка прошла бы мимо').toBeGreaterThan(1);
  expect(m.rowGap, `шаг строк ${m.rowGap} против шага колонок ${m.colGap}`).toBe(m.colGap);
  expect(m.align).toBe('center');
  for (const t of m.tabs) {
    expect(t.nowrap, `чип «${t.label}» переносится внутри`).toBe('nowrap');
    expect(t.grow, `чип «${t.label}» тянется — промежутки станут рваными`).toBe('0');
    expect(t.shrink, `чип «${t.label}» сжимается`).toBe('0');
  }
  // Высота у всех чипов одна: разная высота в одной строке и есть «рваный ряд».
  const hs = new Set(m.tabs.map(t => t.h));
  expect(hs.size, `высоты чипов разные: ${[...hs].join(', ')}`).toBe(1);
});

test('страница витрины не шире экрана вместе с ряд ом вкладок', async ({ page }) => {
  await page.goto('/kit');
  const w = page.viewportSize()!.width;
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
  expect(r.sw, `документ ${r.sw} px при экране ${w} px`).toBeLessThanOrEqual(w);
  expect(r.bw, `body ${r.bw} px при экране ${w} px`).toBeLessThanOrEqual(w);
});
