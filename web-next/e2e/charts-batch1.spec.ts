// Графики первой пачки (предложение 19.11.2026, «добавляй графики»: 2, 7, 1, 13, 14) — по местам, на 1280
// и на телефоне 390: график виден, рисунок не шире экрана, страница не прокручивается вбок.
// Подставная сеть (route **/lore/**). Снимки — в e2e/.results и (если задано CHARTS_SHOTS) в папку снимков.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.CHARTS_SHOTS ?? 'e2e/.results';
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 864e5).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const VERSIONS = (sprint: string) => ({ rows: ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((k, i) => [
  { task_uid: `${sprint}/${k}`, status_raw: '⬜ TODO', valid_from: iso(20 - i), valid_to: iso(16 - i) },
  { task_uid: `${sprint}/${k}`, status_raw: '🔄 IN PROGRESS', valid_from: iso(16 - i), valid_to: i < 4 ? iso(12 - i * 2) : null },
  ...(i < 4 ? [{ task_uid: `${sprint}/${k}`, status_raw: i % 2 ? '🚀 READY' : '✅ DONE', valid_from: iso(12 - i * 2), valid_to: null }] : []),
]) });
const CREATED = { rows: ['A', 'B', 'C', 'D', 'E', 'F'].map((k, i) => ({ task_uid: `S1/${k}`, valid_from: day(30 - i * 3) })) };
const DONE = { rows: ['A', 'B', 'C'].map((k, i) => ({ task_uid: `S1/${k}`, valid_from: day(20 - i * 7) })) };
const ACTIONS = { rows: Array.from({ length: 120 }, (_, i) => ({
  ts: iso((i * 7) % 28 + 0.3), caller: ['full', 'pm', 'tester', 'reviewer'][i % 4], client: `c-${i % 3}`, status: [200, 200, 200, 409, 401, 422][i % 6],
})) };

const record = (type: string, id: string) => ({
  contract: 'lore.record/1',
  record: { type, id, title: id, status: 'in_progress', version: '2026-11-19T10:00:00Z' },
  values: { title: id, date: '2026-12-31' }, parts: [], links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: { type, label: type, label_key: `rec.${type}`, icon: type,
    fields: [{ key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: false }],
    layout: {}, relations: [] },
  meta: { facade: 'server', sources: {}, data_state: [] },
});

async function mock(page: Page) {
  await page.route('**/lore/**', async route => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const name = p.split('/').pop() ?? '';
    let body: unknown = {};
    if (p.includes('/record/')) body = p.includes('/milestone/') || p.includes('M7') ? record('milestone', 'M7') : record('sprint', 'S1');
    else if (p === '/lore/whoami') body = { auth_enabled: false };
    else if (name === 'milestone_by_id') body = { rows: [{ milestone_id: 'M7', date_display: '2026-12-31', direct_sprint_ids: ['S1'] }] };
    else if (name === 'task_status_versions') body = VERSIONS(u.searchParams.get('sprint') ?? 'S1');
    else if (name === 'task_created_dates') body = CREATED;
    else if (name === 'task_done_dates') body = DONE;
    else if (name === 'agent_action_points') body = ACTIONS;
    else if (p.includes('/slice/')) body = { rows: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const PLACES = [
  { id: 'sprint', url: '/?sec=sprint&open=S1&place=full&pch=1', box: 'sprint-charts', charts: 2 },
  { id: 'milestone', url: '/?mod=forseti&sec=milestone&open=M7&place=full&pch=1', box: 'milestone-flow-charts', charts: 3 },
  { id: 'analytics-flow', url: '/?sec=analytics&atab=flow', box: null, charts: 3 },
  { id: 'admin-log', url: '/?mod=admin&sec=adm-log', box: 'adm-actions-chart', charts: 1 },
  { id: 'admin-mcp', url: '/?mod=admin&sec=adm-mcp', box: 'adm-mcp-codes-chart', charts: 1 },
];

for (const w of [1280, 390]) {
  for (const pl of PLACES) {
    test(`графики пачки 1 · ${pl.id} · ${w}: видны, без прокрутки вбок`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'ширину задаёт сам тест');
      await page.setViewportSize({ width: w, height: 900 });
      await mock(page);
      await page.goto(pl.url);
      const scope = pl.box ? page.getByTestId(pl.box) : page.locator('.an');
      await expect(scope).toBeVisible({ timeout: 20_000 });
      const charts = scope.getByTestId('kit-chart');
      await expect(charts).toHaveCount(pl.charts, { timeout: 20_000 });
      for (let i = 0; i < pl.charts; i++) {
        await charts.nth(i).scrollIntoViewIfNeeded();
        await expect(charts.nth(i).locator('svg')).toBeVisible();
        const r = await charts.nth(i).evaluate(e => e.getBoundingClientRect().right);
        expect(r, `график ${i} не шире экрана`).toBeLessThanOrEqual(w);
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, 'страница не прокручивается вбок').toBeLessThanOrEqual(0);
      await scope.screenshot({ path: `${SHOTS}/b1-${pl.id}-${w}.png` });
    });
  }
}
