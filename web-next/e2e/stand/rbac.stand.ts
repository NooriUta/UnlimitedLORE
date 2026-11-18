// RBAC на стенде под тестовыми учётками людей (SPEC-LORE-RBAC-ADMIN-TESTCASES, §3, §5, §7).
//
// Первое слово заголовка — ID кейса из спеки (RB-xx / AD-xx), его берёт отчёт.
// Только препрод: global-setup отвергает адреса прода, в том числе по редиректу.
// Учётки только TEST* (D-2026-ONLY-TEST-PREFIXED-ACCOUNTS); вход каждой сохраняет человек
// один раз (README), пароль в репо и к агенту не попадает.
//
// Записи нет. Негативные кейсы шлют запись с ПУСТЫМ телом: гейт роли стоит в ресурсе
// раньше разбора тела, поэтому отказ — 403, а прошедший гейт получает 400 и всё равно
// ничего не пишет. Так «гейт открыт» видно кодом, а мусора на стенде не остаётся.
//
// Кейсы агентов (§4, токены клиентов) здесь не гоняются: нужен секрет клиента, а он
// к прогону не попадает. Они идут в CI с секретом из Infisical — отдельным шагом.
import { readFileSync } from 'node:fs';
import { expect, test as base, type Page } from '@playwright/test';
import { authFileFor, isExpired, jwtPayload, RBAC_ACCOUNTS } from '../../src/standSmoke/rbac.ts';
import { storedAccessToken } from './tokens.ts';
import { asAccount, requireStandUrl, shot } from './stand.ts';

const AUTH_DIR = process.env.LORE_STAND_AUTH_DIR?.trim() || 'e2e/stand/.auth';

interface Api { status: number; body: Record<string, unknown> | null; text: string }

/** Запрос к API стенда токеном вошедшей учётки (токен берёт приложение, после своего обновления). */
async function api(page: Page, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; noAuth?: boolean; token?: string } = {}): Promise<Api> {
  return page.evaluate(async ({ method, path, opts }) => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const live = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const token = opts.noAuth ? undefined : (opts.token ?? live);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* не JSON */ }
    return { status: res.status, body, text: text.slice(0, 400) };
  }, { method, path, opts });
}

async function whoami(page: Page): Promise<Record<string, unknown>> {
  const r = await api(page, 'GET', '/lore/whoami');
  expect(r.status, `/lore/whoami: ${r.text}`).toBe(200);
  return r.body ?? {};
}

/**
 * `login(учётка)` — новая вкладка с сохранённым входом этой учётки, приложение загружено.
 * После сценария — скрин последней вкладки в отчёт и закрытие всех.
 */
const test = base.extend<{ login: (account: string) => Promise<Page> }>({
  login: async ({ browser }, use, info) => {
    const pages: Page[] = [];
    await use(async account => {
      const page = await asAccount(browser, authFileFor(AUTH_DIR, account), account);
      info.annotations.push({ type: 'account', description: account });
      pages.push(page);
      return page;
    });
    const last = pages.at(-1);
    if (last) await shot(last, info);
    for (const p of pages) await p.context().close().catch(() => undefined);
  },
});

test.beforeEach(() => requireStandUrl());

// ── §3 Ось 1: роль из токена ────────────────────────────────────────────────

const ROLE_CASES = [
  ['RB-01', RBAC_ACCOUNTS.superAdmin, 'superadmin'],
  ['RB-02', RBAC_ACCOUNTS.admin, 'admin'],
  ['RB-03', RBAC_ACCOUNTS.viewer, 'viewer'],
] as const;

for (const [id, account, role] of ROLE_CASES) {
  test(`${id} Роль из токена: ${account} → ${role}`, async ({ login }) => {
    const page = await login(account);
    const me = await whoami(page);
    expect(me.kind, 'учётка человека, не агента').toBe('human');
    expect(me.seer_role, `seer_role ${account}`).toBe(role);
  });
}

test('RB-04 viewer не пишет: POST /lore/task → 403 со словами', async ({ login }) => {
  const page = await login(RBAC_ACCOUNTS.viewer);
  const r = await api(page, 'POST', '/lore/task', { body: {} });
  expect(r.status, `ответ: ${r.text}`).toBe(403);
  expect(String(r.body?.detail ?? r.body?.message ?? r.body?.error ?? ''), 'причина отказа словами').not.toBe('');
});

test('RB-05 viewer читает в пределах скоупа: есть проекты → 200, нет проектов → 403 SCOPE_EMPTY словами', async ({ login }) => {
  // Контракт сервера (проектный скоуп): пустой скоуп — не «200 и пусто», а честный отказ
  // SCOPE_EMPTY со словами (прогон 7856: у test-viewer на препроде проектов нет).
  const page = await login(RBAC_ACCOUNTS.viewer);
  const roles = ((await whoami(page)).project_roles ?? []) as unknown[];
  const r = await api(page, 'GET', '/lore/slice/sprints');
  if (roles.length > 0) {
    expect(r.status, `есть проекты — чтение открыто: ${r.text}`).toBe(200);
  } else {
    expect(r.status, `нет проектов — честный отказ, не пустой список: ${r.text}`).toBe(403);
    expect(String(r.body?.error), 'код отказа').toBe('SCOPE_EMPTY');
    expect(String(r.body?.detail ?? ''), 'причина словами').not.toBe('');
  }
});

test('RB-06 Заголовок X-Seer-Role: superadmin роль не повышает', async ({ login }) => {
  const page = await login(RBAC_ACCOUNTS.viewer);
  const spoof = { 'X-Seer-Role': 'superadmin' };
  const me = await api(page, 'GET', '/lore/whoami', { headers: spoof });
  expect(me.status).toBe(200);
  expect(me.body?.seer_role, 'роль из токена, не из заголовка').toBe('viewer');
  const w = await api(page, 'POST', '/lore/task', { body: {}, headers: spoof });
  expect(w.status, `запись с подделанным заголовком: ${w.text}`).toBe(403);
  const p = await api(page, 'POST', '/lore/project', { body: {}, headers: spoof });
  expect(p.status, `создание проекта с подделанным заголовком: ${p.text}`).toBe(403);
});

test('RB-07 Без токена: запись и чтение → 401', async ({ login }) => {
  // Учётка нужна только чтобы открыть страницу стенда (тот же origin); токен не шлём.
  const page = await login(RBAC_ACCOUNTS.viewer);
  const w = await api(page, 'POST', '/lore/task', { body: {}, noAuth: true, headers: { 'X-Seer-Role': 'admin' } });
  expect(w.status, `запись без токена: ${w.text}`).toBe(401);
  const r = await api(page, 'GET', '/lore/slice/sprints', { noAuth: true });
  expect(r.status, `чтение без токена (MIG-30): ${r.text}`).toBe(401);
});

test('RB-08 Просроченный токен → 401', async ({ login }) => {
  // Токен, записанный в файле входа, живёт минуты; приложение при загрузке берёт новый.
  // Если записанный уже истёк — это и есть просроченный токен настоящей учётки.
  let stale: string | null = null;
  try { stale = storedAccessToken(JSON.parse(readFileSync(authFileFor(AUTH_DIR, RBAC_ACCOUNTS.viewer), 'utf8'))); } catch { /* нет файла — скажет login */ }
  const page = await login(RBAC_ACCOUNTS.viewer);
  const claims = stale ? jwtPayload(stale) : null;
  test.skip(!stale || !claims || !isExpired(claims, Date.now()), 'токен в файле входа ещё не истёк — просроченного нет, кейс не выполнен');
  const r = await api(page, 'GET', '/lore/whoami', { token: stale! });
  expect(r.status, `просроченный токен: ${r.text}`).toBe(401);
  const w = await api(page, 'POST', '/lore/task', { body: {}, token: stale! });
  expect(w.status, `запись просроченным токеном: ${w.text}`).toBe(401);
});

test('RB-11 admin не создаёт проект (только super-admin, ADR-LORE-025-D17)', async ({ login }) => {
  const page = await login(RBAC_ACCOUNTS.admin);
  const r = await api(page, 'POST', '/lore/project', { body: {} });
  expect(r.status, `admin, создание проекта: ${r.text}`).toBe(403);
  // Положительный контроль: у admin гейт задачи пройден (400 за пустое тело, не 403).
  const t = await api(page, 'POST', '/lore/task', { body: {} });
  expect(t.status, `admin, гейт задачи пройден, тело отвергнуто: ${t.text}`).toBe(400);
});

test('RB-11a super-admin проходит гейт создания проекта (400 за пустое тело, не 403)', async ({ login }) => {
  const page = await login(RBAC_ACCOUNTS.superAdmin);
  const r = await api(page, 'POST', '/lore/project', { body: {} });
  expect(r.status, `super-admin, создание проекта с пустым телом: ${r.text}`).toBe(400);
});

// ── §5 Проектные роли ───────────────────────────────────────────────────────

test('RB-40 Владелец видит свой проект: test-user-1 — owner в TEST-proj-a', async ({ login }) => {
  const page = await login(RBAC_ACCOUNTS.user1);
  const me = await whoami(page);
  const roles = (me.project_roles ?? []) as { project?: string; role?: string }[];
  test.skip(roles.length === 0, 'у test-user-1 нет проектных ролей — тестовые проекты (TEST-proj-a) на стенде не заведены, кейс не выполнен');
  expect(roles, 'роль owner в TEST-proj-a').toContainEqual(expect.objectContaining({ project: 'TEST-proj-a', role: 'owner' }));
  for (const r of roles) expect(String(r.project), 'только тестовые проекты').toMatch(/^TEST-/);
});

const STAND_BACK_ON = Date.parse('2026-11-21T00:00:00Z');

// ── §7 Админка ──────────────────────────────────────────────────────────────

test('AD-01 Админка viewer-у: честный отказ, а не пустой экран', async ({ login }) => {
  // Владелица 18.11.2026: «выключи с пометкой вернутся 21 эти тесты». Красный на стенде — «Новости» (#1573, держит владелица)
  // и админка viewer; не регрессия релиза v1.17.27. Пропуск снимается сам 21.11.2026 — правки не нужно.
  test.skip(Date.now() < STAND_BACK_ON, 'выключен владелицей 18.11 до 21.11.2026 — вернётся сам');
  const page = await login(RBAC_ACCOUNTS.viewer);
  await page.goto('/?mod=admin&sec=adm-home');
  const card = page.locator('[data-testid="adm-home-403"]');
  await expect(card, 'карточка Главной админки показана').toBeVisible({ timeout: 30_000 });
  await expect(card, 'карточка дочиталась').not.toHaveAttribute('data-state', 'loading', { timeout: 30_000 });
  await expect(card, 'журнал отказов viewer-у закрыт — «нет прав», не «0»').toHaveAttribute('data-state', 'forbidden');
});

for (const [id, account, role] of [['AD-02', RBAC_ACCOUNTS.admin, 'admin'], ['AD-02v', RBAC_ACCOUNTS.viewer, 'viewer']] as const) {
  test(`${id} «Вы: …» в шапке админки совпадает с whoami (${account})`, async ({ login }) => {
    const page = await login(account);
    const me = await whoami(page);
    expect(me.seer_role).toBe(role);
    await page.goto('/?mod=admin&sec=adm-home');
    const bar = page.locator('[data-testid="adm-whoami"]');
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).not.toHaveAttribute('data-state', 'loading', { timeout: 30_000 });
    await expect(bar, 'роль в шапке').toContainText(role);
    if (typeof me.sub === 'string' && me.sub) await expect(bar, 'в шапке не сырой kc_sub').not.toContainText(me.sub);
  });
}
