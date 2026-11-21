// Раздел админки «Перенос на новую модель» (выпуск 1.18, SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02).
// Владелица 19.11.2026: «на админку тесты playwright».
//
// MA1–MA3, MA5, MA6 только читают («Перепроверить» и «Пробный перенос» сейчас ничего не запускают — сервер
// честно отвечает 501). MA4 ПИШЕТ правило переноса в файл решений сервера и тут же отменяет его — поэтому
// сам проверяет, что адрес — копия: не стенд, не прод, вход выключен (writeGuard.ts). Иначе «не выполнен».
//
// Роль: на копии вход выключен, и роль берётся из заголовка X-Seer-Role — сценарий подставляет нужную.
// На адресе со входом роль задаёт сохранённая учётка; сценарий, которому нужна другая роль, «не выполнен».
import { expect, test, type Page } from '@playwright/test';
import { openStand, requireStand, shot, keepLoginFresh, textOf } from './stand.ts';
import { writeCopyRefusal, type WhoamiAuth } from './writeGuard.ts';

test.beforeEach(() => requireStand());
// Вход не истекает посреди прогона (E2E-STAND, прогон 9033): до создания страницы сценария.
test.beforeEach(({ browser }) => keepLoginFresh(browser));
test.afterEach(async ({ page }, info) => shot(page, info));

const SECTION = '/?mod=admin&sec=adm-migration';

async function whoami(page: Page): Promise<WhoamiAuth | null> {
  return page.request.get('/lore/whoami').then(r => (r.ok() ? (r.json() as Promise<WhoamiAuth>) : null)).catch(() => null);
}

/** Роль вызывающего. Вход выключен — подставляем заголовок; включён — роль у учётки, подменять нечем. */
async function asRole(page: Page, role: 'superadmin' | 'admin'): Promise<WhoamiAuth | null> {
  const who = await whoami(page);
  if (who?.auth_enabled === false) {
    await page.route('**/lore/**', r => r.continue({ headers: { ...r.request().headers(), 'x-seer-role': role } }));
  } else if (role === 'admin') {
    test.skip(true, 'вход на адресе включён: роль admin задаёт учётка, подменить её сценарий не может');
  }
  return who;
}

/** Ответ сервера под super-admin — для ожиданий, а не для подмены экрана. */
async function report(page: Page): Promise<Record<string, unknown> | null> {
  const r = await page.request.get('/lore/admin/migration', { headers: { 'X-Seer-Role': 'superadmin' } }).catch(() => null);
  return r && r.ok() ? ((await r.json()) as Record<string, unknown>) : null;
}

const section = (page: Page) => page.locator('[data-testid="adm-migration"]');
const stage = (page: Page) => page.locator('[data-testid="adm-mig-stage"]');
const waiting = (page: Page) => page.locator('[data-testid="adm-mig-waiting"]');
const numberIn = (s: string) => Number((/(\d[\d\s]*)/.exec(s)?.[1] ?? 'NaN').replace(/\s/g, ''));

test('MA1 Раздел открывается под super-admin: полоса этапов или честное состояние, не пустой экран', async ({ page }) => {
  await asRole(page, 'superadmin');
  const honest = stage(page).or(page.locator('[data-testid="adm-mig-norun"]')).or(page.locator('[data-testid="adm-mig-source"]'));
  await openStand(page, SECTION, honest);
  await expect(section(page), 'раздел «Перенос» есть в админке').toBeVisible({ timeout: 30_000 });
  await expect(honest.first(), 'полоса этапов, «прогона ещё не было» или «источник недоступен»').toBeVisible({ timeout: 30_000 });
  const forbidden = section(page).locator('[data-state="forbidden"]');
  expect(await forbidden.count(), `super-admin не получает запрет: ${await textOf(forbidden)}`).toBe(0);
  if (await stage(page).count()) await expect(stage(page), 'этапов пять: чтение, расчёт, сведение, запись, сверка').toHaveCount(5);
});

test('MA2 Под admin (не super-admin) — экран запрета kit, а не ошибка', async ({ page }) => {
  await asRole(page, 'admin');
  const forbidden = section(page).locator('[data-state="forbidden"]');
  await openStand(page, SECTION, forbidden);
  await expect(forbidden, 'kit Forbidden (data-state="forbidden")').toBeVisible({ timeout: 30_000 });
  expect(await section(page).locator('[data-state="error"]').count(), 'не «ошибка загрузки»').toBe(0);
  expect(await stage(page).count(), 'данных раздела admin не видит').toBe(0);
});

test('MA3 Группы чипами, выбор группы в адресе (mig=), у строки — правило и ссылка, ссылка открывает паспорт', async ({ page }) => {
  await asRole(page, 'superadmin');
  const body = await report(page);
  const groups = Array.isArray(body?.groups) ? (body!.groups as { kind: string; rows: { refs?: unknown[] }[] }[]) : [];
  test.skip(!groups.length, `отчёта с расхождениями нет (состояние «${String(body?.state ?? 'не прочитано')}») — сценарий не выполнен`);
  const chips = page.locator('[data-testid^="adm-mig-group-"]');
  await openStand(page, SECTION, chips);
  await expect(chips, 'по чипу на группу').toHaveCount(groups.length, { timeout: 30_000 });
  if (groups.length > 1) {
    await chips.nth(1).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('mig'), 'выбор группы — в адресе').toBe('1');
    await expect(chips.nth(1), 'выбранный чип отмечен').toHaveAttribute('aria-checked', 'true');
  }
  const gi = groups.findIndex(g => g.kind === 'reject' && g.rows.some(r => (r.refs ?? []).length > 0));
  test.skip(gi < 0, 'в отчёте нет строки со ссылкой на запись — переход в паспорт не проверить');
  await chips.nth(gi).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('mig'), 'выбор группы — в адресе').toBe(String(gi));
  const row = page.locator('[data-testid="adm-mig-row"]').filter({ has: page.locator('[data-testid="adm-mig-ref"]') }).first();
  await expect(row, 'строка со ссылкой на запись').toBeVisible({ timeout: 15_000 });
  const rule = row.locator('[data-testid="adm-mig-action"]').or(row.locator('.sk-pill'));
  await expect(rule.first(), 'у строки — выбор правила или принятое правило').toBeVisible();
  const href = await row.locator('[data-testid="adm-mig-ref"]').first().getAttribute('href');
  expect(href, 'ссылка ведёт в паспорт (open=…)').toMatch(/open=/);
  await openStand(page, href!, page.locator('[data-testid="kit-rec-loaded"]'));
  await expect(page.locator('[data-testid="kit-rec-loaded"]').first(), 'паспорт записи загрузился').toBeVisible({ timeout: 30_000 });
});

test('MA4 Правило на копии: окно с подтверждением логином, «ждут решения» убывает, отмена возвращает счёт', async ({ page }) => {
  const base = process.env.LORE_STAND_URL?.trim();
  const who = await whoami(page);
  const refusal = writeCopyRefusal(base, who);
  // Препроду разрешены только TEST-сущности (writeGuard.ts), а правило переноса пишется в файл решений самого
  // стенда — это не TEST-данные. Решение координатора 21.11.2026: MA4 на стенде не гоняем.
  test.skip(refusal !== null, `принято владелицей на ryzenai 16.11 (MIG-02); на стенде запись правила изменила бы файл решений стенда — не гоняем (${refusal})`);
  await asRole(page, 'superadmin');
  const body = await report(page);
  const login = typeof body?.login === 'string' ? body.login : null;
  test.skip(!login, 'сервер не видит человека (логин-заглушка копии не задана) — правило не принять');
  const free = (Array.isArray(body?.groups) ? (body!.groups as { kind: string; rows: { decision: unknown }[] }[]) : [])
    .findIndex(g => g.kind === 'reject' && g.rows.some(r => !r.decision));
  test.skip(free < 0, 'строк без правила нет — счётчику нечего убывать');

  const chips = page.locator('[data-testid^="adm-mig-group-"]');
  await openStand(page, `${SECTION}&mig=${free}`, chips);
  expect(writeCopyRefusal(new URL(page.url()).origin, who), 'страница осталась на копии').toBeNull();
  await expect(waiting(page), 'счётчик «ждут решения»').toBeVisible({ timeout: 30_000 });
  const before = numberIn(await waiting(page).innerText());
  expect(before, 'счётчик — число').toBeGreaterThan(0);

  const row = page.locator('[data-testid="adm-mig-row"]').filter({ has: page.locator('[data-testid="adm-mig-action"]') }).first();
  await row.locator('[data-testid="adm-mig-action"]').selectOption('drop');
  await row.locator('[data-testid="adm-mig-accept"]').click();
  const apply = page.locator('[data-testid="kit-diff-apply"]');
  await expect(apply, 'окно DiffPreview').toBeVisible({ timeout: 15_000 });
  await expect(apply, 'без логина кнопка заперта').toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-testid="kit-diff-confirm"]').fill(login!);
  await apply.click();
  await expect.poll(async () => numberIn(await waiting(page).innerText()), '«ждут решения» убыл на одну строку').toBe(before - 1);

  const undo = page.locator('[data-testid="kit-batch-undo"]');
  await expect(undo, 'отмена правила (BatchUndo)').toBeVisible({ timeout: 15_000 });
  await undo.click();
  await expect.poll(async () => numberIn(await waiting(page).innerText()), 'отмена вернула счёт').toBe(before);
  const after = await report(page);
  expect(after?.waiting, 'на сервере счёт тоже прежний').toBe(before);
});

test('MA5 «Перепроверить» и «Пробный перенос» — честное «запуск с сервера пока не подключён», а не молчание', async ({ page }) => {
  await asRole(page, 'superadmin');
  const recheck = page.locator('[data-testid="adm-mig-run-recheck"]');
  await openStand(page, SECTION, recheck);
  const note = page.locator('[data-testid="adm-mig-run-note"]');
  for (const id of ['adm-mig-run-recheck', 'adm-mig-run-trial']) {
    const btn = page.locator(`[data-testid="${id}"]`);
    await expect(btn, `кнопка ${id}`).toBeVisible({ timeout: 30_000 });
    await btn.click();
    await expect(note, `${id}: ответ словами`).toBeVisible({ timeout: 15_000 });
    await expect(note, `${id}: запуск не подключён — так и сказано`).toContainText(/пока не подключён|not connected yet/);
  }
});

test('MA6 Телефон 390×844: раздел не шире экрана', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asRole(page, 'superadmin');
  await openStand(page, SECTION, section(page));
  await expect(section(page), 'раздел показан').toBeVisible({ timeout: 30_000 });
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth,
    sec: Math.ceil(document.querySelector('[data-testid="adm-migration"]')!.getBoundingClientRect().right),
  }));
  expect(w.doc, `страница не прокручивается вбок (scrollWidth ${w.doc} при ширине ${w.view})`).toBeLessThanOrEqual(w.view + 1);
  expect(w.sec, 'правый край раздела в пределах экрана').toBeLessThanOrEqual(390 + 1);
});

// MA7 — шаг «З. Задачи без спринта» мастера переноса (установщик lore-migrate ui, SPRINT_LORE_MODEL_DOCS_TIDY/MIG-01).
// Владелица 19.11.2026: «без спринта реконструировать ребро в визарде предложить владельцу привязать».
// Мастер — отдельный сервер установщика: адрес LORE_MIGRATE_UI_URL. Ответ пишется в файл решений мастера, поэтому
// запись — только при LORE_MIGRATE_UI_WRITE=1 (прогон на копии с одноразовым файлом решений); иначе только чтение.
test('MA7 Мастер, шаг «З»: у каждой задачи без спринта — предложение с основанием; ответ уменьшает «ждут решения»', async ({ page }) => {
  const ui = process.env.LORE_MIGRATE_UI_URL?.trim();
  test.skip(!ui, 'LORE_MIGRATE_UI_URL не задан — мастер переноса не запущен, шаг «З» не проверялся');
  await page.goto(ui!.replace(/\/+$/, '') + '/#step-o');
  const box = page.locator('#os');
  const rows = box.locator('tr[data-os-row]');
  // ошибка чтения — сам блок шага в состоянии stop (а не плашка «ждут решения» внутри него)
  const failed = page.locator('#os.state.stop');
  await expect(rows.first().or(failed), 'строки шага или честная ошибка чтения').toBeVisible({ timeout: 60_000 });
  expect(await failed.count(), `шаг прочитал задачи: ${await textOf(failed)}`).toBe(0);
  const n = await rows.count();
  expect(n, 'задачи без спринта есть (перепись источника: 12)').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const r = rows.nth(i);
    await expect(r.locator('.chip'), 'вид предложения').toHaveText(/точно|похоже, подтвердите|возможен дубль|куда\?/);
    expect((await textOf(r.locator('.why'))).length, 'основание не пустое').toBeGreaterThan(10);
  }
  const state = box.locator('[data-testid="os-state"]');
  await expect(state, 'состояние «ждут решения» показано, не молча').toBeVisible();
  if (process.env.LORE_MIGRATE_UI_WRITE?.trim() !== '1') return;
  const before = numberIn(await textOf(state));
  // строка «точно», на которую ещё нет ответа (в списке выбрано «— не решено —»)
  const exact = rows.filter({ has: page.locator('.chip', { hasText: 'точно' }) });
  let target = exact.first(), found = false;
  for (let i = 0; i < (await exact.count()); i++) if ((await exact.nth(i).locator('select[data-os]').inputValue()) === '') { target = exact.nth(i); found = true; break; }
  test.skip(!found || !Number.isFinite(before), 'строк «точно» без ответа нет — записывать нечего');
  const sel = target.locator('select[data-os]');
  const proposed = (await sel.locator('option').filter({ hasText: 'предложено' }).first().getAttribute('value'))!;
  if (!(await page.locator('#by').count()) || !(await page.locator('#by').inputValue())) await page.evaluate(() => { let b = document.getElementById('by') as HTMLInputElement | null; if (!b) { b = document.createElement('input'); b.id = 'by'; b.type = 'hidden'; document.body.appendChild(b); } b.value = 'playwright-ma7'; });
  await sel.selectOption(proposed);
  await expect.poll(async () => numberIn(await textOf(box.locator('[data-testid="os-state"]'))) || 0, { timeout: 30_000, message: '«ждут решения» уменьшилось на 1' }).toBe(before - 1);
});
