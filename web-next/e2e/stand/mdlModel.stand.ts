// Модель 1.18 на препроде: определения полей (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-04) и предупреждение о виде значения
// при записи (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06). MDL04 только читает; MDL06 пишет TEST-данные (@writes, writeGuard).
import { expect, test } from '@playwright/test';
import { keepLoginFresh, openStand, requireStand, shot } from './stand.ts';
import { preprodTestWriteRefusal, WRITES_TAG } from './writeGuard.ts';
import { call, ensureTestProject, TEST_PROJECT_A } from './testData.ts';

test.beforeEach(() => requireStand());
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const note = (d: string) => test.info().annotations.push({ type: 'note', description: d });
const boot = (page: import('@playwright/test').Page) => openStand(page, '/news', page.locator('[data-testid^="news-row-"], .sk-empty, h1'));

/** В файле модели 8877957a — 217 полей с определением; первый заход MDL-04 обещал не меньше 194. */
const MIN_DEFINED = 194;

test('MDL04 У полей модели есть определения (не меньше 194); откуда модель — LORE или файл (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-04)', async ({ page }) => {
  await boot(page);
  const cfg = await call(page, 'GET', '/lore/model/config');
  expect(cfg.status, `/lore/model/config: ${cfg.text}`).toBe(200);
  const source = String(cfg.body?.source ?? '');
  const doc = JSON.parse(String(cfg.body?.content ?? '{}')) as { types?: { type: string; fields?: { key: string; definition?: string }[] }[] };
  const fields = (doc.types ?? []).flatMap(t => (t.fields ?? []).map(f => ({ t: t.type, k: f.key, d: f.definition })));
  const defined = fields.filter(f => typeof f.d === 'string' && f.d.trim()).length;
  const hist = await call(page, 'GET', '/lore/slice/model_config_history');
  const versions = (Array.isArray(hist.body?.rows) ? hist.body!.rows : []) as { valid_from?: string; valid_to?: string | null }[];
  const current = versions.find(v => !v.valid_to) ?? versions[0];
  // Факт для отчёта: сервер отдаёт модель из LORE (KnowModelConfig) или файл репозитория. Из LORE — новых
  // определений файла не будет, пока версию в базе не обновят.
  note(`модель: источник ${source || '?'}, hash ${String(cfg.body?.hash ?? '?')}, seed_drift ${String(cfg.body?.seed_drift)}, `
    + `действующая версия KnowModelConfig с ${current?.valid_from ?? '?'}; полей ${fields.length}, с определением ${defined}`);
  expect(defined, `полей с определением ${defined} из ${fields.length} (источник «${source}», версия с ${current?.valid_from ?? '?'}, seed_drift ${String(cfg.body?.seed_drift)})`)
    .toBeGreaterThanOrEqual(MIN_DEFINED);
});

test('MDL06 Запись значения не того вида — предупреждение FIELD_KIND_MISMATCH в ответе; верное значение — без него (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06)', { tag: WRITES_TAG }, async ({ page }) => {
  // Поле и путь — из модели (заметка MDL-06: «сервер при записи сверяет значение с видом поля из модели»): у спринта
  // planned_start — дата, путь записи /lore/sprint/plan, поле тела planned_start_date.
  const SPRINT = 'TEST_SPRINT_TYPING';
  const refusal = preprodTestWriteRefusal(process.env.LORE_STAND_URL?.trim(),
    { writer: test.info().tags.includes(WRITES_TAG), ids: [SPRINT, TEST_PROJECT_A] });
  test.skip(refusal !== null, `запись не выполняется: ${refusal}`);
  await boot(page);
  await ensureTestProject(page, TEST_PROJECT_A);
  if ((await call(page, 'GET', `/lore/record/sprint/${SPRINT}`)).status !== 200) {
    const c = await call(page, 'POST', '/lore/sprint/create', { sprint_id: SPRINT, name: 'Тестовый спринт: вид значения при записи (смоук стенда)', git_project: TEST_PROJECT_A });
    expect(c.status, `завести ${SPRINT}: ${c.text}`).toBe(200);
  }
  const bad = await call(page, 'POST', '/lore/sprint/plan', { sprint_id: SPRINT, planned_start_date: 'вчера' });
  note(`«вчера» в дату: ответ ${bad.status}`);
  const warns = (bad.body?.warnings ?? []) as { code?: string; field?: string }[];
  expect(warns.map(w => w.code), `предупреждение о виде значения в ответе: ${bad.text}`).toContain('FIELD_KIND_MISMATCH');
  expect(bad.text, 'названо поле').toMatch(/planned_start/);
  // Положительный контроль (и возврат TEST-спринта к верной дате): корректная дата — без предупреждения.
  const good = await call(page, 'POST', '/lore/sprint/plan', { sprint_id: SPRINT, planned_start_date: '2026-11-21' });
  expect(good.status, `верная дата записана: ${good.text}`).toBe(200);
  expect(((good.body?.warnings ?? []) as { code?: string }[]).map(w => w.code), 'верная дата — без предупреждения').not.toContain('FIELD_KIND_MISMATCH');
});
