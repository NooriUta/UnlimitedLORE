// SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET (владелица 19–20.11.2026: «при открытии паспортов не
// должна вся страница перегружаться и сбрасываться левая часть — только паспорт выбранного элемента»).
//
// Настоящий браузер, подставная сеть, раздел «Задачи». Прокрутить список, поставить фильтр, открыть
// 2–3 записи подряд: прокрутка, фильтр и узел списка на месте, список заново не грузится; «назад» и
// «вперёд» браузера двигают паспорт. Телефон: паспорт поверх списка, закрыли — список там же.
//
//   cd web-next && npx playwright test e2e/list-no-reset.spec.ts
// Снимки — в K4_SHOTS (если задан), иначе e2e/.results.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.K4_SHOTS ?? 'e2e/.results';
const N = 80;
const rows = Array.from({ length: N }, (_, i) => ({
  task_uid: `S1/T-${i + 1}`, task_id: `T-${i + 1}`,
  // 60 из 80 — «альфа»: после фильтра список всё ещё длинный и крутится
  title: `${i % 4 === 3 ? 'бета' : 'альфа'} задача ${i + 1}`,
  status_raw: '🔄 IN PROGRESS', sprint_id: 'S1',
}));

async function mockNet(page: Page) {
  const listCalls: string[] = [];
  await page.route('**/lore/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/slice/open_tasks')) {
      listCalls.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) });
    }
    if (url.pathname.includes('/slice/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
  });
  return listCalls;
}

/** Метка на узле списка: пересозданный список её не несёт. */
const markList = (page: Page) => page.evaluate(() => { (document.querySelector('.sk-list') as HTMLElement & { __k4?: number }).__k4 = 1; });
const sameList = (page: Page) => page.evaluate(() => (document.querySelector('.sk-list') as HTMLElement & { __k4?: number } | null)?.__k4 === 1);
const backdropTop = (page: Page) => page.evaluate(() => document.querySelector('.sk-dock__backdrop')?.scrollTop ?? -1);
const openParam = (page: Page) => new URL(page.url()).searchParams.get('open');

/** Видимая в окне строка списка с номером не меньше from — по ней и щёлкаем. */
async function visibleTitle(page: Page, from: number): Promise<string> {
  return page.evaluate(min => {
    const scope = document.querySelector('.sk-dock__backdrop') ?? document.documentElement;
    const box = scope === document.documentElement ? { top: 0, bottom: innerHeight } : scope.getBoundingClientRect();
    const btns = [...document.querySelectorAll<HTMLElement>('.sk-list .sk-list__title--btn')];
    const hit = btns.find(b => {
      const r = b.getBoundingClientRect();
      const n = Number(/(\d+)$/.exec(b.textContent ?? '')?.[1] ?? 0);
      return n >= min && r.top > box.top + 40 && r.bottom < box.bottom - 40;
    });
    return hit?.textContent ?? '';
  }, from);
}

test('десктоп 1280: прокрутка, фильтр и список на месте при открытии 3 записей; назад/вперёд', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'десктопная проекция');
  const listCalls = await mockNet(page);
  await page.goto('/?sec=task');
  await expect(page.locator('.sk-list .sk-list__title--btn').first()).toBeVisible({ timeout: 20_000 });
  // фильтр
  await page.locator('.sk-list__search').fill('альфа');
  await expect(page.locator('.sk-list__title--btn', { hasText: 'бета' })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get('lt')).toBe('альфа');
  await markList(page);
  // прокрутка: без паспорта крутится страница
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  const t1 = await visibleTitle(page, 10);
  expect(t1).not.toBe('');
  const yBefore = await page.locator('.sk-list__title--btn', { hasText: new RegExp(`^${t1}$`) }).evaluate(e => e.getBoundingClientRect().top);
  await page.screenshot({ path: `${SHOTS}/desktop-0-scrolled.png` });
  const loaded = listCalls.length;

  await page.locator('.sk-list__title--btn', { hasText: new RegExp(`^${t1}$`) }).click();
  await expect(page.locator('[data-testid="kit-rec-dock"]')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop-1-open-first.png` });
  // строка, по которой щёлкнули, видна в списке под паспортом — прокрутка перенесена
  const scrolled1 = await backdropTop(page);
  expect(scrolled1).toBeGreaterThan(200);
  const row1 = page.locator('.sk-dock__backdrop .sk-list__title--btn', { hasText: new RegExp(`^${t1}$`) });
  await expect(row1).toBeInViewport();
  const yAfter = await row1.evaluate(e => e.getBoundingClientRect().top);
  expect(Math.abs(yAfter - yBefore)).toBeLessThan(220);
  expect(await sameList(page)).toBe(true);

  const opened: string[] = [openParam(page)!];
  let lastN = Number(/(\d+)$/.exec(t1)?.[1] ?? 0);
  for (let k = 2; k <= 3; k++) {
    const before = await backdropTop(page);
    const tk = await visibleTitle(page, lastN + 2);
    lastN = Number(/(\d+)$/.exec(tk)?.[1] ?? 0);
    expect(tk).not.toBe('');
    await page.locator('.sk-dock__backdrop .sk-list__title--btn', { hasText: new RegExp(`^${tk}$`) }).click();
    await expect.poll(() => openParam(page)).not.toBe(opened[opened.length - 1]);
    opened.push(openParam(page)!);
    expect(Math.abs((await backdropTop(page)) - before), `запись ${k}`).toBeLessThan(2);
    expect(await sameList(page), `запись ${k}`).toBe(true);
    expect(new URL(page.url()).searchParams.get('lt'), `запись ${k}`).toBe('альфа');
    await expect(page.locator('.sk-list__search')).toHaveValue('альфа');
  }
  await page.screenshot({ path: `${SHOTS}/desktop-2-open-third.png` });
  expect(listCalls.length - loaded, 'список заново не грузили').toBe(0);

  // «назад»: листание — заменой (D-24), поэтому шаг назад закрывает паспорт; «вперёд» — открывает последнюю
  const scrolledBeforeBack = await backdropTop(page);
  await page.goBack();
  await expect(page.locator('[data-testid="kit-rec-dock"]')).toHaveCount(0);
  expect(await sameList(page)).toBe(true);
  // закрыли — список снова крутит страница, и на том же месте
  await expect(page.locator('.sk-list__title--btn', { hasText: new RegExp(`^${t1}$`) })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/desktop-3-back-closed.png` });
  await page.goForward();
  await expect(page.locator('[data-testid="kit-rec-dock"]')).toBeVisible();
  expect(openParam(page)).toBe(opened[opened.length - 1]);
  expect(await sameList(page)).toBe(true);
  expect(Math.abs((await backdropTop(page)) - scrolledBeforeBack)).toBeLessThan(40);
  expect(new URL(page.url()).searchParams.get('lt')).toBe('альфа');
  expect(listCalls.length - loaded, 'и после назад/вперёд — тоже').toBe(0);
});

test('телефон 390: паспорт поверх списка; закрыли — список там же, фильтр на месте', async ({ page }, info) => {
  test.skip(info.project.name !== 'list-390', 'проекция телефона 390');
  const listCalls = await mockNet(page);
  await page.goto('/?sec=task&lt=%D0%B0%D0%BB%D1%8C%D1%84%D0%B0');
  await expect(page.locator('.sk-list .sk-list__title--btn').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sk-list__title--btn', { hasText: 'бета' })).toHaveCount(0);
  await markList(page);
  await page.evaluate(() => window.scrollTo(0, 4000));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(3000);
  const loaded = listCalls.length;
  let prevN = 0;
  for (const from of [20, 30, 40]) {
    const y0 = await page.evaluate(() => scrollY);
    const t = await visibleTitle(page, prevN + 1);
    prevN = Number(/(\d+)$/.exec(t)?.[1] ?? 0);
    expect(t).not.toBe('');
    if (from === 20) await page.screenshot({ path: `${SHOTS}/phone-0-scrolled.png` });
    await page.locator('.sk-list__title--btn', { hasText: new RegExp(`^${t}$`) }).click();
    await expect(page.locator('[data-testid="kit-rec-dock"]')).toBeVisible();
    // паспорт поверх: списка под ним не видно
    await expect(page.locator('.sk-dock__backdrop')).toBeHidden();
    if (from === 20) await page.screenshot({ path: `${SHOTS}/phone-1-passport.png` });
    // закрыть — «назад» браузера (открытие было шагом истории)
    await page.goBack();
    await expect(page.locator('[data-testid="kit-rec-dock"]')).toHaveCount(0);
    if (from === 20) await page.screenshot({ path: `${SHOTS}/phone-2-closed.png` });
    await expect.poll(() => page.evaluate(() => scrollY), `запись с ${from}`).toBeGreaterThan(y0 - 40);
    expect(Math.abs((await page.evaluate(() => scrollY)) - y0), `запись с ${from}`).toBeLessThan(40);
    await expect(page.locator('.sk-list__title--btn', { hasText: new RegExp(`^${t}$`) })).toBeInViewport();
    expect(await sameList(page), `запись с ${from}`).toBe(true);
    expect(new URL(page.url()).searchParams.get('lt')).toBe('альфа');
  }
  expect(listCalls.length - loaded, 'список заново не грузили').toBe(0);
  // «вперёд» — паспорт последней записи снова открыт
  await page.goForward();
  await expect(page.locator('[data-testid="kit-rec-dock"]')).toBeVisible();
});
