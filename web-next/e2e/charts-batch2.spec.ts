// Графики второй пачки (предложение 19.11.2026: 3, 4, 5, 6, 8, 9, 11, 16) — по местам, на 1280 и 390:
// график виден, рисунок не шире экрана, страница не прокручивается вбок. Подставная сеть.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.CHARTS_SHOTS ?? 'e2e/.results';
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 864e5).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);
const K = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const VERSIONS = { rows: K.flatMap((k, i) => [
  { task_uid: `S1/${k}`, status_raw: '⬜ TODO', valid_from: iso(80 - i * 9), valid_to: iso(40 - i * 4) },
  { task_uid: `S1/${k}`, status_raw: i % 3 === 0 ? '🔴 BLOCKED' : '🔄 IN PROGRESS', valid_from: iso(40 - i * 4), valid_to: i < 3 ? iso(10 - i) : null },
  ...(i < 3 ? [{ task_uid: `S1/${k}`, status_raw: '✅ DONE', valid_from: iso(10 - i), valid_to: null }] : []),
]) };
const BODIES: Record<string, unknown> = {
  milestone_by_id: { rows: [{ milestone_id: 'M7', date_display: '2026-12-31', direct_sprint_ids: ['S1'] }] },
  task_status_versions: VERSIONS,
  task_created_dates: { rows: K.map((k, i) => ({ task_uid: `S1/${k}`, valid_from: day(80 - i * 9) })) },
  task_done_dates: { rows: K.slice(0, 4).map((k, i) => ({ task_uid: `S1/${k}`, valid_from: day(30 - i * 8) })) },
  all_tasks: { rows: K.map((k, i) => ({ task_uid: `S1/${k}`, status_raw: i % 3 ? '🔄 IN PROGRESS' : '🔴 BLOCKED', executor_agent: ['Claude Code (full)', 'Claude Code (pm)', null, 'Ирина'][i % 4] })) },
  releases: { rows: Array.from({ length: 10 }, (_, i) => ({ git_tag: `v1.17.${i}`, release_date: day(90 - i * 9), pr_count: (i * 7) % 13 })) },
  pr_ship_lag: { rows: Array.from({ length: 30 }, (_, i) => ({ pr_uid: `p#${i}`, merged_at: iso(90 - i * 3 + (i % 5)), release_date: day(90 - i * 3 - 1) })) },
  decision_status_versions: { rows: Array.from({ length: 24 }, (_, i) => ({ decision_id: `D${i % 9}`, status_raw: ['proposed', 'accepted', 'deferred', 'superseded'][i % 4], valid_from: iso(80 - i * 3) })) },
  qg_run_outcomes: { rows: Array.from({ length: 160 }, (_, i) => ({ routine_name: ['qg-supervisor', 'qg-doc-links', 'qg-know-hygiene', 'qg-lore-blocked-reason'][i % 4], run_date: day((i * 3) % 80), status: i % 3 ? 'PASS' : 'WARN' })) },
};

const record = (type: string, id: string) => ({
  contract: 'lore.record/1',
  record: { type, id, title: id, status: 'active', version: '2026-11-19T10:00:00Z' },
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
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop() ?? '';
    let body: unknown = {};
    if (p.includes('/record/')) body = p.includes('M7') ? record('milestone', 'M7') : p.includes('QG-') ? record('quality_gate', 'QG-DOC-LINKS') : record('project', 'org/a');
    else if (p === '/lore/whoami') body = { auth_enabled: false };
    else if (name in BODIES) body = BODIES[name];
    else if (p.includes('/slice/')) body = { rows: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const PLACES = [
  { id: 'milestone', url: '/?mod=forseti&sec=milestone&open=M7&place=full&pch=1', box: 'milestone-flow-charts', charts: 3 },
  { id: 'project', url: `/?sec=project&open=${encodeURIComponent('org/a')}&place=full&pch=1`, box: 'project-charts', charts: 2 },
  { id: 'gate', url: '/?sec=quality_gate&open=QG-DOC-LINKS&place=full&pch=1', box: 'gate-charts', charts: 1 },
  { id: 'releases-list', url: '/?sec=release&pch=1', box: 'releases-charts', charts: 1 },
  { id: 'analytics-flow', url: '/?sec=analytics&atab=flow', box: null, charts: 4 },
  { id: 'analytics-people', url: '/?sec=analytics&atab=people', box: null, charts: 1 },
  { id: 'analytics-releases', url: '/?sec=analytics&atab=releases', box: null, charts: 2 },
  { id: 'analytics-arch', url: '/?sec=analytics&atab=arch', box: null, charts: 1 },
  { id: 'analytics-quality', url: '/?sec=analytics&atab=quality', box: null, charts: 1 },
  { id: 'admin-home', url: '/?mod=admin&sec=adm-home', box: 'adm-home-blocked', charts: 1 },
];

for (const w of [1280, 390]) {
  for (const pl of PLACES) {
    test(`графики пачки 2 · ${pl.id} · ${w}: видны, без прокрутки вбок`, async ({ page }, info) => {
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
        await expect(charts.nth(i).locator('svg, table').first()).toBeVisible();
        const r = await charts.nth(i).evaluate(e => e.getBoundingClientRect().right);
        expect(r, `график ${i} не шире экрана`).toBeLessThanOrEqual(w);
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, 'страница не прокручивается вбок').toBeLessThanOrEqual(0);
      await scope.screenshot({ path: `${SHOTS}/b2-${pl.id}-${w}.png` });
    });
  }
}
