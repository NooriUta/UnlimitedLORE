// Интерфейс новой модели (выпуск 1.18, SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03, D-2026-MIG-REPOSITORY-ORGANIZATION):
// репозитории, организации, вкладка «Репозитории» у проекта и компонента, админка организаций.
// Владелица 19.11.2026: «проверки для 18 пиши … на всех местах работы — mcp, бэка, интеграций и ui».
//
// M1–M4 только читают. M5 ПИШЕТ (заводит организацию TEST-… и привязывает проект) — и потому сам
// проверяет допуск (writeGuard.ts): копия с выключенным входом либо препрод с меткой @writes и только
// TEST-org-smoke / TEST-proj-a (владелица 21.11.2026). Иначе «не выполнен».
//
// Ожидания по данным берутся из среза repositories того же сервера; число «у MIDGARD 4» — данные
// репетиции на ryzenai (перенос 19.11.2026), на другой базе сценарий скажет, сколько увидел.
import { expect, test, type Page } from '@playwright/test';
import { openStand, requireStand, shot, keepLoginFresh, textOf } from './stand.ts';
import { preprodTestWriteRefusal, writeCopyRefusal, WRITES_TAG, type WhoamiAuth } from './writeGuard.ts';
import { call, ensureTestProject, TEST_ORG, TEST_PROJECT_A } from './testData.ts';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const MIDGARD = 'AIDA/MIDGARD';
const MIDGARD_REPO = 'https://git.seidrstudio.pro/AIDA/MIDGARD';
const MIDGARD_REPOS_IN_REHEARSAL = 4;

interface RepoRow { url: string; full_path: string; projects?: string[]; component_projects?: string[]; mirror_projects?: string[]; components?: string[] }

/**
 * GET токеном вошедшей учётки — так же, как сам LORE (Bearer из хранилища OIDC страницы), и dev-роль для копии с
 * выключенным входом. 21.11.2026: прежний page.request ходил без Authorization — стенд отвечал 401, и M1/M3/M4
 * краснели «ответ сервера» на исправных срезах (на базе 1.18 срезы отвечают, M2 через интерфейс зелёный).
 */
async function api<T>(page: Page, path: string): Promise<T> {
  if (!/^https?:/.test(page.url())) await page.goto('/');
  const r = await page.evaluate(async path => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const res = await fetch(path, { headers: { 'X-Seer-Role': 'admin', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* не JSON */ }
    return { status: res.status, body };
  }, path);
  expect(r.status, `${path}: ответ сервера — ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
  return r.body as T;
}

/** Репозитории проекта так же, как их собирает список (repositoryRecord): основной, компонентов, зеркала. */
function reposOfProject(rows: RepoRow[], project: string): string[] {
  return rows.filter(r => [...(r.projects ?? []), ...(r.component_projects ?? []), ...(r.mirror_projects ?? [])].includes(project))
    .map(r => r.full_path).sort();
}

/** Ответы /lore/record/* с ошибкой — паспорт, который «грузится вечно», виден здесь, а не по скелетону. */
function recordFailures(page: Page): string[] {
  const bad: string[] = [];
  page.on('response', r => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/lore/record/') && r.status() >= 400) bad.push(`${r.status()} ${decodeURIComponent(u.pathname)}`);
  });
  return bad;
}

/** Паспорт дошёл до «загружено», без ошибки в доке. */
async function passportLoaded(page: Page, where: string): Promise<void> {
  const loaded = page.locator('[data-testid="kit-rec-loaded"]');
  await expect(loaded.first(), `${where}: паспорт загрузился (не скелетон)`).toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[data-testid="kit-rec-dock"] [role="alert"]');
  const alertText = await textOf(alert);
  expect(await alert.count(), `${where}: ошибка в паспорте — ${alertText}`).toBe(0);
}

/** Вкладка паспорта по ключу связи модели (id вкладки kit — «…-tab-<key>»). */
const tabOf = (page: Page, key: string) => page.locator(`[role="tab"][id$="-tab-${key}"]`);

test('M1 Раздел «Репозитории»: строки есть, группировка по проекту, у MIDGARD свои репозитории', async ({ page }) => {
  const rows = await api<{ rows: RepoRow[] }>(page, '/lore/slice/repositories').then(b => b.rows ?? []);
  expect(rows.length, 'срез repositories не пуст').toBeGreaterThan(0);
  const expected = reposOfProject(rows, MIDGARD);
  expect(expected.length, `данные репетиции: у ${MIDGARD} ${MIDGARD_REPOS_IN_REHEARSAL} репозитория (${expected.join(', ')})`).toBe(MIDGARD_REPOS_IN_REHEARSAL);

  const list = page.locator('[data-record-id]');
  await openStand(page, '/?sec=repository', list);
  await expect(list.first(), 'строки репозиториев показаны').toBeVisible({ timeout: 30_000 });
  // Группировка по проекту — умолчание раздела (defaultGroup): заголовки групп есть без `lg` в адресе.
  const heads = page.locator('.sk-list__ghrow');
  await expect(heads.first(), 'список сгруппирован (заголовки групп)').toBeVisible({ timeout: 15_000 });
  const group = page.locator('tbody').filter({ has: page.locator('.sk-list__gtitle', { hasText: new RegExp(`^${MIDGARD}$`) }) });
  await expect(group, `группа ${MIDGARD} одна`).toHaveCount(1);
  const shown = (await group.locator('tr[data-record-id]').evaluateAll(trs => trs.map(tr => tr.querySelector('.sk-list__c-title')?.textContent?.trim() ?? '')))
    .sort();
  expect(shown, `строки группы ${MIDGARD} = репозитории проекта из среза`).toEqual(expected);
});

test('M2 Паспорт репозитория открывается целиком, связи есть', async ({ page }) => {
  const bad = recordFailures(page);
  await openStand(page, `/?sec=repository&open=${encodeURIComponent(MIDGARD_REPO)}`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `паспорт ${MIDGARD_REPO}`);
  expect(bad, 'запросы паспорта без ошибок (ключ-адрес не теряет «//»)').toEqual([]);
  const head = page.locator('[data-testid="kit-rec-head"]');
  await expect(head.first(), 'шапка паспорта — имя репозитория').toContainText('MIDGARD');
  // Связь «основной у проекта»: вкладка с числом и проект внутри.
  const tab = tabOf(page, 'projects');
  await expect(tab, 'вкладка «Основной у проекта»').toBeVisible({ timeout: 15_000 });
  await expect(tab, 'у вкладки связи есть число').toContainText(/[1-9]/);
  await tab.click();
  await expect(page.locator('[role="tabpanel"]').first(), `в связях — проект ${MIDGARD}`).toContainText(MIDGARD, { timeout: 15_000 });
  expect(bad, 'запросы паспорта без ошибок после перехода по вкладке').toEqual([]);
});

test('M3 Вкладка «Репозитории» у проекта не пуста; у компонента GLADSHEIM — его репозиторий', async ({ page }) => {
  const rows = await api<{ rows: RepoRow[] }>(page, '/lore/slice/repositories').then(b => b.rows ?? []);
  const bad = recordFailures(page);

  const panel = page.locator('[role="tabpanel"]').first();
  await openStand(page, `/?sec=project&open=${encodeURIComponent(MIDGARD)}&tab=repositories`, tabOf(page, 'repositories'));
  await passportLoaded(page, `проект ${MIDGARD}`);
  await expect(tabOf(page, 'repositories'), `${MIDGARD}: вкладка «Репозитории» выбрана`).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  // Вкладка проекта — его рёбра HAS_REPOSITORY и репозитории его компонентов.
  for (const path of reposOfProject(rows, MIDGARD)) {
    await expect(panel, `${MIDGARD}: во вкладке есть ${path}`).toContainText(path, { timeout: 15_000 });
  }

  const gl = rows.filter(r => (r.components ?? []).includes('GLADSHEIM')).map(r => r.full_path);
  expect(gl.length, 'в срезе у компонента GLADSHEIM есть репозиторий').toBeGreaterThan(0);
  await openStand(page, `/?sec=component&open=GLADSHEIM&tab=repositories`, tabOf(page, 'repositories'));
  await passportLoaded(page, 'компонент GLADSHEIM');
  await expect(tabOf(page, 'repositories'), 'GLADSHEIM: вкладка «Репозитории» выбрана').toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  for (const path of gl) await expect(panel, `GLADSHEIM: во вкладке есть ${path}`).toContainText(path, { timeout: 15_000 });
  expect(bad, 'запросы паспортов без ошибок').toEqual([]);
});

test('M4 Раздел «Организации»: строки или честное пустое состояние словами раздела', async ({ page }) => {
  const body = await api<{ rows?: unknown[] }>(page, '/lore/slice/organizations');
  const n = body.rows?.length ?? 0;
  const rows = page.locator('[data-record-id]');
  const empty = page.getByText('Организаций пока нет');
  await openStand(page, '/?sec=organization', rows.or(empty));
  await expect(rows.or(empty).first(), 'раздел дошёл до строк или до пустого состояния').toBeVisible({ timeout: 30_000 });
  const alert = page.locator('[role="alert"]');
  const alertText = await textOf(alert);
  expect(await alert.count(), `ошибка вместо раздела — ${alertText}`).toBe(0);
  if (n === 0) {
    await expect(empty, 'пусто — словами раздела, а не общим «пусто»').toBeVisible();
    await expect(page.getByText('решает владелица'), 'пояснение пустого раздела').toBeVisible();
  } else {
    await expect(rows, `строк столько же, сколько в срезе (${n})`).toHaveCount(n, { timeout: 15_000 });
  }
  // Пользовательское меню — только чтение: «+ Новая» здесь нет даже у администратора (manageOnlyInAdmin).
  await expect(page.locator('[data-testid="list-new"]'), '«+ Новая» только в админке').toHaveCount(0);
});

test('M5 Админка «Организации» под super-admin: завести TEST-организацию, привязать проект, связь в паспорте', { tag: WRITES_TAG }, async ({ page }) => {
  const base = process.env.LORE_STAND_URL?.trim();
  // Два допуска записи (writeGuard.ts): копия с заглушкой входа — своя одноразовая организация и проект MIDGARD;
  // препрод (владелица 21.11.2026: «пусть заводят тестовые проекты») — только TEST-org-smoke и TEST-proj-a.
  if (!/^https?:/.test(page.url())) await page.goto('/news');
  const preprodRefusal = preprodTestWriteRefusal(base, { writer: test.info().tags.includes(WRITES_TAG), ids: [TEST_ORG, TEST_PROJECT_A] });
  const preprod = preprodRefusal === null;
  const who = preprod ? null : await page.request.get('/lore/whoami').then(r => r.ok() ? r.json() as Promise<WhoamiAuth> : null).catch(() => null);
  const copyRefusal = preprod ? null : writeCopyRefusal(base, who);
  test.skip(!preprod && copyRefusal !== null, `запись не выполняется: копия — ${copyRefusal}; препрод — ${preprodRefusal}`);
  const allowed = (origin: string) => (preprod
    ? preprodTestWriteRefusal(origin, { writer: true, ids: [TEST_ORG, TEST_PROJECT_A] })
    : writeCopyRefusal(origin, who));
  // Копия: вход выключен, роль из заголовка — приложение шлёт admin, сценарию нужен super-admin.
  // Препрод: роль — у сохранённого входа test-sa (super-admin), заголовок сервер не слушает.
  if (!preprod) await page.route('**/lore/**', r => r.continue({ headers: { ...r.request().headers(), 'x-seer-role': 'superadmin' } }));
  const bad = recordFailures(page);

  const code = preprod ? TEST_ORG : `TEST-M5-${Date.now().toString(36).toUpperCase()}`;
  const project = preprod ? TEST_PROJECT_A : MIDGARD;
  const title = `Тестовая организация ${code}`;
  const newBtn = page.locator('[data-testid="list-new"]');
  await openStand(page, '/?mod=admin&sec=adm-orgs', newBtn);
  // Адрес после переходов — тот же, что проверен: редирект на стенд или прод не пропускаем.
  expect(allowed(new URL(page.url()).origin), 'страница осталась там, где запись разрешена').toBeNull();
  await expect(newBtn, '«+ Новая» у super-admin в админке').toBeVisible({ timeout: 30_000 });
  // Препрод: удаления организации в API нет — TEST-org-smoke постоянная; есть — переиспользуем, связь пересоздаём.
  const existed = preprod && (await call(page, 'GET', `/lore/record/organization/${encodeURIComponent(code)}`)).status === 200;
  if (preprod) {
    await ensureTestProject(page, project);
    if (existed) {
      const un = await call(page, 'POST', '/lore/organization/link', { org_id: code, rel: 'ORG_HAS_PROJECT', target: project, action: 'remove' });
      expect([200, 404], `снять прежнюю связь ${code} → ${project}: ${un.text}`).toContain(un.status);
      test.info().annotations.push({ type: 'note', description: `${code} уже была — переиспользована (удаления организации в API нет)` });
    }
  }
  if (existed) {
    await openStand(page, `/?mod=admin&sec=adm-orgs&open=${encodeURIComponent(code)}&tab=projects`, page.locator('[data-testid="kit-rec-loaded"]'));
  } else {
    await newBtn.click();
    const form = page.locator('form').filter({ has: page.locator('[data-field="id"]') });
    await expect(form, 'форма новой организации').toBeVisible({ timeout: 15_000 });
    await form.locator('[data-field="id"] input').fill(code);
    await form.locator('[data-field="title"] input').fill(title);
    await form.locator('button[type="submit"]').click();
  }

  // После сохранения — полная запись. Вкладка «Проекты» (ORG_HAS_PROJECT) — выбор с поиском.
  await passportLoaded(page, `организация ${code}`);
  await expect(page.locator('[data-testid="kit-rec-head"]').first(), 'открыта созданная организация').toContainText(code, { timeout: 15_000 });
  // До сохранения форма спрашивает GET /lore/record/organization/<код> — 404 там значит «код свободен»
  // (recordCreate.ts, проба занятости), это не поломка. Считаем ошибки паспортов с этого места.
  expect(bad.filter(b => !b.startsWith(`404 /lore/record/organization/${code}`)), 'до создания — без ошибок, кроме пробы свободного кода').toEqual([]);
  bad.length = 0;
  // У новой организации связей ещё нет, и пустая вкладка «Проекты» уходит под «Ещё» (K5-EMPTY-LINK-TABS, сценарий N6a).
  // Поэтому вкладка открывается адресом (&tab=projects), как в ветке «организация уже была». Прямой щелчок по вкладке
  // в ряду работал, только пока TEST-org-smoke оставалась на стенде с прошлых прогонов. На свежей копии прода
  // (refresh 23.11.2026) организацию заводят заново, и M5 падал: «вкладка -tab-projects не найдена».
  const projTab = tabOf(page, 'projects');
  if (await projTab.isVisible()) await projTab.click();
  else {
    await openStand(page, `/?mod=admin&sec=adm-orgs&open=${encodeURIComponent(code)}&tab=projects`, page.locator('[data-testid="kit-rec-loaded"]'));
    await passportLoaded(page, `организация ${code}, вкладка «Проекты»`);
  }
  const search = page.getByRole('searchbox', { name: /Привязать: Проекты/ });
  await expect(search, 'поиск проекта для привязки').toBeVisible({ timeout: 15_000 });
  await search.fill(preprod ? project : 'MIDGARD');
  const pick = page.getByRole('button', { name: `Привязать ${project}` });
  await expect(pick, `${project} среди вариантов`).toBeVisible({ timeout: 15_000 });
  await pick.click();
  const failed = page.locator('.sk-rel__failed');
  const panel = page.locator('[role="tabpanel"]').first();
  await expect(panel.locator('[data-testid="kit-relation-list"]').or(failed).first(), 'привязка ответила').toBeVisible({ timeout: 15_000 });
  const failedText = await textOf(failed);
  expect(await failed.count(), `привязка отказана: ${failedText}`).toBe(0);
  await expect(panel, `${project} в связях организации`).toContainText(project, { timeout: 15_000 });

  // Связь — с сервера, а не из памяти страницы: паспорт заново, и обратная сторона — у проекта.
  await openStand(page, `/?mod=admin&sec=adm-orgs&open=${encodeURIComponent(code)}&tab=projects`, page.locator('[data-testid="kit-rec-loaded"]'));
  await passportLoaded(page, `организация ${code} заново`);
  await expect(panel, `после перезагрузки ${project} в связях`).toContainText(project, { timeout: 15_000 });
  await openStand(page, `/?sec=project&open=${encodeURIComponent(project)}&tab=organizations`, tabOf(page, 'organizations'));
  await passportLoaded(page, `проект ${project}`);
  await expect(panel, `у проекта ${project} во вкладке «Организации» — ${code}`).toContainText(code, { timeout: 15_000 });
  expect(bad, 'запросы паспортов без ошибок').toEqual([]);
});
