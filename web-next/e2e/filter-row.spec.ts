// Ряд фасетов списка — в одну строку с «+N» (SPRINT_UXR_POLISH_UAT_1113/PU-12).
// Приёмка 13.11: при ширине ~800 px ряд «Фильтр / Поиск / Статус / Релиз / Спринт»
// переносился на вторую строку. jsdom раскладку не считает — проверка в браузере.
// Данные — подставная сеть, как в list-narrow.spec.ts; первый шаг — положительный контроль.
import { expect, test, type Page } from '@playwright/test';

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  sprint_id: `SPRINT_UXR_S${i}_FILTER_ROW`,
  name: `Спринт ${i}`,
  status_raw: i % 2 ? '🔄 IN PROGRESS' : '📋 PLANNED',
  git_projects: ['AIDA/UnlimitedLORE'],
  components: ['lore-frontend'],
  release_ids: ['lore-v1.17.8'],
  milestone_ids: ['M-UXR'],
  priority: (i % 5) + 1,
  planned_start_date: '2026-11-01',
  planned_end_date: '2026-11-30',
  valid_from: '2026-11-09T10:00:00Z',
}));

async function open(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const body = p.includes('/count') ? { count: ROWS.length, total: ROWS.length }
      : p.includes('/slice/') ? { rows: ROWS, total: ROWS.length } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?sec=sprint');
  await expect(page.locator('.sk-list__table tbody tr').first()).toBeVisible({ timeout: 20_000 });
}

/** Ряд сегмента фильтра: сколько строк занимают фасеты, «+N» и фильтр по дате. */
const oneLine = (page: Page) => page.evaluate(() => {
  const ctl = document.querySelector('.sk-list__controls') as HTMLElement;
  const seg = ctl.querySelector(':scope > .sk-list__seg[data-seg="filter"]') as HTMLElement;
  const slots = [...seg.children].filter(c => c.matches('.sk-facet, .sk-list__facetmore')) as HTMLElement[];
  // Строк — сколько разных «полос» по вертикали: сдвиг меньше полувысоты (выравнивание по центру) строкой не считается.
  const tops = (xs: HTMLElement[]) => xs.reduce<number[]>((rows, x) => { const r = x.getBoundingClientRect(); if (!rows.some(t => Math.abs(t - r.top) < r.height / 2)) rows.push(r.top); return rows; }, []).length;
  return { facets: seg.querySelectorAll(':scope > .sk-facet').length, more: !!seg.querySelector('.sk-list__facetmore'), slotRows: tops(slots) };
});

for (const width of [800, 1280]) {
  test.describe(`ширина ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, isMobile: false, hasTouch: false });
    test('ряд фильтров в одну строку, лишнее — в «+N»', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'одна проекция достаточно');
      await open(page);
      const r = await oneLine(page);
      await page.screenshot({ path: `e2e/.results/filter-row-${width}.png`, clip: { x: 0, y: 0, width, height: 420 } });
      expect(r.facets, 'фасеты нарисованы').toBeGreaterThan(0);
      expect(r.slotRows, `фасеты в ${r.slotRows} строк(и)`).toBe(1);
    });
  });
}
