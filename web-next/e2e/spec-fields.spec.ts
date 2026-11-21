// Расхождения спек и кода (владелица 19–20.11.2026: «доделать функции, чтобы все поля работали») — в настоящем
// браузере на 1280 и 390. Подставная сеть.
//  • Паспорт гейта: вкладка «Метрики» со всеми полями спеки LORE_SCHEMA_V12_NEW_TYPES; нет измерения — словами.
//  • Раздел ADR: панель сохранённых видов; «Поделиться» даёт ссылку на сохранённый вид.
// На телефоне горизонтальной прокрутки страницы нет.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const SHOTS = process.env.SPEC_FIELDS_SHOTS;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Снятый ответ фасада (shared/fixtures/record-adr.json) — тип и часть метрик как у quality_gate. */
function gateRecord(): unknown {
  const body = JSON.parse(readFileSync(new URL('../../shared/fixtures/record-adr.json', import.meta.url), 'utf8'));
  body.record = { ...body.record, type: 'quality_gate', id: 'QG-LORE-SCHEMA', title: 'Схема LORE' };
  body.values = { ...body.values, title: 'Схема LORE' };
  body.schema = { ...body.schema, type: 'quality_gate', label: 'Гейт качества', icon: 'checkered-flag', relations: [
    ...(body.schema.relations ?? []),
    { key: 'metrics', label: 'Метрики', relation: 'composition', rel: 'MEASURED_BY', dir: 'out', target_type: 'qg_metric', place: 'part', manageable: false },
  ] };
  body.parts = [{
    key: 'metrics', label: 'Метрики', type: 'qg_metric', rel: 'MEASURED_BY', dir: 'out', owned: 'strict', relation: 'composition',
    columns: ['status', 'code', 'title', 'threshold', 'unit', 'direction', 'current_value'], state: 'ok', count: 2, items: [
      { id: 'QG-LORE-SCHEMA:P-1:0', title: 'Доля успешных миграций', status: 'fail',
        values: { status: 'fail', code: 'P-1', title: 'Доля успешных миграций', threshold: '≥ 98%', unit: '%', direction: 'gte', current_value: 97.5 } },
      { id: 'QG-LORE-SCHEMA:P-2:1', title: 'Время проверки схемы', status: 'unknown',
        values: { status: 'unknown', code: 'P-2', title: 'Время проверки схемы', threshold: '≤ 200 ms', unit: 'ms', direction: 'lte', current_value: null } },
    ],
  }];
  return body;
}

const ADRS = [
  { adr_id: 'ADR-1', name: 'Альфа', status: 'accepted', date_created: '2026-01-01' },
  { adr_id: 'ADR-2', name: 'Бета', status: 'proposed', date_created: '2026-06-01' },
];
const VIEW = { view_uid: 'v-team', name: 'Предложенные', section: 'adrs', query: 'lq=proposed', visibility: 'all', roles: [],
  is_team_default: false, is_personal_default: false, own: true, version: 1, updated_at: '2026-11-20T00:00:00Z' };

async function mockLore(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false, seer_role: 'viewer' });
    if (p.startsWith('/lore/record/quality_gate/')) return json(route, gateRecord());
    if (p === '/lore/me/views') return json(route, { ok: true, views: [VIEW], count: 1, defaults: {} });
    if (p === '/lore/slice/quality_gates') return json(route, { rows: [{ qg_id: 'QG-LORE-SCHEMA', name: 'Схема LORE', status: 'active' }] });
    if (p === '/lore/slice/adrs') return json(route, { rows: ADRS });
    if (p.includes('/slice/')) return json(route, { rows: [] });
    return json(route, {});
  });
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('паспорт гейта: метрики со всеми полями, нет измерения — словами', async ({ page }, info) => {
  await mockLore(page);
  await page.goto('/?mod=forseti&sec=quality_gate&open=QG-LORE-SCHEMA');
  const tab = page.getByRole('tab', { name: /Метрики/ });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByText('нет измерения').first()).toBeVisible();
  await expect(page.getByText('не меньше порога').first()).toBeVisible();
  await expect(page.getByText('не выполнен').first()).toBeVisible();
  await expect(page.getByText('≥ 98%').first()).toBeVisible();
  // свой набор колонок: заголовки полей спеки есть, общей колонки «Вид» нет
  const heads = page.locator('[role=tabpanel] th, .sk-record th');
  await expect(heads.filter({ hasText: /Последнее измерение/i }).first()).toBeAttached();
  await expect(heads.filter({ hasText: /^Вид$/i })).toHaveCount(0);
  expect(await pageOverflow(page), 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `qg-metrics-${info.project.name}.png`), fullPage: false });
});

test('раздел ADR: сохранённый вид применяется, «Поделиться» даёт ссылку на вид', async ({ page }, info) => {
  await mockLore(page);
  await page.goto('/?mod=forseti&sec=adr');
  const bar = page.getByTestId('kit-views');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.getByLabel('Вид').selectOption('v-team');
  await expect(page).toHaveURL(/vw=v-team/);
  await bar.getByRole('button', { name: 'Поделиться' }).click();
  const link = bar.getByLabel('Ссылка на вид');
  await expect(link).toHaveValue(/vw=v-team/);
  await expect(link).not.toHaveValue(/lq=/);
  expect(await pageOverflow(page), 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `views-share-${info.project.name}.png`), fullPage: false });
});
