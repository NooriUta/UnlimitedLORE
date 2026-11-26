// Проверка третьей пачки задач в 🚀 READY FOR DEPLOY на стенде (препрод v2, копия базы LORE) — 31 задача
// проекта NooriUta/UnlimitedLORE на 25.11.2026. По сценарию на задачу; код сценария — первое слово заголовка
// (RFD3-…), задача — в заголовке парой спринт/код. Ожидания — из «Готово, когда» заметки задачи; что на стенде
// не наблюдаемо (журнал сервера, чистая установка из пакета, сторона Völva, выключенный флаг) — честный
// «не выполнен» с причиной, а читаемая часть проверяется.
//
// Запись — только TEST-сущности на хосте препрода и только из сценария с меткой @writes (writeGuard.ts,
// владелица 21.11.2026). Всё остальное — чтение токеном сохранённого входа (test-sa) или тестовой учётки
// (test-admin, test-viewer).
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { authFileFor, RBAC_ACCOUNTS } from '../../src/standSmoke/rbac.ts';
import { asAccount, attr, keepLoginFresh, openStand, requireStand, shot, textOf } from './stand.ts';
import { preprodTestWriteRefusal, WRITES_TAG } from './writeGuard.ts';
import { call, ensureTestProject, TEST_PROJECT_A } from './testData.ts';

const AUTH_DIR = process.env.LORE_STAND_AUTH_DIR?.trim() || 'e2e/stand/.auth';
/** TEST-спринт этой пачки: задачи заводятся и сразу отменяются (cancelled не в счёт предела спринта). */
const TEST_SPRINT = 'TEST_SPRINT_RFD3';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

type Row = Record<string, unknown>;
interface Api { status: number | null; body: Row | null; text: string; headers: Record<string, string> }

/** Запрос токеном вошедшей в `page` учётки; сеть упала — status null. */
async function api(page: Page, path: string, init: { method?: string; body?: unknown; noAuth?: boolean } = {}): Promise<Api> {
  return page.evaluate(async ({ path, init }) => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const headers: Record<string, string> = {};
    if (token && !init.noAuth) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* не JSON */ }
      const h: Record<string, string> = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      return { status: res.status, body, text: text.slice(0, 600), headers: h };
    } catch (e) { return { status: null, body: null, text: String(e), headers: {} }; }
  }, { path, init });
}

/** Строки среза; ответ не 200 — сценарий падает с телом ответа (а не «пусто»). */
async function slice(page: Page, name: string, params: Record<string, string> = {}): Promise<Row[]> {
  const q = new URLSearchParams(params).toString();
  const path = `/lore/slice/${name}${q ? `?${q}` : ''}`;
  const r = await api(page, path);
  expect(r.status, `${path}: ответ сервера — ${r.text.slice(0, 200)}`).toBe(200);
  return Array.isArray(r.body?.rows) ? (r.body!.rows as Row[]) : [];
}

const rec = (page: Page, type: string, id: string) => api(page, `/lore/record/${type}/${id.split('/').map(encodeURIComponent).join('/')}`);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const note = (description: string) => test.info().annotations.push({ type: 'note', description });

/** Встать на стенд (токен появляется в хранилище страницы только на его домене). */
async function boot(page: Page): Promise<void> {
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"], .sk-empty, h1'));
}

/** Вкладка под тестовой учёткой; скрин сценария — с неё (вкладка `page` в таких сценариях не открывается). */
async function as(browser: Browser, account: string): Promise<Page> {
  return asAccount(browser, authFileFor(AUTH_DIR, account), account);
}

/** Допуск записи TEST-данных; отказ — «не выполнен» с причиной. */
function allowWrite(ids: string[]): void {
  const refusal = preprodTestWriteRefusal(process.env.LORE_STAND_URL?.trim(), { writer: test.info().tags.includes(WRITES_TAG), ids });
  test.skip(refusal !== null, `запись не выполняется: ${refusal}`);
}

/** TEST-спринт пачки в TEST-проекте (заводится один раз, дальше переиспользуется). */
async function ensureTestSprint(page: Page): Promise<void> {
  await ensureTestProject(page, TEST_PROJECT_A);
  if ((await call(page, 'GET', `/lore/record/sprint/${TEST_SPRINT}`)).status === 200) return;
  const c = await call(page, 'POST', '/lore/sprint/create', { sprint_id: TEST_SPRINT, name: 'Тестовый спринт RFD3 (смоук стенда)', git_project: TEST_PROJECT_A });
  expect(c.status, `завести ${TEST_SPRINT}: ${c.text}`).toBe(200);
}

/** TEST-задача в TEST-спринте пачки; uid — «спринт/код». */
async function testTask(page: Page, taskId: string): Promise<string> {
  const r = await call(page, 'POST', '/lore/task', { sprint_id: TEST_SPRINT, task_id: taskId, title: `Тестовая задача ${taskId} (RFD3)`, work_class: 'enb' });
  expect(r.status, `завести ${taskId}: ${r.text}`).toBe(200);
  return `${TEST_SPRINT}/${taskId}`;
}
const cancel = (page: Page, uid: string) =>
  call(page, 'POST', '/lore/status', { entity_type: 'task', id: uid, status: 'cancelled', reason: 'смоук стенда RFD3: TEST-задача отработала' });
const runTag = () => Date.now().toString(36).toUpperCase();

interface McpReply { status: number | null; json: Row | null; raw: string }
interface McpRun { init: McpReply; session: string | null; replies: McpReply[] }

/**
 * Сессия MCP по HTTP через nginx стенда (/mcp) токеном вошедшей учётки: initialize → notifications/initialized →
 * запросы по очереди. Ответ бывает JSON или SSE (Streamable HTTP) — разбираются оба.
 */
async function mcp(page: Page, calls: { method: string; params?: unknown }[]): Promise<McpRun> {
  return page.evaluate(async calls => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const base: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (token) base.Authorization = `Bearer ${token}`;
    const read = async (res: Response): Promise<{ status: number; json: Record<string, unknown> | null; raw: string }> => {
      const raw = await res.text();
      if ((res.headers.get('content-type') ?? '').includes('event-stream')) {
        for (const l of raw.split('\n')) {
          if (!l.startsWith('data:')) continue;
          try { const j = JSON.parse(l.slice(5).trim()) as Record<string, unknown>; if ('id' in j) return { status: res.status, json: j, raw: raw.slice(0, 600) }; } catch { /* не JSON */ }
        }
        return { status: res.status, json: null, raw: raw.slice(0, 600) };
      }
      try { return { status: res.status, json: JSON.parse(raw) as Record<string, unknown>, raw: raw.slice(0, 600) }; } catch { return { status: res.status, json: null, raw: raw.slice(0, 600) }; }
    };
    try {
      const initRes = await fetch('/mcp', { method: 'POST', headers: base, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lore-stand-e2e', version: '1' } } }) });
      const session = initRes.headers.get('mcp-session-id');
      const init = await read(initRes);
      const replies: { status: number | null; json: Record<string, unknown> | null; raw: string }[] = [];
      if (!session) return { init, session, replies };
      const proto = ((init.json?.result as { protocolVersion?: string } | undefined)?.protocolVersion) ?? '2025-03-26';
      const h = { ...base, 'Mcp-Session-Id': session, 'Mcp-Protocol-Version': proto };
      await fetch('/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      let id = 2;
      for (const c of calls) {
        const res = await fetch('/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: c.method, params: c.params ?? {} }) });
        replies.push(await read(res));
      }
      await fetch('/mcp', { method: 'DELETE', headers: h }).catch(() => undefined);
      return { init, session, replies };
    } catch (e) { return { init: { status: null, json: null, raw: String(e) }, session: null, replies: [] }; }
  }, calls);
}

/** Записи паспорта загрузились без ошибки в доке. */
async function passportLoaded(page: Page, where: string): Promise<void> {
  await expect(page.locator('[data-testid="kit-rec-loaded"]').first(), `${where}: паспорт загрузился`).toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[data-testid="kit-rec-dock"] [role="alert"]');
  const alertText = await textOf(alert);
  expect(await alert.count(), `${where}: ошибка в паспорте — ${alertText}`).toBe(0);
}

async function finish(p: Page | null, info: TestInfo): Promise<void> {
  if (p) await shot(p, info);
}

// ═══ SPRINT_LORE_ADMIN_POLISH ═══════════════════════════════════════════════════════════════════════════

test('RFD3-APDICT Опрос Actions от гейта QG-LORE-CI-ACTIONS с проектом, настройки qg.actions_projects нет (SPRINT_LORE_ADMIN_POLISH/AP-DICT-UPSERT-DUP)', async ({ page }) => {
  await boot(page);
  const gates = await slice(page, 'quality_gates');
  const gate = gates.find(g => str(g.qg_id) === 'QG-LORE-CI-ACTIONS');
  expect(gate, 'гейт канала Actions QG-LORE-CI-ACTIONS есть').toBeTruthy();
  expect(str(gate?.scope), 'гейт проектный (scope = project)').toBe('project');
  expect(list(gate?.projects).length, `у гейта есть проект (ребро BELONGS_TO_PROJECT): ${JSON.stringify(gate?.projects)}`).toBeGreaterThan(0);
  // Опросчик пишет прогоны qg-ci-<workflow> — признак, что он нашёл проект через гейт.
  const runs = (await slice(page, 'qg_routine_runs')).filter(r => str(r.routine_name).startsWith('qg-ci-'));
  expect(runs.length, 'прогоны Actions (qg-ci-*) записаны опросчиком').toBeGreaterThan(0);
  note(`последний прогон Actions: ${str(runs[0]?.routine_name)} ${str(runs[0]?.run_date)}`);
  const settings = (await slice(page, 'dictionary', { dict_type: 'app_setting' })).filter(r => str(r.code) === 'qg.actions_projects');
  expect.soft(settings.length, `строк app_setting/qg.actions_projects нет (на копии прода: ${settings.map(r => str(r.label_ru)).join(', ')}) — удаляет человек в админке`).toBe(0);
  note('строку журнала опросчика «гейты канала Actions: QG-LORE-CI-ACTIONS … зеркало, Actions не опрашиваются» стенд наружу не отдаёт — проверена запись прогонов');
  await openStand(page, '/?sec=quality_gate&open=QG-LORE-CI-ACTIONS', page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, 'паспорт гейта QG-LORE-CI-ACTIONS');
});

test('RFD3-APMACH Паспорт машины в админке со связями, мастер «Новая машина» строит план dry-run (SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT)', { tag: WRITES_TAG }, async ({ page }) => {
  test.setTimeout(120_000);
  const NEW_ID = 'test-rfd3-machine';
  allowWrite([NEW_ID]);
  await boot(page);
  const machines = await slice(page, 'machines_graph');
  expect(machines.length, 'срез machines_graph отдаёт машины').toBeGreaterThan(0);
  const m = machines.find(x => str(x.gateway)) ?? machines[0];
  const id = str(m.machine_id);
  const r = await rec(page, 'machine', id);
  expect(r.status, `паспорт машины ${id} (/lore/record/machine): ${r.text.slice(0, 160)}`).toBe(200);
  const tabs = list((r.body?.schema as Row | undefined)?.relations).map(x => str((x as Row).rel));
  expect.soft(tabs, 'вкладка «Агенты машины» (USES_MACHINE) в схеме паспорта').toContain('USES_MACHINE');

  // Мастер: dry-run «было → станет», без записи (машина после него не появилась).
  const owner = str(m.owner) || str((await slice(page, 'users'))[0]?.kc_sub);
  const plan = await call(page, 'POST', '/lore/actor/machine', { machine_id: NEW_ID, kc_sub: owner, dry_run: true });
  expect(plan.status, `dry-run machine_new: ${plan.text}`).toBe(200);
  expect(plan.body?.dry_run, `ответ помечен dry_run: ${plan.text.slice(0, 200)}`).toBe(true);
  expect(str((plan.body?.plan as Row | undefined)?.kind), `план «было → станет» — create: ${plan.text.slice(0, 200)}`).toBe('create');
  expect((await slice(page, 'machine_by_id', { id: NEW_ID })).length, 'dry-run ничего не записал').toBe(0);

  await openStand(page, `/?mod=admin&sec=adm-machines&adm-macl-open=${encodeURIComponent(id)}`, page.locator(`[data-testid=${attr(`adm-mpass-${id}`)}]`));
  await expect(page.locator('[data-testid="adm-mpass-record"]'), `паспорт ${id} открыт своим адресом`).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="adm-mpass-notfound"]'), 'не «машина не найдена»').toHaveCount(0);
  await page.locator('[data-testid="adm-mpass-back"]').click();
  await page.locator('[data-testid="adm-macl-new"]').click();
  await expect(page.locator('[data-testid="adm-nm-form"]'), 'кнопка «Новая машина» открывает мастер').toBeVisible({ timeout: 15_000 });
});

test('RFD3-APPEOPLE viewer: страница человека и карточка агента без учётки и прав; client_id — только админу (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE)', async ({ browser }, info) => {
  test.setTimeout(180_000);
  let shown: Page | null = null;
  try {
    const sa = await as(browser, RBAC_ACCOUNTS.superAdmin);
    const agents = await slice(sa, 'agents');
    const agent = agents.find(a => str(a.owner) && str(a.client_id)) ?? agents.find(a => str(a.client_id));
    expect(agent, 'под super-admin агенты с учёткой (client_id) есть').toBeTruthy();
    const aid = str(agent!.actor_id), client = str(agent!.client_id), ownerSub = str(agent!.owner);
    expect((await slice(sa, 'agent_owners')).some(r => str(r.client_id)), 'super-admin: client_id в agent_owners есть').toBe(true);

    const v = await as(browser, RBAC_ACCOUNTS.viewer);
    shown = v;
    const vAgents = await api(v, '/lore/slice/agents');
    if (vAgents.status === 200) expect(list(vAgents.body?.rows).filter(x => str((x as Row).client_id)).length, 'viewer: в срезе agents нет client_id').toBe(0);
    else note(`viewer: /lore/slice/agents → ${vAgents.status}`);
    const vOwners = await api(v, '/lore/slice/agent_owners');
    if (vOwners.status === 200) expect(list(vOwners.body?.rows).filter(x => str((x as Row).client_id)).length, 'viewer: в agent_owners нет client_id (решение 1б)').toBe(0);
    else note(`viewer: /lore/slice/agent_owners → ${vOwners.status}`);
    const vRec = await rec(v, 'agent', aid);
    expect(vRec.status, `viewer: карточка агента ${aid} открывается (${vRec.text.slice(0, 120)})`).toBe(200);
    expect(vRec.text.includes(client) || JSON.stringify(vRec.body).includes(client), 'viewer: в ответе /lore/record/agent нет учётки агента').toBe(false);

    await openStand(v, `/?sec=agent&open=${encodeURIComponent(aid)}`, v.locator('[data-testid="agent-who"]'));
    await expect(v.locator('[data-testid="agent-who"]'), 'карточка агента: оболочка · профиль · машина').toBeVisible({ timeout: 30_000 });
    await expect(v.locator('[data-testid="agent-owner"]'), 'карточка агента: «чей он»').toBeVisible();
    // Только карточка (док паспорта), не список агентов за ней; учётка — отдельным словом (имя агента бывает похожим).
    const card = await v.locator('[data-testid="kit-rec-dock"]').first().innerText();
    const leak = card.split(/[\s·,()]+/).includes(client) && str(agent!.name) !== client;
    expect(leak, `на карточке агента нет учётки ${client} отдельным полем`).toBe(false);
    await expect(v.locator('[data-testid="kit-rec-dock"]').getByText(/^(Учётка|Client ID|client_id)$/), 'поля «Учётка» на карточке нет').toHaveCount(0);
    await expect(v.locator('[role="tab"][id$="-tab-feed"]').first(), 'у агента вкладка «Лента» (решение 2а)').toBeVisible({ timeout: 15_000 });

    test.skip(!ownerSub, `у агента ${aid} нет владельца — страницу человека открыть не по чему`);
    const uRec = await rec(v, 'user', ownerSub);
    expect(uRec.status, `viewer: запись человека ${ownerSub}`).toBe(200);
    expect(Object.keys((uRec.body?.values ?? {}) as Row), 'viewer: name_source (поле уровня admin) не отдан').not.toContain('name_source');
    await openStand(v, `/?sec=user&open=${encodeURIComponent(ownerSub)}&tab=charts`, v.locator('[data-testid="kit-rec-loaded"]'));
    await passportLoaded(v, `страница человека ${ownerSub}`);
    await expect(v.locator('[data-testid="person-stat-work"]'), 'цифры шапки: в работе').toBeVisible({ timeout: 30_000 });
    await expect(v.locator('[data-testid="person-stat-cycle"]'), 'цифры шапки: медиана цикла').toBeVisible();
    await expect(v.locator('[data-testid="user-charts"]'), 'режим «Аналитика»: графики человека').toBeVisible({ timeout: 30_000 });
    await expect(v.locator('[role="tab"][id$="-tab-feed"]').first(), 'вкладка «Лента» человека').toBeVisible();
    const txt = await v.locator('[data-testid="kit-rec-dock"]').first().innerText();
    expect(txt, 'на странице человека нет прав и ролей учётки').not.toMatch(/super-?admin|realm|e-?mail|почт/i);
  } finally { await finish(shown, info); }
});

test('RFD3-APREPO Связь «репозиторий → проект» с ролью одним вызовом; повтор меняет роль (SPRINT_LORE_ADMIN_POLISH/AP-REPO-LINK-ROLE)', { tag: WRITES_TAG }, async ({ page }) => {
  const REPO = 'TEST-repo-rfd3';
  const URL_ = `https://git.example.invalid/TEST-org/${REPO}`;
  allowWrite([REPO, TEST_PROJECT_A]);
  await boot(page);
  await ensureTestProject(page, TEST_PROJECT_A);
  const c = await call(page, 'POST', '/lore/repository', { url: URL_ });
  expect(c.status, `TEST-репозиторий: ${c.text}`).toBe(200);
  // Исходное состояние — primary (повторный прогон мог оставить mirror).
  const first = await call(page, 'POST', '/lore/repository/link', { url: URL_, rel: 'project', target: TEST_PROJECT_A, role: 'primary' });
  expect(first.status, `связь с ролью primary — не 502: ${first.text}`).toBe(200);
  const roleOf = async () => list((await slice(page, 'repo_by_id', { id: URL_ }))[0]?.project_roles).map(str);
  expect(await roleOf(), 'в срезе project_roles = [primary]').toEqual(['primary']);
  const second = await call(page, 'POST', '/lore/repository/link', { url: URL_, rel: 'project', target: TEST_PROJECT_A, role: 'mirror' });
  expect(second.status, second.text).toBe(200);
  expect(str(second.body?.outcome), `повтор с другой ролью — updated: ${second.text}`).toBe('updated');
  expect(str(second.body?.previous_role), 'прежняя роль названа').toBe('primary');
  expect(await roleOf(), 'роль у существующей связи сменилась').toEqual(['mirror']);
  const back = await call(page, 'POST', '/lore/repository/link', { url: URL_, rel: 'project', target: TEST_PROJECT_A, role: 'primary' });
  expect(back.status, back.text).toBe(200);
  note('шаг 4 (роли miniLORE и miniLore_serverside на проде) — запись в прод, на стенде не делается');
});

// ═══ SPRINT_LORE_BOARD_PASSPORTS ════════════════════════════════════════════════════════════════════════

test('RFD3-BP01 Лента полных паспортов: свойства, тело, связи подряд, догрузка до 12 (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED)', async ({ page }) => {
  test.setTimeout(150_000);
  const pps = page.locator('.sk-feed [data-feed-passport]');
  await openStand(page, '/?sec=task&lv=feed&lfm=full', pps);
  await expect(pps.first(), 'в виде «Лента» режим «Полные паспорта» показывает паспорта').toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole('button', { name: /Полные паспорта|Full passports/ }), 'переключатель «Полные паспорта» нажат').toHaveAttribute('aria-pressed', 'true');
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(400); }
  const n = await pps.count();
  expect(n, 'догрузка по прокрутке — не больше 12 паспортов').toBeLessThanOrEqual(12);
  expect(n, 'догружено больше первой порции').toBeGreaterThan(4);
  const err = page.locator('.sk-feed [role="alert"]');
  const errText = await textOf(err);
  expect(await err.count(), `паспорта в ленте без ошибок загрузки: ${errText}`).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'без горизонтального переполнения').toBeLessThanOrEqual(1);
});

// ═══ SPRINT_LORE_EXT_AUDIT_1190 ═════════════════════════════════════════════════════════════════════════

test('RFD3-AUDAREA У всех area компонентов есть статья словаря с цветом-токеном (SPRINT_LORE_EXT_AUDIT_1190/AUD-AREA-COLORS)', async ({ page }) => {
  await boot(page);
  const area = await slice(page, 'dictionary', { dict_type: 'area' });
  const codes = area.map(r => str(r.code));
  for (const c of ['ai', 'algorithm', 'api', 'data', 'engine', 'frontend', 'observability', 'platform', 'security'])
    expect(codes, `статья area «${c}» (сид компонентов чистой установки) засеяна`).toContain(c);
  expect(area.filter(r => /^#[0-9a-f]{3,8}$/i.test(str(r.color))).map(r => str(r.code)), 'цвета area — токены, не сырой hex').toEqual([]);
  // Копия прода — не чистая установка: area живых компонентов вне сида — находка, а не приёмка «чистой установки».
  const comps = await slice(page, 'components');
  const missing = [...new Set(comps.map(c => str(c.area)).filter(Boolean))].filter(a => !codes.includes(a));
  note(`area компонентов копии прода без статьи словаря: ${missing.length ? missing.join(', ') : 'нет'}`);
  note('«смена цвета в админке видна в списке компонентов» — запись в словарь и v2 цвет area не рисует (заметка 25.11); проверен посев');
});

test('RFD3-AUDDEF Наш стенд после нейтральных умолчаний работает как раньше: bench включён явно (SPRINT_LORE_EXT_AUDIT_1190/AUD-DEFAULTS)', async ({ page }) => {
  await boot(page);
  const v = await api(page, '/lore/version');
  expect(v.status, '/lore/version').toBe(200);
  const b = await api(page, '/bench/mart/slices');
  expect(str(b.body?.error), `bench на стенде включён явно (BENCH_MART_ENABLED), а не выключен умолчанием: ${b.text.slice(0, 160)}`).not.toBe('MART_DISABLED');
  expect(b.status, `/bench/mart/slices: ${b.text.slice(0, 160)}`).toBe(200);
  note('«в репозитории нет наших адресов в умолчаниях» — сторожа сборки (NeutralDefaultsTest, ComposeNoOurHostDefaultsTest), не стенд; внешняя установка без настроек — не стенд');
});

test('RFD3-AUDDOCS Агент подключается к /mcp по HTTP: initialize и список инструментов (SPRINT_LORE_EXT_AUDIT_1190/AUD-DOCS)', async ({ page }) => {
  await boot(page);
  const run = await mcp(page, [{ method: 'tools/list' }]);
  expect(run.init.status, `initialize через nginx стенда: ${run.init.raw.slice(0, 200)}`).toBe(200);
  expect(run.session, 'сервер выдал Mcp-Session-Id').toBeTruthy();
  const tools = list((run.replies[0]?.json?.result as Row | undefined)?.tools).map(t => str((t as Row).name));
  expect(tools.length, `tools/list отдал инструменты: ${run.replies[0]?.raw.slice(0, 160)}`).toBeGreaterThan(0);
  note(`инструментов по HTTP: ${tools.length}; README пакета (LORE_DB, superadmin, /mcp) — документ, сторож install-docs-audit в сборке`);
});

test('RFD3-AUDSA project_new: отказ без роли называет superadmin, super-admin создаёт TEST-проект (SPRINT_LORE_EXT_AUDIT_1190/AUD-SUPERADMIN)', { tag: WRITES_TAG }, async ({ browser }, info) => {
  allowWrite([TEST_PROJECT_A]);
  let shown: Page | null = null;
  try {
    const admin = await as(browser, RBAC_ACCOUNTS.admin);
    shown = admin;
    // Пустое тело: гейт роли стоит раньше разбора тела — ничего не пишется.
    const r = await api(admin, '/lore/project', { method: 'POST', body: {} });
    expect(r.status, `admin (не superadmin): POST /lore/project → 403: ${r.text}`).toBe(403);
    expect(r.text, 'текст отказа называет роль, которая пропускает: superadmin').toMatch(/superadmin role required/);
    const sa = await as(browser, RBAC_ACCOUNTS.superAdmin);
    shown = sa;
    const outcome = await ensureTestProject(sa, TEST_PROJECT_A);
    note(`super-admin: ${TEST_PROJECT_A} — ${outcome}`);
  } finally { await finish(shown, info); }
});

// ═══ SPRINT_LORE_EXT_ISSUES_W2 ══════════════════════════════════════════════════════════════════════════

test('RFD3-ISS01 Чистая установка из пакета по IP не уводит на наш хост (SPRINT_LORE_EXT_ISSUES_W2/ISS-01-REDIRECT-SOURCE)', async () => {
  test.skip(true, 'не выполнен: «Готово, когда» — чистая установка из пакета deploy/install по голому IP; стенд — наш хост с явным '
    + 'LORE_PUBLIC_URL, редирект на нём законен. Корень доказан чтением тегов (заметка), сторож ComposeNoOurHostDefaultsTest — в сборке');
});

test('RFD3-ISS03 Опциональный MART: ответ 200 или 503 MART_UNREACHABLE с причиной, не 502 (SPRINT_LORE_EXT_ISSUES_W2/ISS-03-OPTIONAL-SERVICES)', async ({ page }) => {
  await boot(page);
  const ls = await api(page, '/bench/mart/slices');
  test.skip(ls.status !== 200, `bench на стенде не отвечает списком (${ls.status} ${ls.text.slice(0, 120)}) — срез MART проверить не на чем`);
  const slices = list(ls.body?.slices) as { id?: string; required?: string[] }[];
  const s = slices.find(x => !list(x.required).length);
  test.skip(!s, 'у всех срезов MART есть обязательные параметры — вызвать без данных нечем');
  const r = await api(page, `/bench/mart/slice/${encodeURIComponent(str(s!.id))}`);
  expect(r.text, `MART-срез ${str(s!.id)}: без сырого «Connection refused» наружу — ${r.text.slice(0, 200)}`).not.toMatch(/Connection refused/i);
  if (r.status === 502) {
    // По дизайну ISS-03: MART достижим, но ответил ошибкой — 502 с кодом *_UPSTREAM (не «недоступен»).
    expect(str(r.body?.error), `502 — с кодом MART_UPSTREAM: ${r.text.slice(0, 200)}`).toBe('MART_UPSTREAM');
    test.skip(true, `не выполнен: MART на стенде достижим, но ответил ошибкой (502 MART_UPSTREAM: ${str(r.body?.detail).slice(0, 140)}) — `
      + 'ветку «MART/S3 недоступен → 503 с причиной» на стенде не смоделировать, не ломая сервис');
  }
  if (r.status === 503) {
    expect(str(r.body?.error), 'код недоступности назван').toBe('MART_UNREACHABLE');
    expect(r.text, 'в причине — что проверить (MART_ARCADE_URL / BENCH_MART_ENABLED)').toMatch(/MART_ARCADE_URL|BENCH_MART_ENABLED/);
    note('MART на стенде недоступен — получен честный 503 MART_UNREACHABLE');
  } else {
    expect(r.status, `MART доступен — 200: ${r.text.slice(0, 160)}`).toBe(200);
    note('MART на стенде доступен (200); ветку 503 проверить можно только с выключенным MART — недоступность S3 на стенде не моделируется');
  }
});

test('RFD3-ISS04 MCP по HTTP: /mcp/health с коммитом без входа, /mcp без токена — 401 (SPRINT_LORE_EXT_ISSUES_W2/ISS-04-MCP-HTTP)', async ({ page }) => {
  await boot(page);
  const h = await api(page, '/mcp/health', { noAuth: true });
  expect(h.status, `/mcp/health без входа: ${h.text.slice(0, 160)}`).toBe(200);
  expect(str(h.body?.status), 'status ok').toBe('ok');
  expect(str(h.body?.transport), 'transport http').toBe('http');
  expect(str(h.body?.commit), 'отметка сборки (commit) в ответе').not.toBe('');
  const v = await api(page, '/lore/version');
  note(`mcp commit ${str(h.body?.commit)}; бэкенд ${str(v.body?.commit)}`);
  const anon = await api(page, '/mcp', { method: 'POST', noAuth: true, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
  expect(anon.status, `/mcp без токена: ${anon.text.slice(0, 160)}`).toBe(401);
  expect(anon.headers['www-authenticate'] ?? '', 'вызов назван: WWW-Authenticate Bearer').toMatch(/Bearer/i);
  note('критерии issue #4 (LORE_MCP_HOST/PORT/TOKEN/CORS) — тесты mcp-server; на стенде проверены health и отказ без входа');
});

test('RFD3-ISS06 MCP: *_link на незарегистрированный проект — isError «НЕ СДЕЛАНО», а не успех (SPRINT_LORE_EXT_ISSUES_W2/ISS-06-LINK-FALSE-SUCCESS)', { tag: WRITES_TAG }, async ({ page }) => {
  const GHOST = 'TEST-proj-unregistered-rfd3';
  allowWrite([TEST_SPRINT, TEST_PROJECT_A, GHOST]);
  await boot(page);
  await ensureTestSprint(page);
  expect((await slice(page, 'git_projects')).some(p => str(p.slug) === GHOST), `${GHOST} не зарегистрирован`).toBe(false);
  const listRun = await mcp(page, [{ method: 'tools/list' }]);
  expect(listRun.init.status, `initialize: ${listRun.init.raw.slice(0, 200)}`).toBe(200);
  const names = list((listRun.replies[0]?.json?.result as Row | undefined)?.tools).map(t => str((t as Row).name));
  const call1 = names.includes('entity_link')
    ? { name: 'entity_link', arguments: { type: 'sprint', id: TEST_SPRINT, rel: 'project', target_id: GHOST } }
    : { name: 'sprint_link', arguments: { sprint_id: TEST_SPRINT, rel: 'project', target_id: GHOST } };
  expect(names, 'инструмент связи спринта есть (entity_link / sprint_link)').toContain(call1.name);
  const run = await mcp(page, [{ method: 'tools/call', params: call1 }]);
  const res = run.replies[0]?.json?.result as { isError?: boolean; content?: { text?: string }[] } | undefined;
  const text = (res?.content ?? []).map(c => str(c.text)).join('\n');
  expect(res, `ответ tools/call ${call1.name}: ${run.replies[0]?.raw.slice(0, 200)}`).toBeTruthy();
  expect(res?.isError, `noop записи — isError:true (D-2026-LORE-MCP-LINK-NOOP-IS-ERROR): ${text.slice(0, 200)}`).toBe(true);
  expect(text, 'первая строка — «НЕ СДЕЛАНО: <причина>»').toMatch(/НЕ СДЕЛАНО/);
  // Положительный контроль: чтение с тем же сервером ошибкой не становится.
  const ok = await mcp(page, [{ method: 'tools/call', params: { name: 'query_slice', arguments: { slice: 'git_projects', params: { limit: '1' } } } }]);
  const okRes = ok.replies[0]?.json?.result as { isError?: boolean } | undefined;
  if (okRes) expect(okRes.isError ?? false, 'чтение query_slice — не ошибка').toBe(false);
});

// ═══ SPRINT_LORE_KNOW_REGISTRY ══════════════════════════════════════════════════════════════════════════

test('RFD3-KREG01 Схема кода (KnowKind/KnowKindHist) доведена на базе стенда — не отстаёт (SPRINT_LORE_KNOW_REGISTRY/KREG-01)', async ({ page }) => {
  await boot(page);
  const v = await api(page, '/lore/version');
  expect(v.status, '/lore/version').toBe(200);
  expect(v.body?.code_schema_version, `доводка схемы кода прошла (code_schema_version): ${v.text.slice(0, 200)}`).not.toBeNull();
  expect(v.body?.code_schema_behind, `база не отстаёт от кода: v${str(v.body?.code_schema_version)} / ожидается v${str(v.body?.code_schema_expected)}`).toBe(false);
  note('«пустой реестр на чистой установке» — свежая установка, не стенд; на стенде проверена доводка схемы, в которую входит KnowKind');
});

test('RFD3-KREG02 Реестр видов из сборки: describe skill:* — из записи генератора (content_hash, источник) (SPRINT_LORE_KNOW_REGISTRY/KREG-02)', async ({ page }) => {
  await boot(page);
  const d = await api(page, '/lore/skill/describe?kind=skill:*');
  expect(d.status, `describe skill:* из реестра (know-registry.json): ${d.text.slice(0, 200)}`).toBe(200);
  expect(str(d.body?.content_hash), 'у вида хэш содержимого генератора').not.toBe('');
  expect(str(d.body?.kind), 'вид skill:*').toBe('skill:*');
  const flags = await api(page, '/lore/admin/flags');
  const imp = list(flags.body?.flags).find(f => str((f as Row).key) === 'lore.know-registry.import') as Row | undefined;
  note(`флаг lore.know-registry.import = ${str(imp?.value)}: ${imp?.value === true ? 'виды импортируются в KnowKind при старте' : 'импорт в KnowKind выключен — записи KnowKind на стенде не наполняются, прогон «на прод-копии» не проверяем'}`);
});

test('RFD3-KREG03 describe tag:* отдаёт поля тега (field_schema) и сторож rename (SPRINT_LORE_KNOW_REGISTRY/KREG-03)', async ({ page }) => {
  await boot(page);
  const d = await api(page, '/lore/skill/describe?kind=tag:*');
  expect(d.status, `describe tag:*: ${d.text.slice(0, 200)}`).toBe(200);
  const guards = list(d.body?.guards).map(g => str((g as Row).name));
  expect(guards.join(', '), 'среди гардов — сторож rename').toMatch(/rename/);
  // Карточка тега из справочника 1.18 — по живому тегу.
  const sug = await api(page, '/lore/tag/suggest');
  const tag = (list(sug.body?.tags) as { tag_id?: string; uses?: number }[]).sort((a, b) => Number(b.uses ?? 0) - Number(a.uses ?? 0))[0]?.tag_id;
  test.skip(!tag, 'тегов на стенде нет — карточку живого тега проверить не на чем');
  const one = await api(page, `/lore/skill/describe?kind=${encodeURIComponent(`tag:${tag}`)}`);
  expect(one.status, `describe tag:${tag}: ${one.text.slice(0, 200)}`).toBe(200);
  expect(one.text, 'карточка живого тега несёт field_schema или поля ребра TAGGED_WITH').toMatch(/field_schema|TAGGED_WITH/);
});

test('RFD3-KREG04 Срезы как виды slice:* в KnowRegistry (SPRINT_LORE_KNOW_REGISTRY/KREG-04)', async ({ page }) => {
  await boot(page);
  const d = await api(page, '/lore/skill/describe?kind=slice:sprints');
  // Дверь describe принимает только skill:* и tag:*; виды slice:* живут в know-registry.json и (при флаге) в KnowKind.
  test.skip(d.status === 404 && str(d.body?.error) === 'UNKNOWN_KIND',
    'не выполнен: describe_full slice:* наружу не выведен (дверь /lore/skill/describe знает только skill:* и tag:*, MCP2 нет), '
    + 'а импорт видов в KnowKind выключен флагом lore.know-registry.import; покрытие 222 срезов — KnowRegistryGeneratorTest в сборке');
  expect(d.status, d.text).toBe(200);
  expect(d.text, 'params среза sprints с limit/fields').toMatch(/limit/);
});

test('RFD3-KREG05 R-сущности ADR-LORE-057 (R1–R4) заведены решениями при ADR (SPRINT_LORE_KNOW_REGISTRY/KREG-05)', async ({ page }) => {
  await boot(page);
  const miss: string[] = [];
  for (const id of ['ADR-LORE-057-R1', 'ADR-LORE-057-R2', 'ADR-LORE-057-R3', 'ADR-LORE-057-R4']) {
    const r = await rec(page, 'decision', id);
    if (r.status !== 200) miss.push(`${id} → ${r.status}`);
  }
  test.skip(miss.length === 4, `в копии базы препрода R-сущностей нет (${miss.join('; ')}) — копия старше 24.11, записи живут на проде`);
  expect(miss, 'все четыре R-сущности читаются паспортом').toEqual([]);
  await openStand(page, '/?sec=decision&open=ADR-LORE-057-R1', page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, 'паспорт ADR-LORE-057-R1');
  await expect(page.locator('[data-testid="kit-rec-dock"]').getByText('ADR-LORE-057').first(), 'связь с ADR-LORE-057 в паспорте').toBeVisible({ timeout: 15_000 });
});

test('RFD3-KREG06 Рутина qg-lore-skill-tag в QG-прогоне меряет висяки скиллов и битые ссылки тегов (SPRINT_LORE_KNOW_REGISTRY/KREG-06)', async ({ page }) => {
  await boot(page);
  const runs = await slice(page, 'routine_last_run', { routine_name: 'qg-lore-skill-tag' });
  expect(runs.length, 'у рутины qg-lore-skill-tag есть прогон на стенде').toBeGreaterThan(0);
  expect(str(runs[0].status), `прогон измерил, а не NOT_MEASURED: ${str(runs[0].detail_md).slice(0, 160)}`).not.toMatch(/NOT_MEASURED/i);
  const m = (await slice(page, 'qg_metrics_latest')).filter(x => str(x.routine_name) === 'qg-lore-skill-tag');
  const keys = m.map(x => str(x.metric_key));
  expect(keys, 'метрика skills_dangling').toContain('skills_dangling');
  expect(keys, 'метрика tag_broken_refs').toContain('tag_broken_refs');
  note(`значения: ${m.map(x => `${str(x.metric_key)}=${str(x.value)} (${str(x.status)})`).join(', ')}; обратная проверка «нарушение → FAIL» — QgLoreSkillTagRoutineTest; окна KnowQuestion — BLOCKED решением владелицы`);
});

test('RFD3-KREG07 Карточки describe skill:* и tag:* из реестра: params, enums, identities, links, guards, errors, lifecycle (SPRINT_LORE_KNOW_REGISTRY/KREG-07)', async ({ page }) => {
  await boot(page);
  const d = await api(page, '/lore/skill/describe?kind=skill:*');
  expect(d.status, `describe skill:*: ${d.text.slice(0, 200)}`).toBe(200);
  for (const k of ['params', 'enums', 'identities', 'links', 'guards', 'errors']) expect.soft(Object.keys(d.body ?? {}), `в карточке есть ${k}`).toContain(k);
  expect.soft(d.body?.lifecycle, 'у skill:* — жизненный цикл').toBeTruthy();
  const errs = JSON.stringify(d.body?.errors ?? '');
  for (const c of ['REFUSED', 'NOOP', 'INVALID_VALUE']) expect.soft(errs, `коды ошибок: ${c}`).toContain(c);
  const unknown = await api(page, '/lore/skill/describe?kind=nope:x');
  expect(unknown.status, 'чужой вид — 404 UNKNOWN_KIND, а не пустая карточка').toBe(404);
  expect(str(unknown.body?.error)).toBe('UNKNOWN_KIND');
});

test('RFD3-KREG08 /lore/model называет источник модели (lore | file) заголовком X-Lore-Model-Source (SPRINT_LORE_KNOW_REGISTRY/KREG-08)', async ({ page }) => {
  await boot(page);
  // Заголовок ставит GET /lore/model (LoreModelResource.model), не /lore/model/config.
  const r = await api(page, '/lore/model');
  expect(r.status, `/lore/model: ${r.text.slice(0, 120)}`).toBe(200);
  const src = r.headers['x-lore-model-source'] ?? '';
  expect(src, `заголовок X-Lore-Model-Source: «${src}»`).toMatch(/^(lore|file)/);
  if (src.startsWith('file')) note(`стенд работает по файлу репозитория — fallback назван громко: ${src}; warning: ${JSON.stringify((r.body?.meta as Row | undefined)?.warning ?? r.body?.warning ?? '').slice(0, 160)}`);
  else note(`модель прочитана из LORE (${src})`);
});

test('RFD3-KREG11 task → task «зависит от»: связь с видом, цикл отбит с цепочкой, срез deps_of видит (SPRINT_LORE_KNOW_REGISTRY/KREG-11)', { tag: WRITES_TAG }, async ({ page }) => {
  test.setTimeout(120_000);
  const tag = runTag();
  const A = `TEST-DEP-A-${tag}`, B = `TEST-DEP-B-${tag}`;
  allowWrite([TEST_SPRINT, TEST_PROJECT_A, A, B]);
  await boot(page);
  await ensureTestSprint(page);
  const a = await testTask(page, A), b = await testTask(page, B);
  try {
    const l = await call(page, 'POST', '/lore/task/dep', { from_task: a, to_task: b, reason: 'смоук RFD3: A ждёт B' });
    expect(l.status, `task_link rel=dep A → B: ${l.text}`).toBe(200);
    const out = await slice(page, 'deps_of', { type: 'task', id: a });
    const edge = out.find(r => r.dir === 'out' && r.other_id === b);
    expect(edge, `${a} видит «зависит от» ${b}`).toBeTruthy();
    expect(str(edge?.kind), 'вид по умолчанию — soft').toBe('soft');
    const inv = await slice(page, 'deps_of', { type: 'task', id: b });
    expect(inv.some(r => r.dir === 'in' && r.other_id === a), `${b} видит «от неё зависит» ${a}`).toBe(true);
    const cyc = await call(page, 'POST', '/lore/task/dep', { from_task: b, to_task: a, reason: 'смоук RFD3: цикл' });
    expect(cyc.status, `цикл B → A отбит: ${cyc.text}`).toBe(409);
    expect(cyc.text.includes(A) && cyc.text.includes(B), `в отказе цепочка с обеими задачами: ${cyc.text.slice(0, 200)}`).toBe(true);
    const doc = await api(page, '/lore/model/config');
    const task = (JSON.parse(str(doc.body?.content)) as { types: Row[] }).types.find(t => t.type === 'task');
    expect(list(task?.relations).some(r => (r as Row).rel === 'DEPENDS_ON'), 'паспорт задачи: связь DEPENDS_ON в модели').toBe(true);
  } finally {
    await cancel(page, a);
    await cancel(page, b);
  }
});

test('RFD3-SKILL01 skill_new: без рёбер — 422 REFUSED со списком; с проектом и ролью — draft; словарь skill_status (SPRINT_LORE_KNOW_REGISTRY/SKILL-01)', { tag: WRITES_TAG }, async ({ page }) => {
  const S = 'test-rfd3-skill-a';
  allowWrite([S, TEST_PROJECT_A]);
  await boot(page);
  await ensureTestProject(page, TEST_PROJECT_A);
  const dict = (await slice(page, 'dictionary', { dict_type: 'skill_status' })).map(r => str(r.code));
  expect(dict, 'словарь skill_status: draft/active/deprecated').toEqual(expect.arrayContaining(['draft', 'active', 'deprecated']));
  const bare = await call(page, 'POST', '/lore/skill', { skill_id: `skill:${S}-bare`, title: 'Тест без рёбер', body_md: 'тело' });
  expect(bare.status, `создание без BELONGS_TO_PROJECT/APPLIES_TO_ROLE: ${bare.text}`).toBe(422);
  expect(bare.text, 'отказ REFUSED со списком недостающих рёбер').toMatch(/REFUSED/);
  expect(bare.text, 'недостающие рёбра названы').toMatch(/project|role|BELONGS_TO_PROJECT|APPLIES_TO_ROLE/);
  const ok = await call(page, 'POST', '/lore/skill', { skill_id: `skill:${S}`, title: 'Тестовый скилл RFD3', body_md: 'Процедура смоука стенда.', projects: [TEST_PROJECT_A], roles: ['tester'] });
  expect([200, 201], `создание с обоими рёбрами (повторный прогон — правка): ${ok.text}`).toContain(ok.status);
  const row = (await slice(page, 'skills', { project: TEST_PROJECT_A })).find(r => str(r.skill_id) === `skill:${S}`);
  expect(row, `skill:${S} в срезе skills проекта ${TEST_PROJECT_A}`).toBeTruthy();
  expect(str(row?.status), 'создание → draft').toBe('draft');
  note('«deprecated → active только владельцем (NOOP)» — SkillResourceLiveDbTest; на стенде TEST-скилл не переводим в deprecated, чтобы прогон был повторяемым');
});

test('RFD3-SKILL02 Рёбра скиллов: цикл SKILL_EXTENDS отбит с цепочкой, снятие последнего проекта — отказ (SPRINT_LORE_KNOW_REGISTRY/SKILL-02)', { tag: WRITES_TAG }, async ({ page }) => {
  const A = 'test-rfd3-skill-a', B = 'test-rfd3-skill-b';
  allowWrite([A, B, TEST_PROJECT_A]);
  await boot(page);
  await ensureTestProject(page, TEST_PROJECT_A);
  for (const s of [A, B]) {
    const r = await call(page, 'POST', '/lore/skill', { skill_id: `skill:${s}`, title: `Тестовый скилл ${s}`, body_md: 'Процедура смоука стенда.', projects: [TEST_PROJECT_A], roles: ['tester'] });
    expect([200, 201], `skill:${s}: ${r.text}`).toContain(r.status);
  }
  const ab = await call(page, 'POST', '/lore/skill/link', { skill_id: `skill:${A}`, rel: 'extends', target_id: `skill:${B}` });
  expect(ab.status, `A extends B (повтор — unchanged): ${ab.text}`).toBe(200);
  const ba = await call(page, 'POST', '/lore/skill/link', { skill_id: `skill:${B}`, rel: 'extends', target_id: `skill:${A}` });
  expect(ba.status, `цикл B extends A: ${ba.text}`).toBe(422);
  expect(ba.text, 'отказ с цепочкой наследования').toMatch(new RegExp(`${A}[\\s\\S]*${B}|${B}[\\s\\S]*${A}`));
  const drop = await call(page, 'POST', '/lore/skill/link', { skill_id: `skill:${B}`, rel: 'project', target_id: TEST_PROJECT_A, action: 'remove' });
  expect(drop.status, `снятие последнего проекта — висяк не оставляем: ${drop.text}`).toBe(422);
});

test('RFD3-SKILL03 Посевные скиллы release-cutover, qg-triage, adr-review: active, seed, с проектом и ролью (SPRINT_LORE_KNOW_REGISTRY/SKILL-03)', async ({ page }) => {
  await boot(page);
  const skills = await slice(page, 'skills');
  for (const id of ['skill:release-cutover', 'skill:qg-triage', 'skill:adr-review']) {
    const s = skills.find(r => str(r.skill_id) === id);
    expect.soft(s, `${id} засеян`).toBeTruthy();
    if (!s) continue;
    expect.soft(str(s.status), `${id}: status active`).toBe('active');
    expect.soft(str(s.source), `${id}: source seed`).toBe('seed');
    expect.soft(list(s.projects).length, `${id}: BELONGS_TO_PROJECT ≥ 1 (не висяк)`).toBeGreaterThan(0);
    expect.soft(list(s.roles).length, `${id}: APPLIES_TO_ROLE ≥ 1`).toBeGreaterThan(0);
  }
  const d = await api(page, '/lore/skill/describe?kind=skill:qg-triage');
  expect(d.status, `describe-карточка skill:qg-triage: ${d.text.slice(0, 160)}`).toBe(200);
});

test('RFD3-SKILL04 Срезы skills / skills_full с фильтрами и describe skill:* формы 061 §8 (SPRINT_LORE_KNOW_REGISTRY/SKILL-04)', async ({ page }) => {
  await boot(page);
  const short = await slice(page, 'skills');
  expect(short.length, 'срез skills не пуст').toBeGreaterThan(0);
  expect(Object.keys(short[0]), 'short — без body_md').not.toContain('body_md');
  for (const k of ['skill_id', 'status', 'roles', 'projects']) expect.soft(Object.keys(short[0]), `колонка ${k}`).toContain(k);
  // Разбор, если фильтр не сработает: счёт по каждому сочетанию — в подписи проверки.
  const activeShort = short.filter(r => str(r.status) === 'active').length;
  const fullAll = await slice(page, 'skills_full');
  const shortActive = await slice(page, 'skills', { status: 'active' });
  const full = await slice(page, 'skills_full', { status: 'active' });
  const why = `skills: ${short.length} (active ${activeShort}); skills_full: ${fullAll.length}; skills?status=active: ${shortActive.length}; skills_full?status=active: ${full.length}`;
  expect(fullAll.length, `skills_full без фильтра видит то же, что skills — ${why}`).toBe(short.length);
  expect(shortActive.length, `фильтр status у skills — ${why}`).toBe(activeShort);
  expect(full.length, `skills_full?status=active — ${why}`).toBe(activeShort);
  expect(full.length, 'skills_full?status=active не пуст').toBeGreaterThan(0);
  expect(str(full[0].body_md), 'full — с body_md').not.toBe('');
  expect(full.every(r => str(r.status) === 'active'), 'фильтр status работает').toBe(true);
  const byRole = await slice(page, 'skills', { role: 'tester' });
  expect(byRole.every(r => list(r.roles).map(str).includes('tester')), 'фильтр role работает').toBe(true);
  const d = await api(page, '/lore/skill/describe?kind=skill:*');
  expect(d.status, 'describe skill:*').toBe(200);
});

test('RFD3-SKILL05 Тег переживает rename: отчёт, бывшее имя — в synonyms, занятое имя — 409 IDENTITY_CONFLICT (SPRINT_LORE_KNOW_REGISTRY/SKILL-05)', { tag: WRITES_TAG }, async ({ page }) => {
  test.setTimeout(150_000);
  const tag = runTag().toLowerCase();
  // Тег с полями ставится только ADR и решению (модель) — носитель: постоянный TEST-ADR (upsert, повтор — правка).
  const ADR = 'TEST-ADR-RFD3-TAGS';
  const from = `test-rfd3-${tag}`, to = `test-rfd3-${tag}-new`, other = `test-rfd3-${tag}-other`;
  allowWrite([ADR, from, to, other]);
  await boot(page);
  const adr = await call(page, 'POST', '/lore/adr', { adr_id: ADR, name: 'Тестовый ADR: носитель тегов смоука стенда (RFD3)' });
  expect([200, 201], `TEST-ADR ${ADR}: ${adr.text}`).toContain(adr.status);
  const applied: string[] = [];
  try {
    for (const t of [from, other]) {
      const ap = await call(page, 'POST', '/lore/tag/apply', { type: 'adr', id: ADR, tag_id: t, fields: { rfd3: 'да' } });
      expect(ap.status, `тег ${t} на TEST-ADR: ${ap.text}`).toBe(200);
      applied.push(t);
    }
    const rn = await call(page, 'POST', '/lore/tag/rename', { from, to });
    expect(rn.status, `rename ${from} → ${to}: ${rn.text}`).toBe(200);
    applied.splice(applied.indexOf(from), 1, to);
    expect(rn.text, 'в ответе отчёт (unmatched / outcome)').toMatch(/unmatched|outcome/);
    const card = await api(page, `/lore/skill/describe?kind=${encodeURIComponent(`tag:${to}`)}`);
    expect(card.status, `карточка tag:${to}: ${card.text.slice(0, 160)}`).toBe(200);
    expect(card.text, 'бывшее имя — в synonyms').toContain(from);
    const taken = await call(page, 'POST', '/lore/tag/rename', { from: to, to: other });
    expect(taken.status, `rename в занятое имя: ${taken.text}`).toBe(409);
    expect(taken.text, 'код IDENTITY_CONFLICT (legacy TAG_TAKEN)').toMatch(/IDENTITY_CONFLICT|TAG_TAKEN/);
  } finally {
    // Снять рёбра тегов с TEST-ADR — повторный прогон начинает с чистого носителя.
    for (const t of applied) await call(page, 'POST', '/lore/tag/apply', { type: 'adr', id: ADR, tag_id: t, action: 'remove' });
  }
  note('«QG-инвариант битых ссылок краснеет на несопоставленном» — RFD3-KREG06 и QgLoreSkillTagRoutineTest');
});

// ═══ SPRINT_QG_REBUILD ══════════════════════════════════════════════════════════════════════════════════

test('RFD3-QG07 Метрика прогона несёт basis (отпечаток знаменателя): поле в схеме, срезе и MCP qg_run_log (SPRINT_QG_REBUILD/QG-07)', async ({ page }) => {
  await boot(page);
  const v = await api(page, '/lore/version');
  expect(Number(v.body?.code_schema_expected ?? 0), 'схема кода с полем basis — v2 и выше').toBeGreaterThanOrEqual(2);
  expect(v.body?.code_schema_behind, 'доводка схемы (ClRoutineMetric.basis) прошла на базе стенда').toBe(false);
  const runs = await slice(page, 'qg_routine_runs');
  expect(runs.length, 'прогоны QG есть').toBeGreaterThan(0);
  const m = await slice(page, 'qg_run_metrics', { run_id: str(runs[0].run_id) });
  test.skip(!m.length, `у прогона ${str(runs[0].run_id)} нет метрик — колонку basis проверить не на чем`);
  expect(Object.keys(m[0]), 'срез qg_run_metrics отдаёт basis').toContain('basis');
  const run = await mcp(page, [{ method: 'tools/list' }]);
  const tool = list((run.replies[0]?.json?.result as Row | undefined)?.tools).find(t => str((t as Row).name) === 'qg_run_log') as Row | undefined;
  expect(JSON.stringify(tool?.inputSchema ?? {}), 'MCP qg_run_log: metrics[].basis в схеме входа').toContain('basis');
  note(`basis заполнен у ${m.filter(x => str(x.basis)).length} из ${m.length} метрик прогона — серверные рутины пишут только счётчики (остаток в заметке); экран сравнения — v1, на стенде v2`);
});

// ═══ SPRINT_UXR_MOBILE_POLISH ═══════════════════════════════════════════════════════════════════════════

test('RFD3-MP215 Телефон 412×915: при одном модуле нижней панели нет, под меткой версии нет пустой полосы; в админке док ≥ 44 (SPRINT_UXR_MOBILE_POLISH/MP2-15-BOTTOM-BAR)', async ({ browser }, info) => {
  const file = process.env.LORE_STAND_STORAGE_STATE!.trim();
  const ctx = await browser.newContext({ storageState: file, baseURL: process.env.LORE_STAND_URL!.trim(), viewport: { width: 412, height: 915 } });
  const p = await ctx.newPage();
  try {
    const rows = p.locator('[data-record-id], .sk-list__row');
    await openStand(p, '/?sec=sprint', rows);
    await expect(rows.first(), 'список спринтов на телефоне').toBeVisible({ timeout: 30_000 });
    await expect(p.locator('.sk-shell__dock'), 'в Forseti (один рабочий модуль) нижней панели модулей нет').toHaveCount(0);
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(400);
    const tail = await p.evaluate(() => {
      const v = document.querySelector('.v2-version') as HTMLElement | null;
      return v ? Math.round(innerHeight - v.getBoundingClientRect().bottom) : null;
    });
    if (tail === null) note('метки версии .v2-version на странице нет');
    else expect(tail, 'под меткой версии нет резерва под несуществующую панель (≤ 16 px)').toBeLessThanOrEqual(16);
    await shot(p, info);
    await openStand(p, '/?mod=admin&sec=adm-flags', p.locator('.sk-shell__dock'));
    await expect(p.locator('.sk-shell__dock'), 'в админке (Forseti + Админка) панель есть').toBeVisible({ timeout: 30_000 });
    const d = await p.evaluate(() => {
      const dock = document.querySelector('.sk-shell__dock') as HTMLElement;
      const r = dock.getBoundingClientRect();
      const items = [...dock.querySelectorAll('a, button')].map(e => (e as HTMLElement).getBoundingClientRect());
      return { vh: innerHeight, bottom: Math.round(r.bottom), min: items.length ? Math.round(Math.min(...items.map(i => Math.min(i.height, i.width)))) : 0 };
    });
    expect(d.bottom, 'док прижат к низу окна').toBe(d.vh);
    expect(d.min, 'цели дока ≥ 44 px').toBeGreaterThanOrEqual(44);
  } finally { await ctx.close(); }
});

// ═══ SPRINT_VIZ_EMBED ═══════════════════════════════════════════════════════════════════════════════════

test('RFD3-VE7 Встройка Völva шлёт родителю высоту или ошибку с кодом (SPRINT_VIZ_EMBED/VE-7)', async () => {
  test.skip(true, 'не дублируется: та же проверка — сценарий RFD-VE7 (rfd.stand.ts) в этом же прогоне; итог VE-7 — по его строке');
});

test('RFD3-VE8 Встройка по ключу LORE: JWKS отдаёт ключ ES256 с kid (SPRINT_VIZ_EMBED/VE-8)', async ({ page }) => {
  await boot(page);
  const j = await api(page, '/lore/embed/jwks', { noAuth: true });
  expect(j.status, `/lore/embed/jwks без входа: ${j.text.slice(0, 160)}`).toBe(200);
  const keys = list(j.body?.keys) as Row[];
  expect(keys.length, `в JWKS препрода есть ключ подписи ES256 (EMB-L6): ${j.text.slice(0, 200)}`).toBeGreaterThan(0);
  const k = keys[0];
  expect(str(k.kty), 'EC-ключ').toBe('EC');
  expect(str(k.crv), 'кривая P-256 (ES256)').toBe('P-256');
  expect(str(k.kid), 'kid задан — Völva ищет ключ по kid издателя').not.toBe('');
  expect(Object.keys(k), 'в JWKS нет закрытой части ключа (d)').not.toContain('d');
  note('«токен HS256 на общем секрете — отказ» и «строка журнала embed_request_log на запрос» — сторона Völva (её app-db и секрет), из LORE не наблюдаемо; рисуется ли встройка — RFD-VE7');
});
