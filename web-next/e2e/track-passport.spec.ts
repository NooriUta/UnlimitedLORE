// SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 — трек спринта по ребру ON_TRACK и паспорт трека в настоящем браузере, 1280 и 390
// (владелица 20.11.2026: «треки б»; «трек как веха но меньше паспорт ему тоже сделай»). Раздела-списка у трека нет:
// паспорт открывается из паспорта спринта по ссылке на трек. Подставная сеть: ответы фасада — снятый ответ спринта
// (shared/fixtures/record-sprint.json) со схемой из эталона MC-01 (backend model-golden/lore-record.json).
// Проверка: чип «Hound / Parser» в свойствах спринта → паспорт трека («Спринты на треке» с периодом), на телефоне
// страница не шире окна. Снимки — в SHOTS_DIR (по умолчанию e2e/.results/track).
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR ?? 'e2e/.results/track';
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}-${test.info().project.name}.png`), fullPage: false });

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const S = 'SPRINT_HOUND_S3';
const golden = read('../../backend/src/test/resources/model-golden/lore-record.json');

function sprintRecord(): unknown {
  const body = read('../../shared/fixtures/record-sprint.json');
  body.record = { ...body.record, id: S, title: 'Hound S3' };
  body.values = { ...body.values, title: 'Hound S3', track: [{ id: '2', label: 'Hound / Parser', inherited_from: null }] };
  body.schema = golden.sprint.schema_unread;
  body.perms = { ...body.perms, can_edit: false };
  return body;
}

function trackRecord(): unknown {
  return {
    contract: 'lore.record/1',
    record: { type: 'track', id: '2', title: 'Hound / Parser', status: null, version: null },
    values: { title: 'Hound / Parser', code: '2', area: 'engine' },
    parts: [],
    links: [
      { rel: 'ON_TRACK', dir: 'in', id: S, type: 'sprint', title: 'Hound S3 · 2026-06-20 — сейчас', status: 'active', fromKind: 'sprint', toKind: 'track' },
      { rel: 'ON_TRACK', dir: 'in', id: 'SPRINT_HOUND_S2', type: 'sprint', title: 'Hound S2 · 2026-05-01 — 2026-06-01', status: 'done', fromKind: 'sprint', toKind: 'track' },
    ],
    perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: 'только чтение' },
    facts: {},
    schema: golden.track.schema_unread,
    meta: { facade: 'server', sources: { block: ['sprints'], record: 'track_by_id' },
      data_state: [{ source: 'track_by_id', state: 'ok' }, { source: 'track_sprints', link: 'sprints', state: 'ok' }] },
    history: { available: false, reason: 'no_versions' },
  };
}

async function mockLore(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false, seer_role: 'viewer' });
    if (p.startsWith(`/lore/record/sprint/${S}`)) return json(route, sprintRecord());
    if (p.startsWith('/lore/record/track/2')) return json(route, trackRecord());
    if (p === '/lore/slice/sprints') return json(route, { rows: [{ sprint_id: S, name: 'Hound S3', status_raw: '🔄 IN PROGRESS', track_id: '2', track_label: 'Hound / Parser' }] });
    if (p.includes('/slice/')) return json(route, { rows: [] });
    return json(route, {});
  });
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('паспорт спринта: трек — ссылка; по ней открывается паспорт трека со спринтами на треке', async ({ page }, info) => {
  test.skip(![1280, 390].includes(page.viewportSize()?.width ?? 0), 'снимки — 1280 и 390');
  await mockLore(page);
  await page.goto(`/?mod=forseti&sec=sprint&open=${S}&place=full`);
  // свойства свёрнуты строкой-сводкой: раскрыть
  const props = page.locator('summary', { hasText: 'Свойства' }).first();
  await expect(props, 'положительный контроль: паспорт спринта нарисован').toBeVisible({ timeout: 30_000 });
  await expect(props).toContainText('Hound / Parser');
  await props.click();
  const chip = page.getByRole('link', { name: 'Hound / Parser' }).first();
  await expect(chip, 'положительный контроль: паспорт спринта нарисован, трек — ссылка').toBeVisible({ timeout: 30_000 });
  await chip.scrollIntoViewIfNeeded();
  await shot(page, '1-sprint');
  await chip.click();
  await expect(page).toHaveURL(/okind=track/);
  await expect(page).toHaveURL(/open=2(&|$)/);
  await expect(page.getByRole('heading', { name: 'Hound / Parser' }).first()).toBeVisible({ timeout: 30_000 });
  const tab = page.getByRole('tab', { name: /Спринты на треке/ });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByText('Hound S3 · 2026-06-20 — сейчас').first()).toBeVisible();
  await expect(page.getByText('Hound S2 · 2026-05-01 — 2026-06-01').first()).toBeVisible();
  if (info.project.name.includes('390')) expect(await pageOverflow(page), 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
  await shot(page, '2-track');
});
