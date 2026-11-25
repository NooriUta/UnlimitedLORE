// SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED — лента паспортов в настоящем браузере.
//
// Прототип docs/prototypes/bp-01-passport-feed.html принят владельцем 25.11.2026. Проверяем то,
// чего jsdom не видит: прокрутка догружает паспорта по 4 до 12, дальше — кнопка; на 1280, 412 и
// 360 нет горизонтального переполнения (тело паспорта с таблицей и кодом); в консоли нет ошибок.
// Сеть подставная, раздел «Задачи».
//
//   cd web-next && npx playwright test e2e/passport-feed.spec.ts
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.BP01_SHOTS ?? 'e2e/.results';
const N = 20;
const rows = Array.from({ length: N }, (_, i) => ({
  task_uid: `S1/T-${i + 1}`, task_id: `T-${i + 1}`, title: `Задача ленты ${i + 1}`,
  status_raw: '🔄 IN PROGRESS', sprint_id: 'S1',
  changed_at: new Date(Date.UTC(2026, 10, 25, 12) - i * 3_600_000).toISOString(),
}));
const LONG = 'очень_длинный_идентификатор_без_пробелов_который_не_должен_ломать_телефон_'.repeat(3);
const note = (n: number) => [
  `Контекст задачи ${n}: лента паспортов показывает запись целиком.`,
  '| колонка один | колонка два | колонка три | колонка четыре |\n|---|---|---|---|\n| значение | значение | значение | значение |',
  '```\n' + LONG + '\n```',
  `Последний абзац задачи ${n} — виден без «Ещё».`,
].join('\n\n');
const record = (id: string) => {
  const n = Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return {
    contract: 'lore.record/1',
    record: { id, type: 'task', title: `Задача ленты ${n}`, status: 'active' },
    schema: { type: 'task', fields: [{ key: 'note_md', group: 'body', kind: 'md', editable: false }], relations: [] },
    values: { note_md: note(n) },
    links: [{ rel: 'JUSTIFIED_BY', dir: 'out', id: 'ADR-LORE-051', type: 'adr', title: 'Новости v2 на мобильном' }],
    perms: {}, facts: {}, meta: { facade: 'server', data_state: [] },
  };
};

async function mockNet(page: Page) {
  const recordCalls: string[] = [];
  const historyCalls: string[] = [];
  await page.route('**/lore/**', async route => {
    const url = new URL(route.request().url());
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/slice/open_tasks')) return ok({ rows });
    if (url.pathname.includes('/slice/')) return ok({ rows: [] });
    if (url.pathname.startsWith('/lore/record/task/') && !url.pathname.endsWith('/_new')) {
      const id = decodeURIComponent(url.pathname.slice('/lore/record/task/'.length));
      recordCalls.push(id);
      return ok(record(id));
    }
    if (url.pathname === '/lore/history') { historyCalls.push(url.search); return ok({ rows: [] }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
  });
  return { recordCalls, historyCalls };
}

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const passports = (page: Page) => page.locator('.sk-feed [data-feed-passport]');

test('BP-01: полные паспорта — догрузка до 12, дальше кнопкой; без переполнения; без ошибок консоли', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280' && info.project.name !== 'phone-412', 'проекции 1280 и 412');
  const errors: string[] = [];
  // «Failed to load resource» — ответы подставной сети (404 на чужие пути) и шрифты вне allow-list vite
  // в worktree (junction node_modules); это не ошибки кода. Ошибки JS и прочие ошибки консоли — считаем.
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const net = await mockNet(page);
  await page.goto('/?sec=task&lv=feed&lfm=full');
  await expect(passports(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Полные паспорта' })).toHaveAttribute('aria-pressed', 'true');
  // Тело целиком: последний абзац виден без «Ещё».
  await expect(page.getByText('Последний абзац задачи 1 — виден без «Ещё».')).toBeVisible();
  // Прокрутка догружает порциями по 4 — до 12, не дальше.
  for (let k = 0; k < 8; k++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  await expect(passports(page)).toHaveCount(12);
  await expect(page.getByRole('button', { name: 'Показать ещё 4' })).toBeVisible();
  await expect(page.locator('.sk-feed__tail')).toContainText('показано 12 из 20');
  // Паспорт грузится только у видимых записей, история — ни у одной (не раскрывали).
  expect(new Set(net.recordCalls).size).toBe(12);
  expect(net.historyCalls).toEqual([]);
  expect(new URL(page.url()).searchParams.get('lfn')).toBe('12');
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/bp01-${info.project.name}-full.png`, fullPage: false });
  await page.getByRole('button', { name: 'Показать ещё 4' }).click();
  await expect(passports(page)).toHaveCount(16);

  // История — по раскрытию: один запрос.
  await page.locator('[data-zone="history"] summary').first().click();
  await expect.poll(() => net.historyCalls.length).toBe(1);

  if (info.project.name === 'phone-412') {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/bp01-phone-360-full.png`, fullPage: false });
  }
  expect(errors).toEqual([]);
});

test('BP-01: «Контекст» — карточки, «Открыть паспорт целиком» раскрывает в ленте', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280' && info.project.name !== 'phone-412', 'проекции 1280 и 412');
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  const net = await mockNet(page);
  await page.goto('/?sec=task&lv=feed');
  await expect(page.locator('.sk-feed__item').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Контекст' })).toHaveAttribute('aria-pressed', 'true');
  expect(net.recordCalls).toEqual([]);
  await page.getByRole('button', { name: 'Открыть паспорт целиком' }).nth(1).click();
  await expect(passports(page)).toHaveCount(1);
  // dev-режим React (StrictMode) повторяет эффект — считаем РАЗНЫЕ записи.
  expect([...new Set(net.recordCalls)]).toEqual(['S1/T-2']);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/bp01-${info.project.name}-context.png`, fullPage: false });
  // Переключатель пишет режим в адрес.
  await page.getByRole('button', { name: 'Полные паспорта' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('lfm')).toBe('full');
  expect(errors).toEqual([]);
});
