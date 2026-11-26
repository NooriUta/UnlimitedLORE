// Препрод на 1.18 (пакет #1683–#1696, база переноса с организацией): смоук новых поверхностей.
// По сценарию на задачу; код сценария — первое слово заголовка (N1…N6), задача — в заголовке.
// Только чтение: стенд *.seidrstudio.pro писать нельзя (writeGuard.ts). API — токеном сохранённого входа
// (Bearer из хранилища OIDC страницы, как create.stand.ts): page.request без него получает 401.
import { expect, test, type Page } from '@playwright/test';
import { authFileFor, RBAC_ACCOUNTS } from '../../src/standSmoke/rbac.ts';
import { asAccount, keepLoginFresh, openStand, requireStand, shot, textOf } from './stand.ts';

const AUTH_DIR = process.env.LORE_STAND_AUTH_DIR?.trim() || 'e2e/stand/.auth';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

type Row = Record<string, unknown>;
interface Api { status: number | null; body: Row | null }

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

async function sliceBody(page: Page, name: string, params: Record<string, string> = {}): Promise<Row> {
  const q = new URLSearchParams(params).toString();
  const path = `/lore/slice/${name}${q ? `?${q}` : ''}`;
  const r = await api(page, path);
  expect(r.status, `${path}: ответ сервера — ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  return r.body ?? {};
}
const rowsOf = (b: Row): Row[] => (Array.isArray(b.rows) ? (b.rows as Row[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

async function boot(page: Page): Promise<void> {
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"], .sk-empty, h1'));
}

async function passportLoaded(page: Page, where: string): Promise<void> {
  await expect(page.locator('[data-testid="kit-rec-loaded"]').first(), `${where}: паспорт загрузился`).toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[data-testid="kit-rec-dock"] [role="alert"]');
  const alertText = await textOf(alert);
  expect(await alert.count(), `${where}: ошибка в паспорте — ${alertText}`).toBe(0);
}

/** Группа левого меню по подписи; свёрнута — раскрыть. Возвращает разделы её пунктов (sec= из href). */
async function menuGroupSections(page: Page, title: string, min: number): Promise<string[]> {
  const group = page.locator('.sk-shell__side section').filter({ has: page.locator('h2', { hasText: title }) }).first();
  await expect(group, `группа меню «${title}»`).toBeVisible({ timeout: 15_000 });
  const secs = async () => group.locator('a.sk-shell__item').evaluateAll(as => as.map(a => new URL((a as HTMLAnchorElement).href).searchParams.get('sec') ?? ''));
  if ((await secs()).length < min) await group.locator('h2 button').first().click().catch(() => undefined);
  return secs();
}

// ── N1 SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER ──────────────────────────────────────────────────────
test('N1 Верхний фильтр «Продукты» (?prod=): HARPA раскрывается в 2 проекта и сужает спринты (SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER)', async ({ page }) => {
  await boot(page);
  const products = rowsOf(await sliceBody(page, 'products'));
  const harpa = products.find(p => /^harpa$/i.test(str(p.code))) ?? products.find(p => /harpa/i.test(`${str(p.code)} ${str(p.label_ru)}`));
  expect(harpa, `продукт HARPA в срезе products (коды: ${products.map(p => str(p.code)).join(', ').slice(0, 200)})`).toBeTruthy();
  const code = str(harpa!.code);

  const all = rowsOf(await sliceBody(page, 'sprints'));
  const narrowed = await sliceBody(page, 'sprints', { scope_products: code });
  const meta = (narrowed.scope_projects ?? {}) as Row;
  const from = (meta.from_products ?? {}) as Row;
  expect(list(from.products), 'отметка ответа: from_products.products').toEqual([code]);
  expect(list(from.projects).length, `HARPA раскрыта в 2 проекта (получено: ${JSON.stringify(from.projects)})`).toBe(2);
  const nRows = rowsOf(narrowed).length;
  expect(nRows, 'с продуктом спринты есть').toBeGreaterThan(0);
  // Положительный контроль: без продукта строк больше.
  expect(all.length, `без продукта спринтов больше (${all.length} против ${nRows})`).toBeGreaterThan(nRows);

  // Шапка: выбор «Продукты»; ?prod= уходит бэкенду как scope_products.
  const asked = page.waitForRequest(r => r.url().includes('/lore/slice/') && r.url().includes(`scope_products=${encodeURIComponent(code)}`), { timeout: 30_000 }).catch(() => null);
  const trigger = page.locator('.sk-scope__trigger[aria-label^="Продукты"]');
  await openStand(page, `/?sec=sprint&prod=${encodeURIComponent(code)}`, trigger);
  await expect(trigger.first(), 'в шапке — выбор «Продукты»').toBeVisible({ timeout: 30_000 });
  await expect(trigger.first(), 'выбран HARPA').toHaveAttribute('aria-label', new RegExp(str(harpa!.label_ru) || code, 'i'));
  expect(await asked, 'список спринтов запрошен с scope_products').not.toBeNull();
});

// ── N2 SPRINT_UXR_S13_KIT4/K4-CHARTS ────────────────────────────────────────────────────────────────────
test('N2 Графики паспорта — вкладка «Графики» в «Аналитике», не над шапкой; «Ритм релизов» без BAD_PARAMS (SPRINT_UXR_S13_KIT4/K4-CHARTS)', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const sprint = rowsOf(await sliceBody(page, 'sprints', { limit: '1' }))[0];
  const sid = str(sprint?.sprint_id);
  expect(sid, 'есть спринт').not.toBe('');
  const charts = page.locator('[data-testid="kit-rec-dock"] .sk-rec-charts');
  await openStand(page, `/?sec=sprint&open=${encodeURIComponent(sid)}&tab=overview`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `паспорт спринта ${sid}`);
  expect(await charts.count(), 'на «Контенте» графиков над шапкой нет').toBe(0);
  const dock = page.locator('[data-testid="kit-rec-dock"]');
  await dock.getByRole('group', { name: 'Вид паспорта' }).getByRole('button', { name: 'Аналитика' }).click();
  await expect(dock.getByRole('tab', { name: /^Графики/ }).first(), '«Аналитика» открывает вкладку «Графики»').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(charts.first(), 'графики спринта во вкладке').toBeVisible({ timeout: 30_000 });

  // «Ритм релизов» — график проекта (№8). Ключ проекта LORE — из git_projects (на 1.18 может отличаться).
  const slugs = rowsOf(await sliceBody(page, 'git_projects')).map(p => str(p.slug));
  const lore = slugs.find(s => s === 'NooriUta/UnlimitedLORE') ?? slugs.find(s => /\/UnlimitedLORE$/i.test(s)) ?? 'NooriUta/UnlimitedLORE';
  await openStand(page, `/?sec=project&open=${encodeURIComponent(lore)}&tab=charts`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `паспорт проекта ${lore}`);
  await expect(charts.first(), 'графики проекта во вкладке «Графики»').toBeVisible({ timeout: 30_000 });
  await expect(charts.getByText(/Ритм релизов/).first(), 'график «Ритм релизов»').toBeVisible({ timeout: 30_000 });
  const chartsText = await textOf(charts, 2000);
  expect(chartsText, 'в графиках нет BAD_PARAMS').not.toMatch(/BAD_PARAMS/);
});

// ── N3 SPRINT_LORE_ADMIN_POLISH/AP-08 (#1693) ───────────────────────────────────────────────────────────
test('N3 Вход в админку пунктом левого меню: у test-sa есть, у test-viewer нет (SPRINT_LORE_ADMIN_POLISH/AP-08)', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const entry = (p: Page) => p.locator('.sk-shell__side a.sk-shell__item[href*="sec=admin-entry"]');
  await openStand(page, '/?sec=task', page.locator('.sk-shell__side'));
  await expect(entry(page), 'test-sa: пункт «Админка» в левом меню').toHaveCount(1, { timeout: 30_000 });
  await expect(entry(page), 'подпись «Админка»').toContainText('Админка');
  await entry(page).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('mod'), { message: 'пункт переключает модуль ?mod=admin' }).toBe('admin');

  const viewer = await asAccount(browser, authFileFor(AUTH_DIR, RBAC_ACCOUNTS.viewer), RBAC_ACCOUNTS.viewer);
  try {
    await openStand(viewer, '/?sec=task', viewer.locator('.sk-shell__side'));
    await expect(viewer.locator('.sk-shell__side a.sk-shell__item').first(), 'test-viewer: меню показано').toBeVisible({ timeout: 30_000 });
    await viewer.waitForTimeout(1500); // роль из /lore/whoami приходит после меню
    expect(await entry(viewer).count(), 'test-viewer: пункта «Админка» нет').toBe(0);
  } finally {
    await shot(viewer, test.info()).catch(() => undefined);
    await viewer.context().close().catch(() => undefined);
  }
});

// ── N4 SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE (#1696) ──────────────────────────────────────────────────
test('N4 Ссылки на человека и агента с общих поверхностей ведут на их страницу, а не в админку (SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE)', async ({ page }) => {
  test.setTimeout(120_000);
  const hrefs = (p: Page) => p.locator('main a[href], [data-testid="kit-rec-dock"] a[href]').evaluateAll(as =>
    as.map(a => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  const toAdmin = (h: string) => /[?&]mod=admin|(^|\/)admin(\?|$|\/)|adm-open=|adm=/.test(h);

  await openStand(page, '/news', page.locator('[data-testid^="news-row-"]'));
  await expect(page.locator('[data-testid^="news-row-"]').first(), 'лента новостей показана').toBeVisible({ timeout: 30_000 });
  const news = await hrefs(page);
  expect(news.filter(toAdmin), 'в ленте нет ссылок в админку').toEqual([]);
  const isPerson = (h: string) => /[?&]sec=(user|agent)(&|$)/.test(h);

  // Паспорт задачи: автор, исполнитель, принимающий.
  await openStand(page, `/?sec=task&open=${encodeURIComponent('SPRINT_UXR_POLISH_UAT_1113/PU-03')}`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, 'паспорт задачи PU-03');
  const pass = await hrefs(page);
  expect(pass.filter(toAdmin), 'в паспорте задачи нет ссылок в админку').toEqual([]);
  // Все ссылки на людей и агентов — вне админки (цель AP-PEOPLE-PAGE ч.1).
  const people = [...new Set([...news, ...pass].filter(isPerson))];
  test.skip(!people.length, 'ни в ленте, ни в паспорте PU-03 нет ссылки на человека или агента — переход проверить не на чем');
  for (const h of people) {
    const u = new URL(h, 'https://x/');
    expect(u.searchParams.get('mod'), `${h}: страница человека — вне админки`).not.toBe('admin');
  }
  // Паспорт — у того, кто заведён в LORE. Прогон 39448: первая ссылка ленты вела на kc_sub без записи KnowUser
  // («Запись … не найдена») — автор правки есть в KC, но не в графе людей (гипотеза: TEST-учётка, писавшая на
  // препроде). Такие ссылки — находка (named), а не повод не проверить страницу у заведённых.
  let target: string | null = null;
  const missing: string[] = [];
  for (const h of people) {
    const u = new URL(h, 'https://x/');
    const r = await api(page, `/lore/record/${u.searchParams.get('sec')}/${encodeURIComponent(u.searchParams.get('open') ?? '')}`);
    if (r.status === 200) { target ??= h; } else missing.push(`${u.searchParams.get('sec')}:${u.searchParams.get('open')} → ${r.status}`);
  }
  if (missing.length) test.info().annotations.push({ type: 'note', description: `ссылки на людей без записи в LORE: ${missing.join('; ')}` });
  test.skip(!target, `ни у одной ссылки на человека нет записи в LORE (${missing.join('; ')}) — страницу проверить не на чем`);
  await page.goto(target!);
  await passportLoaded(page, `страница ${target}`);
  expect(new URL(page.url()).searchParams.get('mod'), 'страница человека — вне админки').not.toBe('admin');
  const sec = new URL(page.url()).searchParams.get('sec');
  const id = new URL(page.url()).searchParams.get('open') ?? '';
  expect(['user', 'agent'], 'открыт раздел человека или агента').toContain(sec);
  const rec = await api(page, `/lore/record/${sec}/${encodeURIComponent(id)}`);
  expect(rec.status, `/lore/record/${sec}/${id}`).toBe(200);
});

// ── N5 меню «Организация» и «Устройство» ────────────────────────────────────────────────────────────────
test('N5 Меню: «Организация» — организации, продукты, проекты, люди; «Устройство» — технологии, репозитории, компоненты (SPRINT_LORE_PROJECT_SCOPE/PS-PRODUCT-FILTER)', async ({ page }) => {
  await openStand(page, '/?sec=task', page.locator('.sk-shell__side'));
  await expect(page.locator('.sk-shell__side').first(), 'левое меню').toBeVisible({ timeout: 30_000 });
  const org = await menuGroupSections(page, 'Организация', 4);
  expect(org, 'группа «Организация»').toEqual(expect.arrayContaining(['organization', 'product', 'project', 'user']));
  const sys = await menuGroupSections(page, 'Устройство', 3);
  expect(sys, 'группа «Устройство»').toEqual(expect.arrayContaining(['tech', 'repository', 'component']));
  expect(sys.filter(s => ['organization', 'product', 'project', 'user'].includes(s)), 'в «Устройстве» нет пунктов «Организации»').toEqual([]);
  const rows = page.locator('[data-record-id]');
  await openStand(page, '/?sec=organization', rows.or(page.locator('.sk-empty')));
  await expect(rows.or(page.locator('.sk-empty')).first(), 'раздел «Организации» открывается (база переноса с организацией)').toBeVisible({ timeout: 30_000 });
  expect(await rows.count(), 'организация AIDA перенесена').toBeGreaterThan(0);
});

// ── N6 SPRINT_UXR_S14_KIT5/K5-EMPTY-LINK-TABS ───────────────────────────────────────────────────────────
test('N6a Пустые вкладки связей не занимают ряд — уходят под «Ещё» со своим «0» (SPRINT_UXR_S14_KIT5/K5-EMPTY-LINK-TABS)', async ({ page }) => {
  await openStand(page, '/?sec=adr&open=ADR-LORE-050&place=full', page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, 'паспорт ADR-LORE-050');
  const row = page.locator('.sk-rec__tabs .sk-tabs').first();
  await expect(row, 'ряд вкладок паспорта').toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500); // счётчики связей догружаются
  const tabs = await row.locator('.sk-tab:not(.sk-tabs__more-btn)').evaluateAll(ts => ts.map(t => ({
    label: (t.textContent ?? '').trim(), count: t.querySelector('.sk-tab__count')?.textContent ?? null,
    relation: (t as HTMLElement).dataset.relation ?? null, selected: t.getAttribute('aria-selected') === 'true',
  })));
  const zero = tabs.filter(t => t.relation && t.count === '0' && !t.selected);
  expect(zero.map(t => t.label), 'в ряду нет вкладок связей с нулём').toEqual([]);
  // Положительный контроль: непустая связь в ряду есть («Решения 6» на 15–16.11).
  expect(tabs.some(t => t.relation && t.count && t.count !== '0' && t.count !== '?'), `непустая вкладка связи в ряду (${tabs.map(t => t.label).join(' · ')})`).toBe(true);
  const more = row.locator('.sk-tabs__more-btn');
  test.skip(!(await more.count()), 'кнопки «Ещё» нет — у записи нет пустых связей, уходить нечему');
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu, 'меню «Ещё»').toBeVisible();
  await expect(menu.locator('.sk-tabs__more-item .sk-tab__count', { hasText: /^0$/ }).first(), 'пустые вкладки не удалены — под «Ещё» со своим «0»').toBeVisible();
  await page.keyboard.press('Escape');
});

// ── N6 SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS ─────────────────────────────────────────────────────
test('N6b Подписи связей из модели с обратной подписью inverse_label; меню — из nav модели (SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS)', async ({ page }) => {
  await boot(page);
  const rec = await api(page, `/lore/record/task/${['SPRINT_UXR_POLISH_UAT_1113', 'PU-03'].map(encodeURIComponent).join('/')}`);
  expect(rec.status, 'паспорт задачи PU-03').toBe(200);
  const rels = list((rec.body?.schema as Row | undefined)?.relations) as Row[];
  expect(rels.length, 'связи задачи в схеме').toBeGreaterThan(0);
  expect(rels.filter(r => !('inverse_label' in r)).map(r => str(r.key)), 'у каждой связи есть ключ inverse_label').toEqual([]);
  const dep = rels.find(r => r.key === 'dependsOn');
  expect(str(dep?.inverse_label), '«Зависит от» — обратная подпись «От неё зависят»').toBe('От неё зависят');
  expect(str(dep?.inverse_label), 'обратная подпись — не то же слово').not.toBe(str(dep?.label));

  // Меню из nav модели: каждый раздел nav — пункт левого меню.
  const cfg = await api(page, '/lore/model/config');
  expect(cfg.status, '/lore/model/config').toBe(200);
  const doc = JSON.parse(str(cfg.body?.content) || '{}') as { nav?: Row[] };
  const navSecs = (doc.nav ?? []).flatMap(g => list(g.items).map(i => str((i as Row).section))).filter(Boolean);
  expect(navSecs.length, 'nav в модели').toBeGreaterThan(0);
  await openStand(page, '/?sec=task', page.locator('.sk-shell__side'));
  await expect(page.locator('.sk-shell__side a.sk-shell__item').first(), 'меню показано').toBeVisible({ timeout: 30_000 });
  // KREG-13 (стенд 26.11.2026, v1.19.1): пока /lore/model не пришёл, оболочка рисует запасное рукописное меню.
  // Раньше каждый раздел nav был и в нём, и тест читал меню после первого пункта; раздел только из модели
  // («Скиллы») ловил запасное меню. Ждём, пока меню соберётся из модели; раздела нет и после предела — падение.
  const missing = async () => {
    // Свёрнутые группы прячут пункты — раскрыть все.
    for (const h of await page.locator('.sk-shell__side section h2 button[aria-expanded="false"]').all()) await h.click().catch(() => undefined);
    const menuSecs = await page.locator('.sk-shell__side a.sk-shell__item').evaluateAll(as => as.map(a => new URL((a as HTMLAnchorElement).href).searchParams.get('sec') ?? ''));
    return navSecs.filter(s => !menuSecs.includes(s));
  };
  await expect.poll(missing, { message: 'разделы nav модели, которых нет в меню', timeout: 30_000 }).toEqual([]);
});
