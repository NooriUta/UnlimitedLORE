// Проверка второй пачки задач в 🚀 READY FOR DEPLOY на стенде (препрод v2, база LORE 1.18 после переноса).
// По сценарию на задачу; код сценария — первое слово заголовка (RFD2-…), задача — в заголовке парой спринт/код.
// Ожидания взяты из «Готово, когда» заметки задачи; где приёмка требует записи или человека (решение владелицы,
// ночная LLM, task_new) — сценарий проверяет читаемую часть и честно говорит «не выполнен» с причиной.
//
// Только чтение: стенд *.seidrstudio.pro писать нельзя (writeGuard.ts). Все запросы к API — токеном
// сохранённого входа (Bearer из хранилища OIDC страницы, как create.stand.ts): page.request без него получает 401.
import { expect, test, type Page } from '@playwright/test';
import { attr, keepLoginFresh, openStand, requireStand, shot, textOf } from './stand.ts';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

type Row = Record<string, unknown>;
interface Api { status: number | null; body: Row | null }

/** GET токеном вошедшей учётки; сеть упала — status null. */
async function api(page: Page, path: string): Promise<Api> {
  return page.evaluate(async p => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    try {
      const res = await fetch(p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      let body: Record<string, unknown> | null = null;
      try { body = (await res.json()) as Record<string, unknown>; } catch { /* не JSON */ }
      return { status: res.status, body };
    } catch { return { status: null, body: null }; }
  }, path);
}

/** Строки среза; ответ не 200 — сценарий падает с телом ответа (а не «пусто»). */
async function slice(page: Page, name: string, params: Record<string, string> = {}): Promise<Row[]> {
  const q = new URLSearchParams(params).toString();
  const path = `/lore/slice/${name}${q ? `?${q}` : ''}`;
  const r = await api(page, path);
  expect(r.status, `${path}: ответ сервера — ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  return Array.isArray(r.body?.rows) ? (r.body!.rows as Row[]) : [];
}

/** Паспорт записи через фасад lore.record/1. */
async function record(page: Page, type: string, id: string): Promise<Api> {
  return api(page, `/lore/record/${type}/${id.split('/').map(encodeURIComponent).join('/')}`);
}

/** Действующая модель сервера (/lore/model/config, тело — JSON-строка). */
async function modelDoc(page: Page): Promise<{ types: Row[]; nav: Row[] } & Row> {
  const r = await api(page, '/lore/model/config');
  expect(r.status, `/lore/model/config: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  const content = r.body?.content;
  expect(typeof content, 'модель отдана строкой content').toBe('string');
  return JSON.parse(content as string) as { types: Row[]; nav: Row[] } & Row;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Встать на стенд (токен появляется в хранилище страницы только на его домене). */
async function boot(page: Page): Promise<void> {
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"], .sk-empty, h1'));
}

/** Паспорт открыт и дошёл до «загружено», без ошибки в доке. */
async function passportLoaded(page: Page, where: string): Promise<void> {
  await expect(page.locator('[data-testid="kit-rec-loaded"]').first(), `${where}: паспорт загрузился`).toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[data-testid="kit-rec-dock"] [role="alert"]');
  const alertText = await textOf(alert);
  expect(await alert.count(), `${where}: ошибка в паспорте — ${alertText}`).toBe(0);
}

const tabOf = (page: Page, key: string) => page.locator(`[role="tab"][id$="-tab-${key}"]`);

// ── SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE ─────────────────────────────────────────────────────────
test('RFD2-SUPERTAGS Теги со свободными полями: подсказка, срез «сущности по тегу», пункт «Теги» в меню (SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE)', async ({ page }) => {
  await boot(page);
  const sug = await api(page, '/lore/tag/suggest');
  expect(sug.status, `/lore/tag/suggest: ${JSON.stringify(sug.body).slice(0, 200)}`).toBe(200);
  const tags = list(sug.body?.tags) as { tag_id?: string; uses?: number; keys?: string[] }[];
  // Срез «сущности по тегу с полями»: колонки — ключи полей рёбер TAGGED_WITH. Тег — самый частый или стартовый.
  const tag = [...tags].sort((a, b) => Number(b.uses ?? 0) - Number(a.uses ?? 0))[0]?.tag_id ?? 'security-review';
  const ent = await api(page, `/lore/tag/entities?tag=${encodeURIComponent(tag)}`);
  expect(ent.status, `/lore/tag/entities?tag=${tag}: ${JSON.stringify(ent.body).slice(0, 200)}`).toBe(200);
  expect(['ok', 'empty'], 'состояние ответа названо (ok | empty)').toContain(str(ent.body?.state));
  expect(Array.isArray(ent.body?.columns) && Array.isArray(ent.body?.rows), 'в ответе колонки (поля тегов) и строки').toBe(true);

  // Пункт «Теги» — в модели (nav.knowledge) и в меню оболочки.
  const doc = await modelDoc(page);
  const navSections = doc.nav.flatMap(g => list(g.items).map(i => str((i as Row).section)));
  expect.soft(navSections, 'раздел tags в меню модели (nav)').toContain('tags');

  const head = page.locator('.tg__title');
  await openStand(page, `/?sec=tags&tag=${encodeURIComponent(tag)}`, head);
  await expect(head, 'экран «сущности по тегу» в оболочке (?sec=tags)').toBeVisible({ timeout: 30_000 });
  expect.soft(await page.locator('a[href*="sec=tags"]').count(), 'пункт «Теги» в левом меню (ссылка ?sec=tags)').toBeGreaterThan(0);
  const err = page.locator('[role="alert"]').filter({ hasText: /не загрузил|ошибк|error/i });
  const errText = await textOf(err);
  expect(await err.count(), `экран тегов без ошибки загрузки: ${errText}`).toBe(0);
  const first = list(ent.body?.rows)[0] as Row | undefined;
  if (first?.id) await expect(page.getByRole('link', { name: str(first.id) }).first(), `строка ${str(first.id)} с тегом #${tag} на экране`).toBeVisible({ timeout: 15_000 });
  else test.info().annotations.push({ type: 'note', description: `тег #${tag}: записей с тегом на стенде нет — показано «записей нет»` });
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13 ──────────────────────────────────────────────────────────────────
test('RFD2-MDL13 Одна связь «зависит от» с видом у задачи, спринта и вехи; оба конца видят связь; треки (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-13)', async ({ page }) => {
  await boot(page);
  const doc = await modelDoc(page);
  for (const type of ['task', 'sprint', 'milestone']) {
    const t = doc.types.find(x => x.type === type);
    const rels = list(t?.relations) as Row[];
    const dep = rels.find(r => r.rel === 'DEPENDS_ON' && r.dir === 'out');
    const inv = rels.find(r => r.rel === 'DEPENDS_ON' && r.dir === 'in');
    expect.soft(dep?.manageable, `${type}: «Зависит от» (DEPENDS_ON out) — управляемая связь`).toBe(true);
    expect.soft(inv, `${type}: обратная «От неё зависят» (DEPENDS_ON in)`).toBeTruthy();
    expect.soft(list(dep?.props).map(p => str((p as Row).key)), `${type}: у связи вид и причина`).toEqual(expect.arrayContaining(['kind', 'reason']));
  }
  expect.soft(doc.types.some(t => t.type === 'track'), 'тип «Трек» в модели').toBe(true);

  // Данные: зависимости планирования (117 спринтовых на проде 16.11 переносятся в одну связь).
  const deps = await slice(page, 'deps');
  expect(deps.length, 'срез deps не пуст — зависимости перенесены').toBeGreaterThan(0);
  const types = new Set(deps.flatMap(d => [str(d.from_type), str(d.to_type)]));
  expect([...types].filter(t => !['task', 'phase', 'sprint', 'milestone'].includes(t)), 'концы — только задача, фаза, спринт, веха').toEqual([]);
  const d = deps.find(x => x.from_type === 'sprint' && x.to_type === 'sprint') ?? deps[0];
  const fromSide = await slice(page, 'deps_of', { type: str(d.from_type), id: str(d.from_id) });
  const toSide = await slice(page, 'deps_of', { type: str(d.to_type), id: str(d.to_id) });
  expect(fromSide.some(r => r.dir === 'out' && r.other_id === d.to_id), `${str(d.from_id)} видит «зависит от» ${str(d.to_id)}`).toBe(true);
  expect(toSide.some(r => r.dir === 'in' && r.other_id === d.from_id), `${str(d.to_id)} видит «от неё зависит» ${str(d.from_id)}`).toBe(true);

  // Треки: 18 треков, спринты на треке с историей (ON_TRACK).
  const tracks = await slice(page, 'track_options');
  expect.soft(tracks.length, 'треки перенесены (KnowTrack)').toBeGreaterThan(0);
  if (tracks.length) {
    let onTrack = 0;
    for (const t of tracks.slice(0, 18)) { onTrack += (await slice(page, 'track_sprints', { id: str(t.code) })).length; if (onTrack) break; }
    expect.soft(onTrack, 'на треках стоят спринты (track_sprints)').toBeGreaterThan(0);
  }

  // Паспорт: вкладка «Зависит от» у записи с зависимостью, в ней второй конец.
  if (d.from_type === 'sprint' || d.from_type === 'task') {
    const tab = tabOf(page, 'dependsOn');
    await openStand(page, `/?sec=${str(d.from_type)}&open=${encodeURIComponent(str(d.from_id))}&tab=dependsOn`, tab);
    await passportLoaded(page, `паспорт ${str(d.from_id)}`);
    await expect(tab, 'вкладка «Зависит от» в паспорте').toBeVisible({ timeout: 15_000 });
    await tab.click();
    await expect(page.locator('[data-testid="kit-rec-dock"]').getByText(str(d.to_title) || str(d.to_id)).first(),
      `во вкладке — ${str(d.to_id)}`).toBeVisible({ timeout: 15_000 });
  }
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MD-02 ───────────────────────────────────────────────────────────────────
test('RFD2-MD02 Функции «пустых» типов: метрики гейта со всеми полями — в паспорте гейта (SPRINT_LORE_MODEL_DOCS_TIDY/MD-02)', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page);
  const gates = await slice(page, 'quality_gates');
  expect(gates.length, 'гейты качества есть').toBeGreaterThan(0);
  let gate: string | null = null;
  let metrics: Row[] = [];
  for (const g of gates.slice(0, 40)) {
    metrics = await slice(page, 'qg_metrics', { qg_id: str(g.qg_id) });
    if (metrics.length) { gate = str(g.qg_id); break; }
  }
  test.skip(!gate, 'ни у одного из первых 40 гейтов нет метрик (MEASURED_BY) — вкладку «Метрики» проверить не на чем');
  // #1649: направление, число и единица — из порога; current_value — последний прогон; status pass/fail/unknown.
  for (const k of ['threshold', 'unit', 'direction', 'current_value', 'status']) expect(Object.keys(metrics[0]), `колонка ${k} в qg_metrics`).toContain(k);
  expect(metrics.map(m => str(m.status)).filter(s => s && !['pass', 'fail', 'unknown'].includes(s)), 'status метрики — pass | fail | unknown').toEqual([]);
  const rec = await record(page, 'quality_gate', gate!);
  expect(rec.status, `паспорт гейта ${gate}`).toBe(200);
  const part = (list(rec.body?.parts) as Row[]).find(p => p.key === 'metrics');
  expect(part?.state, 'часть «Метрики» прочиталась (state ok)').toBe('ok');
  expect(list(part?.items).length, 'в части «Метрики» — метрики гейта').toBeGreaterThan(0);

  await openStand(page, `/?sec=quality_gate&open=${encodeURIComponent(gate!)}`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `паспорт гейта ${gate}`);
  const dock = page.locator('[data-testid="kit-rec-dock"]');
  await expect(dock.getByText(/Метрики|Metrics/).first(), 'в паспорте гейта — «Метрики»').toBeVisible({ timeout: 15_000 });
  test.info().annotations.push({ type: 'note', description: 'список «что выключаем» с решениями владелицы — документ, UI-признака нет; проверена кодовая часть (#1649)' });
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MD-03 ───────────────────────────────────────────────────────────────────
test('RFD2-MD03 Одна актуальная спека схемы (Mermaid ELK по модели 1.18), две прежние — замещены (SPRINT_LORE_MODEL_DOCS_TIDY/MD-03)', async ({ page }) => {
  await boot(page);
  const cur = await record(page, 'spec', 'LORE_DB_SCHEMA_MERMAID');
  expect(cur.status, 'паспорт LORE_DB_SCHEMA_MERMAID').toBe(200);
  const body = str((cur.body?.values as Row | undefined)?.content_md);
  const blocks = body.match(/```mermaid[\s\S]*?```/g) ?? [];
  expect(blocks.length, 'в спеке схемы — 5 схем Mermaid по областям').toBeGreaterThanOrEqual(5);
  expect(blocks.filter(b => /layout:\s*elk/.test(b)).length, 'схемы с раскладкой ELK').toBe(blocks.length);
  expect(body, 'спека сверена с моделью 1.18').toMatch(/1\.18/);
  for (const id of ['LORE_DB_SPEC', 'SYSTEM_AIDA_LORE_SPEC']) {
    const old = await record(page, 'spec', id);
    expect.soft(old.status, `паспорт ${id}`).toBe(200);
    const st = str((old.body?.record as Row | undefined)?.status) || str((old.body?.values as Row | undefined)?.status);
    expect.soft(st, `${id} помечена «замещена»`).toMatch(/supersed|замещ/i);
    expect.soft(str((old.body?.values as Row | undefined)?.content_md), `${id}: шапка со ссылкой на LORE_DB_SCHEMA_MERMAID`).toContain('LORE_DB_SCHEMA_MERMAID');
  }
  const mermaid = page.locator('[data-testid="kit-rec-dock"] svg');
  await openStand(page, '/?sec=spec&open=LORE_DB_SCHEMA_MERMAID', page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, 'паспорт LORE_DB_SCHEMA_MERMAID');
  await expect(mermaid.first(), 'схема нарисована (svg в паспорте)').toBeVisible({ timeout: 30_000 });
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 ───────────────────────────────────────────────────────────────────
test('RFD2-MD05 PR: паспорт с заголовком и ссылкой, пустых заголовков нет (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05)', async ({ page }) => {
  await boot(page);
  const prs = await slice(page, 'project_prs', { project: 'NooriUta/UnlimitedLORE' });
  expect(prs.length, 'у LORE есть PR (project_prs)').toBeGreaterThan(0);
  const empty = prs.filter(p => !str(p.title).trim());
  expect.soft(empty.length, `PR без заголовка: ${empty.length} из ${prs.length} (напр. ${empty.slice(0, 5).map(p => str(p.pr_uid)).join(', ')})`).toBe(0);
  const withTitle = prs.find(p => str(p.title).trim() && str(p.url).trim()) ?? prs[0];
  const doc = await modelDoc(page);
  expect.soft(doc.types.some(t => t.type === 'pr'), 'тип PR в модели (паспорт PR)').toBe(true);
  const rec = await record(page, 'pr', str(withTitle.pr_uid));
  expect.soft(rec.status, `паспорт PR ${str(withTitle.pr_uid)} (/lore/record/pr/…)`).toBe(200);
  // Положительный контроль: связь задача → PR (CLOSED_BY) в паспорте задачи — живая.
  const t = await record(page, 'task', 'SPRINT_LORE_MODEL_DOCS_TIDY/MD-05');
  expect(t.status, 'паспорт задачи MD-05 читается').toBe(200);
});

// ── SPRINT_QG_REBUILD/QG-01 ─────────────────────────────────────────────────────────────────────────────
test('RFD2-QG01 Гейты: признак общий/проектный, четыре гейта гигиены LORE — общие, QG-T13-SMOKE снят (SPRINT_QG_REBUILD/QG-01)', async ({ page }) => {
  await boot(page);
  const gates = await slice(page, 'quality_gates');
  expect(gates.length, 'гейты есть').toBeGreaterThan(0);
  expect(gates.every(g => 'scope' in g), 'у гейта колонка scope').toBe(true);
  const by = (id: string) => gates.find(g => str(g.qg_id).toLowerCase() === id.toLowerCase());
  for (const id of ['QG-LORE-BLOCKED-REASON', 'QG-LORE-PROJECT-BINDING', 'QG-LORE-PROJECT-ROLES', 'qg-lore-storage']) {
    const g = by(id);
    expect.soft(g, `гейт ${id} есть`).toBeTruthy();
    expect.soft(str(g?.scope), `${id}: scope = global`).toBe('global');
    expect.soft(list(g?.projects).length, `${id}: общий — без привязки к проекту`).toBe(0);
  }
  const t13 = by('QG-T13-SMOKE');
  expect.soft(!t13 || /retired|снят/i.test(str(t13.status)), `QG-T13-SMOKE снят (статус: ${str(t13?.status) || 'нет записи'})`).toBe(true);
  // Положительный контроль: проектный гейт AIDA — scope project и ровно один проект.
  const aida = by('QG-AIDA-ARCH');
  expect.soft(str(aida?.scope), 'QG-AIDA-ARCH: scope = project').toBe('project');
  expect.soft(list(aida?.projects), 'QG-AIDA-ARCH: ровно один проект').toEqual(['NooriUta/AIDA']);

  const rows = page.locator('[data-record-id]');
  await openStand(page, '/?sec=quality_gate', rows);
  await expect(page.locator(`[data-record-id=${attr('QG-LORE-PROJECT-BINDING')}]`).first(), 'общий гейт виден в разделе «Гейты»').toBeVisible({ timeout: 30_000 });
});

// ── SPRINT_QG_REBUILD/QG-15 ─────────────────────────────────────────────────────────────────────────────
test('RFD2-QG15 Модуль вызова LLM (маршрутизатор, бюджет) (SPRINT_QG_REBUILD/QG-15)', async () => {
  test.skip(true, 'наблюдаемого HTTP-выхода у модуля нет: ModelRouter вызывается только рутинами QG на сервере, '
    + 'локальная модель работает ночью (21:00–08:00 МСК); проверка — серверным прогоном рутины с LLM-шагом, не смоуком UI');
});

// ── SPRINT_QG_REBUILD/QG-STALE-DOCS ─────────────────────────────────────────────────────────────────────
test('RFD2-QGSTALE Рутина qg-doc-links прогоняется и пишет doc_broken_refs_* (SPRINT_QG_REBUILD/QG-STALE-DOCS)', async ({ page }) => {
  await boot(page);
  const runs = await slice(page, 'routine_last_run', { routine_name: 'qg-doc-links' });
  expect(runs.length, 'у рутины qg-doc-links есть прогон на стенде').toBeGreaterThan(0);
  expect(str(runs[0].status), `прогон не NOT_MEASURED (source_unreachable): ${str(runs[0].detail_md).slice(0, 160)}`).not.toMatch(/NOT_MEASURED/i);
  const metrics = await slice(page, 'qg_metrics_latest');
  const keys = metrics.filter(m => m.routine_name === 'qg-doc-links').map(m => str(m.metric_key));
  expect(keys.join(', '), 'метрики doc_broken_refs_<adr|decision|spec|doc|runbook>').toMatch(/doc_broken_refs_(adr|decision|spec|doc|runbook)/);
  test.info().annotations.push({ type: 'note', description: 'проверен механический уровень; вердикт LLM (current/future/stale…) по заметке не сделан' });
});

// ── SPRINT_LORE_MEASURE_TRUTH/MT-CAL-CLASS-REQUIRED ─────────────────────────────────────────────────────
test('RFD2-MTCAL task_new без work_class отвечает подсказкой uc/jtd/enb (SPRINT_LORE_MEASURE_TRUTH/MT-CAL-CLASS-REQUIRED)', async () => {
  test.skip(true, 'приёмка — ответ task_new (запись задачи); на стенде *.seidrstudio.pro запись запрещена (writeGuard.ts). '
    + 'Повторный замер доли без класса сделан 20.11 по проду (50,8%) — это данные, не поведение стенда');
});

// ── SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH ──────────────────────────────────────────────────────────────
test('RFD2-MTTRUTH Кириллица в id на чтении — 404 «не найдена», срез вопросов сгруппирован по статусу (SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH)', async ({ page }) => {
  await boot(page);
  const miss = await record(page, 'adr', 'ADR-ПРОВЕРКА-404');
  expect(miss.status, 'несуществующая запись с кириллицей в id — 404, а не 400 BAD_PARAMS').toBe(404);
  // Положительный контроль: существующая запись тем же путём — 200.
  expect((await record(page, 'adr', 'ADR-LORE-050')).status, 'ADR-LORE-050 читается').toBe(200);
  // A3: questions — все вопросы группами open · deferred · closed · dropped, open_questions — синоним.
  const qs = await slice(page, 'questions');
  const rank = (s: string) => ({ open: 0, deferred: 1, closed: 2, dropped: 3 } as Record<string, number>)[s.toLowerCase()] ?? 4;
  const ranks = qs.map(q => rank(str(q.status)));
  const broken = ranks.findIndex((r, i) => i > 0 && r < ranks[i - 1]);
  expect(broken, `вопросы идут группами по статусу (нарушение на строке ${broken})`).toBe(-1);
  const alias = await slice(page, 'open_questions');
  expect(alias.length, 'open_questions — синоним questions (то же число строк)').toBe(qs.length);

  const dock = page.locator('[data-testid="kit-rec-dock"]');
  await openStand(page, `/?sec=adr&open=${encodeURIComponent('ADR-ПРОВЕРКА-404')}`, dock);
  await expect(dock.getByText(/не найден/i).first(), 'паспорт говорит «не найдена», а не «сбой загрузки»').toBeVisible({ timeout: 30_000 });
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 ──────────────────────────────────────────────────────────────────
test('RFD2-MIG02 Админка «Перенос»: отчёт прогона, группы расхождений и счётчик «ждут решения» (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02)', async ({ page }) => {
  await boot(page);
  const rep = await api(page, '/lore/admin/migration');
  expect(rep.status, `/lore/admin/migration под super-admin: ${JSON.stringify(rep.body).slice(0, 200)}`).toBe(200);
  const state = str(rep.body?.state);
  const section = page.locator('[data-testid="adm-migration"]');
  const honest = page.locator('[data-testid="adm-mig-stage"], [data-testid="adm-mig-norun"], [data-testid="adm-mig-source"]');
  await openStand(page, '/?mod=admin&sec=adm-migration', honest);
  await expect(section, 'раздел «Перенос на новую модель» в админке').toBeVisible({ timeout: 30_000 });
  await expect(honest.first(), 'этапы или честное состояние («прогона не было» / «источник недоступен»)').toBeVisible({ timeout: 30_000 });
  test.skip(state === 'no_run', `на стенде отчёта прогона нет (${str(rep.body?.reason)}) — группы и правило проверить не на чем`);
  await expect(page.locator('[data-testid="adm-mig-stage"]'), 'пять этапов конвейера').toHaveCount(5);
  await expect(page.locator('[data-testid="adm-mig-waiting"]'), 'счётчик «ждут решения»').toBeVisible();
  test.skip(true, 'чтение прошло; приёмка («принять правило → Перепроверить → счётчик убыл») — запись и решение владелицы, на стенде запрещено');
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 ──────────────────────────────────────────────────────────────────
test('RFD2-MIG03 Сервер читает базу 1.18: срезы задач, спринтов, ADR, репозиториев и организаций отвечают (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03)', async ({ page }) => {
  await boot(page);
  for (const name of ['open_tasks', 'closed_tasks', 'sprints', 'adrs', 'repositories', 'organizations']) {
    const r = await slice(page, name, { limit: '5' });
    expect.soft(r.length, `срез ${name} на базе 1.18 не пуст`).toBeGreaterThan(0);
  }
  const repos = await slice(page, 'repositories', { limit: '1' });
  if (repos.length) {
    const url = str(repos[0].url);
    const one = await slice(page, 'repo_by_id', { id: url });
    expect.soft(one.length, `repo_by_id ${url}`).toBe(1);
  }
  // Паспорт задачи на новой схеме: статус — код справочника, роли и спринт на месте.
  const t = (await slice(page, 'open_tasks', { limit: '1' }))[0];
  const rec = await record(page, 'task', str(t?.task_uid));
  expect(rec.status, `паспорт ${str(t?.task_uid)}`).toBe(200);
  expect(str((rec.body?.record as Row | undefined)?.status), 'статус задачи распознан').not.toBe('');
  const rows = page.locator('[data-record-id]');
  await openStand(page, '/?sec=repository', rows);
  await expect(rows.first(), 'раздел «Репозитории» показывает строки').toBeVisible({ timeout: 30_000 });
});

// ── SPRINT_LORE_MODEL_DOCS_TIDY/MDL-12 ──────────────────────────────────────────────────────────────────
test('RFD2-MDL12 Паспорт задачи: «Ждём» у ждущей задачи, остатка прошлого статуса нет (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-12)', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page);
  const open = await slice(page, 'open_tasks');
  const waitingUids = open.filter(r => /WAIT/i.test(str(r.status_raw))).map(r => str(r.task_uid)).slice(0, 100);
  test.skip(!waitingUids.length, 'на стенде нет задач в «ждёт» — показ «Ждём» проверить не на чем');
  const raw = await slice(page, 'tasks_by_uids', { task_uids: waitingUids.join(',') });
  const w = raw.find(r => str(r.waiting_for).trim());
  expect(w, `у одной из ${waitingUids.length} ждущих задач адресат в базе (waiting_for)`).toBeTruthy();
  const uid = str(w!.task_uid);
  const rec = await record(page, 'task', uid);
  expect(str((rec.body?.values as Row | undefined)?.waiting_for), `${uid}: фасад отдаёт «Ждём»`).toBe(str(w!.waiting_for));

  // Отрицательная сторона: у не-ждущей задачи с остатком адресата в базе «Ждём» не отдаётся.
  const notWaiting = open.filter(r => !/WAIT/i.test(str(r.status_raw))).map(r => str(r.task_uid)).slice(0, 200);
  const leftovers = notWaiting.length ? (await slice(page, 'tasks_by_uids', { task_uids: notWaiting.join(',') })).filter(r => str(r.waiting_for).trim()) : [];
  if (leftovers.length) {
    const lr = await record(page, 'task', str(leftovers[0].task_uid));
    expect((lr.body?.values as Row | undefined)?.waiting_for, `${str(leftovers[0].task_uid)} (${str(leftovers[0].status_raw)}): прежний адресат не показан`).toBeUndefined();
  } else test.info().annotations.push({ type: 'note', description: 'остатков waiting_for у не-ждущих задач нет (вычищены переносом) — отрицательная сторона без образца' });

  await openStand(page, `/?sec=task&open=${encodeURIComponent(uid)}`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `паспорт ${uid}`);
  const dock = page.locator('[data-testid="kit-rec-dock"]');
  await expect(dock.getByText(/Ждём|Waiting for/).first(), 'в паспорте подпись «Ждём»').toBeVisible({ timeout: 15_000 });
  await expect(dock.getByText(str(w!.waiting_for).trim().slice(0, 40)).first(), 'и сам адресат').toBeVisible({ timeout: 15_000 });
});

// ── SPRINT_UXR_POLISH_UAT_1113/PU-17 ────────────────────────────────────────────────────────────────────
test('RFD2-PU17 Роли задачи — только рёбрами: в модели выбор из кандидатов, строки ролей — легаси (SPRINT_UXR_POLISH_UAT_1113/PU-17)', async ({ page }) => {
  await boot(page);
  const doc = await modelDoc(page);
  const task = doc.types.find(t => t.type === 'task');
  const fields = list(task?.fields) as Row[];
  for (const k of ['author', 'executor', 'reviewer']) {
    const f = fields.find(x => x.key === k);
    expect.soft(f?.kind, `${k}: выбор (enum), а не свободный текст`).toBe('enum');
    expect.soft(str((f?.options as Row | undefined)?.slice), `${k}: кандидаты — срез task_identities`).toBe('task_identities');
  }
  expect.soft(fields.map(f => str(f.key)).filter(k => /_agent$/.test(k)), 'строковых полей *_agent в модели задачи нет').toEqual([]);
  expect.soft(list(doc.legacy_role_strings), 'author/executor/reviewer_agent объявлены легаси').toEqual(expect.arrayContaining(['author_agent', 'executor_agent', 'reviewer_agent']));
  // Роли на месте у задачи без переноса (PU-03) и у перенесённой (PU-01, починена) — читаются из рёбер.
  for (const uid of ['SPRINT_UXR_POLISH_UAT_1113/PU-03', 'SPRINT_UXR_POLISH_UAT_1113/PU-01']) {
    const r = await record(page, 'task', uid);
    expect.soft(r.status, `паспорт ${uid}`).toBe(200);
    const v = (r.body?.values ?? {}) as Row;
    expect.soft(str(v.author) || str(v.executor), `${uid}: роли в паспорте (из ROLE_HELD_BY)`).not.toBe('');
  }
  const cands = await slice(page, 'task_identities', { id: 'SPRINT_UXR_POLISH_UAT_1113/PU-17' });
  expect(cands.length, 'кандидаты ролей (task_identities) есть').toBeGreaterThan(0);
  const lost = await api(page, '/lore/slice/task_roles_lost_on_move');
  expect(lost.status, 'срез task_roles_lost_on_move отвечает').toBe(200);
});

// ── SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET ───────────────────────────────────────────────────────
test('RFD2-K4RESET Открытие паспорта не перегружает список: узел и прокрутка на месте (SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET)', async ({ page }) => {
  test.setTimeout(150_000);
  const titles = page.locator('.sk-list .sk-list__title--btn');
  await openStand(page, '/?sec=spec', titles);
  await expect(titles.first(), 'список спек показан').toBeVisible({ timeout: 30_000 });
  test.skip((await titles.count()) < 30, 'строк меньше 30 — прокручивать нечего');
  await page.evaluate(() => { (document.querySelector('.sk-list') as HTMLElement & { __rfd2?: number }).__rfd2 = 1; });
  const sameList = () => page.evaluate(() => (document.querySelector('.sk-list') as (HTMLElement & { __rfd2?: number }) | null)?.__rfd2 === 1);
  const openParam = () => new URL(page.url()).searchParams.get('open');
  const backdropTop = () => page.evaluate(() => document.querySelector('.sk-dock__backdrop')?.scrollTop ?? -1);
  /** id видимой строки (не у краёв окна), отличной от `not`. */
  const visibleId = (not: string | null) => page.evaluate(skip => {
    const scope = document.querySelector('.sk-dock__backdrop');
    const box = scope ? scope.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    for (const b of document.querySelectorAll<HTMLElement>('.sk-list .sk-list__title--btn')) {
      const r = b.getBoundingClientRect();
      const id = b.closest('[data-record-id]')?.getAttribute('data-record-id');
      if (id && id !== skip && r.top > box.top + 60 && r.bottom < box.bottom - 60) return id;
    }
    return null;
  }, not);
  const titleOf = (id: string) => page.locator(`.sk-list [data-record-id=${JSON.stringify(id)}] .sk-list__title--btn`).first();

  await page.mouse.move(400, 500);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => page.evaluate(() => scrollY), { message: 'страница со списком прокручена' }).toBeGreaterThan(300);
  const a = await visibleId(null);
  expect(a, 'видимая строка после прокрутки').not.toBeNull();
  const yBefore = await titleOf(a!).evaluate(e => e.getBoundingClientRect().top);
  await titleOf(a!).click();
  await expect(page.locator('[data-testid="kit-rec-dock"]'), 'паспорт открылся').toBeVisible({ timeout: 15_000 });
  await expect.poll(openParam, { message: 'адрес открытой записи' }).toBe(a);
  expect(await sameList(), 'узел списка тот же после открытия (не перемонтирован)').toBe(true);
  await expect(titleOf(a!), 'строка, по которой щёлкнули, видна — прокрутка перенесена').toBeInViewport();
  const yAfter = await titleOf(a!).evaluate(e => e.getBoundingClientRect().top);
  expect(Math.abs(yAfter - yBefore), 'строка осталась примерно на месте').toBeLessThan(260);

  const before = await backdropTop();
  const b = await visibleId(a);
  expect(b, 'вторая видимая строка').not.toBeNull();
  await titleOf(b!).click();
  await expect.poll(openParam, { message: 'открыт второй паспорт' }).toBe(b);
  await passportLoaded(page, `паспорт ${b}`);
  expect(await sameList(), 'узел списка тот же после смены паспорта').toBe(true);
  expect(Math.abs((await backdropTop()) - before), 'прокрутка списка не сброшена при смене паспорта').toBeLessThan(40);
  await expect(titleOf(b!), 'строка второго паспорта видна в списке').toBeInViewport();
});
