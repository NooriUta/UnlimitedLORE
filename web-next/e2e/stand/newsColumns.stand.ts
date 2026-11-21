// SPRINT_UXR_S13_KIT4/K4-NEWS-ROW-COLUMNS на стенде: лента открывается, строка — по столбцам одной сетки
// (прототип k4-news-row-columns.html, «ок» владелицы 21.11.2026). Только чтение.
import { expect, test } from '@playwright/test';
import { keepLoginFresh, openStand, requireStand, shot } from './stand.ts';

test.beforeEach(() => requireStand());
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const COLS = ['type', 'kind', 'title', 'code', 'time', 'where', 'who', 'status', 'times'];

test('NEWSCOL Лента по столбцам: девять ячеек, заголовки на одной вертикали, копия — с иконки типа, без «НОВОЕ» (SPRINT_UXR_S13_KIT4/K4-NEWS-ROW-COLUMNS)', async ({ page }) => {
  const rows = page.locator('li.sk-news__row');
  await openStand(page, '/news', rows);
  await expect(rows.first(), 'строки ленты показаны').toBeVisible({ timeout: 30_000 });
  const r = await page.evaluate(cols => {
    const list = [...document.querySelectorAll<HTMLElement>('li.sk-news__row')].filter(x => x.offsetParent);
    const bad = list.filter(x => [...x.children].map(c => (c as HTMLElement).dataset.col).join() !== cols.join()).map(x => x.dataset.testid);
    const xs = list.map(x => Math.round(x.querySelector('[data-col="title"]')!.getBoundingClientRect().left - x.getBoundingClientRect().left));
    const strayCopy = [...document.querySelectorAll('[data-testid="news-copy"]')].filter(b => b.closest('[data-col]')?.getAttribute('data-col') !== 'type').length;
    const grid = list[0] ? getComputedStyle(list[0]).display : '';
    return { n: list.length, bad, xs: [...new Set(xs)], strayCopy, grid };
  }, COLS);
  expect(r.n, 'строк больше одной').toBeGreaterThan(1);
  expect(r.grid, 'строка — сетка').toBe('grid');
  expect(r.bad, 'строки не по девяти столбцам').toEqual([]);
  expect(r.xs, `заголовки с разных вертикалей: ${r.xs.join(', ')}`).toHaveLength(1);
  expect(r.strayCopy, 'кнопка копии только в столбце типа').toBe(0);
  await expect(page.locator('li.sk-news__row').filter({ hasText: /^НОВОЕ$|\bНОВОЕ\b/ }), 'слова «НОВОЕ» в строках нет').toHaveCount(0);
});
