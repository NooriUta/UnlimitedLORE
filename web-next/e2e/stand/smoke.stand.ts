// Смоук LORE v2 на стенде после выкатки в preprod (SPRINT_UXR_S11_TEST_OPT/E2E-STAND).
//
// Повод — владелица 09.11: «список говорит, что задач нет, а они есть» нашла она сама
// на стенде, а не тест (регресс — откат #1005). Сценарии читают живые данные стенда и
// ничего не пишут. Первое слово заголовка теста — код сценария в отчёте (S0…S4).
//
// Запуск и вход — playwright.stand.config.ts и README рядом. Без входа каждый сценарий
// «не выполнен» с причиной; это НЕ зелёный.
import { expect, test } from '@playwright/test';
import { attr, openStand, pickSprintWithTasks, requireStand, shot } from './stand.ts';

test.beforeEach(() => requireStand());
test.afterEach(async ({ page }, info) => shot(page, info));

test('S0 Сборка стенда: /lore/version отвечает под сохранённым входом', async ({ page }, info) => {
  // Цель — строки ленты, а не body: body виден и на странице входа, и истёкший вход прошёл бы мимо.
  await openStand(page, '/news', page.locator('[data-testid^="news-row-"]'));
  const ver = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find(k => k.includes('oidc.user:'));
    const token = key ? (JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string }).access_token : undefined;
    const res = await fetch('/lore/version', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    const bundle = [...document.querySelectorAll<HTMLScriptElement>('script[src]')].map(s => s.src).find(s => /assets\/index-/.test(s)) ?? null;
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null, bundle };
  });
  expect(ver.status, '/lore/version под входом').toBe(200);
  const body = (ver.body ?? {}) as Record<string, unknown>;
  const version = { release: typeof body.release === 'string' && body.release ? body.release : null, commit: typeof body.commit === 'string' ? body.commit : '' };
  await info.attach('stand-version', { body: JSON.stringify(version), contentType: 'application/json' });
  expect(version.commit, 'в ответе /lore/version есть коммит сборки').not.toBe('');
});

test('S1 Спринты: раскрыть строку — задачи есть (регресс «задач нет», откат #1005)', async ({ page }) => {
  await openStand(page, '/?sec=sprint', page.locator('[data-record-id]'));
  await expect(page.locator('[data-record-id]').first(), 'список спринтов загрузился').toBeVisible({ timeout: 30_000 });
  const sprint = await pickSprintWithTasks(page);
  expect(sprint, 'в списке есть спринт с задачами (x/y, y > 0) и кнопкой раскрытия').not.toBeNull();
  const { id, done, total } = sprint!;
  await page.locator(`[data-record-id=${attr(id)}] .sk-list__xbtn`).first().click();
  // Два вида раскрытия: вложенная таблица задач (PU-23) или строки-дети той же таблицы.
  const kids = page.locator(`[data-expand-of=${attr(id)}] [data-nested] [data-record-id], [data-child-of=${attr(id)}]`);
  const empty = page.locator(`[data-expand-of=${attr(id)}] .sk-empty, [data-expand-of=${attr(id)}] [role="alert"]`);
  await expect(kids.or(empty).first()).toBeVisible({ timeout: 30_000 });
  expect(await empty.count(), `${id}: список говорит «${done}/${total}», а раскрытие пустое или с ошибкой`).toBe(0);
  expect(await kids.count(), `${id}: в раскрытии есть задачи`).toBeGreaterThan(0);
});

test('S2 Паспорт спринта: вкладка «Задачи» не пуста', async ({ page }) => {
  await openStand(page, '/?sec=sprint', page.locator('[data-record-id]'));
  const sprint = await pickSprintWithTasks(page);
  expect(sprint, 'в списке есть спринт с задачами').not.toBeNull();
  const { id, total } = sprint!;
  // Табличный вид вкладки (tview=table): у строки задачи стабильная метка data-task.
  const rows = page.locator('tr[data-task]');
  await openStand(page, `/?sec=sprint&open=${encodeURIComponent(id)}&tab=tasks&tview=table`, rows);
  await expect(rows.first(), `${id}: в паспорте есть строки задач (список говорит ${total})`).toBeVisible({ timeout: 30_000 });
});

test('S3 Новости: лента открывается и показывает строки', async ({ page }) => {
  const rows = page.locator('[data-testid^="news-row-"]');
  await openStand(page, '/news', rows, 45_000);
  // 16.11.2026: два прогона подряд — «Test timeout» без причины. Под владелицей лента за 6 с
  // (340 строк), под test-sa — нет. Чем стала страница (пусто по скоупу, ошибка, вечная
  // загрузка) — в текст падения, иначе по журналу CI причину не установить.
  if (!(await rows.first().isVisible().catch(() => false))) {
    const seen = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
    expect(await rows.count(), `в ленте нет строк за 45 с; на странице: «${seen}»`).toBeGreaterThan(0);
  }
});

test('S4 Админка «Агенты»: в колонке harness есть значения', async ({ page }) => {
  const table = page.locator('[data-testid="adm-agents"]');
  const denied = page.locator('[data-testid="adm-home-403"]');
  await openStand(page, '/?mod=admin&sec=adm-agents', table.or(denied));
  // «Нет прав» — не «пусто» и не «сломано»: у сохранённого входа нет админки, проверить нечем.
  test.skip(await denied.first().isVisible().catch(() => false), 'у сохранённого входа нет прав админа — «Агенты» не проверены');
  await expect(table, 'таблица агентов показана').toBeVisible({ timeout: 30_000 });
  const stat = await table.evaluate(t => {
    const rows = [...t.querySelectorAll<HTMLTableRowElement>('tbody > tr[data-testid^="adm-agent-"]')]
      .filter(r => !r.getAttribute('data-testid')!.startsWith('adm-agent-row-'));
    const values = rows.map(r => {
      const cell = r.querySelector('td');
      if (!cell) return '';
      const sel = cell.querySelector('select');
      if (sel) return sel.value;
      const c = cell.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.adm-missing, .adm-err').forEach(n => n.remove());
      return (c.textContent ?? '').trim();
    });
    return { agents: rows.length, withHarness: values.filter(Boolean).length };
  });
  expect(stat.agents, 'в таблице есть агенты').toBeGreaterThan(0);
  expect(stat.withHarness, `harness заполнен хотя бы у одного из ${stat.agents} агентов`).toBeGreaterThan(0);
});
