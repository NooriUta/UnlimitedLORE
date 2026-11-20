// Графики вехи на «дорожной карте» (SPRINT_UXR_S13_KIT4/K4-CHARTS, владелица 19.11.2026: «можно и на дорожную
// карту»). Отдельного экрана дорожной карты в v2 нет — вехи живут в разделе «Вехи». Места:
//   • 1280: выбрал веху в списке → боковая панель вехи с двумя графиками; ▸ у строки — графики под вехой;
//   • 390: карточка вехи → паспорт, под вехой кнопка «Графики вехи» раскрывает те же два графика.
// Везде: страница не прокручивается вбок. Подставная сеть; снимки — e2e/.results и SHOTS_DIR, если задан.
import { expect, test, type Page } from '@playwright/test';

const M = 'M7';
const MS = { milestone_id: M, label: 'M7 · Kit 4', week: 47, date_display: '30 ноября', priority: 'P1', direct_sprint_ids: ['S1', 'S2', 'S3'], products: [], changed_at: '2026-11-19T00:00:00Z' };
const SPRINTS = [
  { sprint_id: 'S1', name: 'Спринт 1', created_date: '2026-10-05', done_date: '2026-10-20' },
  { sprint_id: 'S2', name: 'Спринт 2', created_date: '2026-10-12', done_date: '2026-11-10' },
  { sprint_id: 'S3', name: 'Спринт 3', created_date: '2026-10-26', done_date: null },
];
const RECORD = {
  contract: 'lore.record/1',
  record: { type: 'milestone', id: M, title: 'M7 · Kit 4', status: 'in_progress', version: '2026-11-19T10:00:00Z' },
  values: { title: 'M7 · Kit 4', date: '30 ноября' }, parts: [], links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null }, facts: {},
  schema: { type: 'milestone', label: 'Веха', label_key: 'rec.milestone', icon: 'milestone',
    fields: [{ key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: false }], layout: {}, relations: [] },
  meta: { facade: 'server', sources: {}, data_state: [] },
};

async function stub(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop();
    const body = p.includes('/record/') && p.includes(M) ? RECORD
      : name === 'milestone_by_id' || name === 'milestones' ? { rows: [MS], total: 1 }
      : name === 'sprints' ? { rows: SPRINTS }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function chartsIn(page: Page, box: ReturnType<Page['locator']>, w: number) {
  await expect(box.getByTestId('kit-chart')).toHaveCount(2, { timeout: 20_000 });
  await box.getByTestId('kit-chart').first().scrollIntoViewIfNeeded();
  await expect(box.getByTestId('kit-chart').first().locator('svg')).toBeVisible();
  for (const r of await box.getByTestId('kit-chart').evaluateAll(es => es.map(e => e.getBoundingClientRect().right))) expect(r).toBeLessThanOrEqual(w);
  await noSideScroll(page);
}

const shot = (name: string) => [`e2e/.results/${name}.png`, ...(process.env.SHOTS_DIR ? [`${process.env.SHOTS_DIR}/${name}.png`] : [])];

test('1280: выбор вехи — графики в боковой панели; ▸ у строки — под вехой', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'ширину задаёт сам тест');
  await page.setViewportSize({ width: 1280, height: 900 });
  await stub(page);
  await page.goto('/?mod=forseti&sec=milestone');
  await page.locator(`[data-record-id="${M}"]`).first().getByText('M7 · Kit 4').click();
  const side = page.getByTestId('milestone-charts');
  await chartsIn(page, side, 1280);
  for (const p of shot('after-roadmap-1280-side')) await page.screenshot({ path: p });
  await page.getByRole('button', { name: /Раскрыть|Expand/ }).first().click();
  const under = page.locator(`[data-expand-of="${M}"]`);
  await chartsIn(page, under.getByTestId('milestone-charts'), 1280);
  for (const p of shot('after-roadmap-1280-row')) await under.screenshot({ path: p });
});

test('390: веха → под ней «Графики вехи» раскрытием', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'ширину задаёт сам тест');
  await page.setViewportSize({ width: 390, height: 900 });
  await stub(page);
  await page.goto('/?mod=forseti&sec=milestone');
  await page.getByText('M7 · Kit 4').first().click();
  const btn = page.getByRole('button', { name: /Графики вехи/ });
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await noSideScroll(page);
  await btn.click();
  await chartsIn(page, page.getByTestId('milestone-charts'), 390);
  for (const p of shot('after-roadmap-390')) await page.screenshot({ path: p, fullPage: true });
});
