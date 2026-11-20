// Графики вехи в паспорте (SPRINT_UXR_S13_KIT4/K4-CHARTS, вопрос 11 владелицы 19.11.2026: «графики по вехам
// были в v1» — Velocity и Burnup по спринтам вехи, перенесены на kit). Проверка раскладки: график виден на
// 1280 и на телефоне 390, страница не прокручивается вбок. Подставная сеть; снимки — в e2e/.results.
import { expect, test } from '@playwright/test';

const M = 'M7';
const MS = { milestone_id: M, label: 'M7 · Kit 4', week: 47, date_display: '30 ноября', priority: 'P1', status: 'in_progress', direct_sprint_ids: ['S1', 'S2', 'S3'] };
const SPRINTS = [
  { sprint_id: 'S1', name: 'Спринт 1', created_date: '2026-10-05', done_date: '2026-10-20', milestone_ids: [M] },
  { sprint_id: 'S2', name: 'Спринт 2', created_date: '2026-10-12', done_date: '2026-11-10', milestone_ids: [M] },
  { sprint_id: 'S3', name: 'Спринт 3', created_date: '2026-10-26', done_date: null, milestone_ids: [M] },
];

const RECORD = {
  contract: 'lore.record/1',
  record: { type: 'milestone', id: M, title: 'M7 · Kit 4', status: 'in_progress', version: '2026-11-19T10:00:00Z' },
  values: { title: 'M7 · Kit 4', date: '30 ноября' },
  parts: [], links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: { type: 'milestone', label: 'Веха', label_key: 'rec.milestone', icon: 'milestone',
    fields: [{ key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: false }],
    layout: {}, relations: [] },
  meta: { facade: 'server', sources: {}, data_state: [] },
};

for (const w of [1280, 390]) {
  test(`паспорт вехи: графики спринтов вехи видны на ${w} без прокрутки вбок`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'ширину задаёт сам тест');
    await page.setViewportSize({ width: w, height: 900 });
    await page.route('**/lore/**', async route => {
      const p = new URL(route.request().url()).pathname;
      const name = p.split('/').pop();
      const body = p.includes('/record/') && p.includes(M) ? RECORD
        : name === 'milestone_by_id' || name === 'milestones' ? { rows: [MS] }
        : name === 'sprints' || name === 'milestone_sprints' ? { rows: SPRINTS }
        : p.includes('/slice/') ? { rows: [] } : {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/?mod=forseti&sec=milestone&open=${M}&place=full`);
    // На телефоне графики паспорта свёрнуты одной кнопкой «Графики ▸» (общее правило с графиками пачек 19.11:
    // телефон — свёрнуто, компьютер — открыто).
    if (w < 720) await page.getByRole('button', { name: /Графики/ }).click({ timeout: 20_000 });
    const box = page.getByTestId('milestone-charts');
    await expect(box).toBeVisible({ timeout: 20_000 });
    const charts = box.getByTestId('kit-chart');
    await expect(charts).toHaveCount(2);
    await charts.first().scrollIntoViewIfNeeded();
    await expect(charts.first().locator('svg')).toBeVisible();
    await expect(charts.nth(1).locator('path[data-series="scope"]')).toHaveCount(1);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    const cw = await charts.first().evaluate(e => e.getBoundingClientRect().right);
    expect(cw).toBeLessThanOrEqual(w);
    await box.screenshot({ path: `e2e/.results/milestone-charts-${w}.png` });
  });
}
