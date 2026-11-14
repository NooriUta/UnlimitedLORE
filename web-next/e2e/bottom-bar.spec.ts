// MP2-15-BOTTOM-BAR (замечание владелицы 14.11.2026: «проверьте размер нижнего статус бара в
// мобильной верстке и скрытие нижнего меню телефона»). Нижний бар v2 на телефоне — док модулей
// `.sk-shell__dock` (position: fixed). Замер на 360×800 и 412×915: высота дока, цели ≥ 44 px,
// наезд на содержимое (последняя строка списка видна над доком), и поведение при «прячущейся»
// адресной/нижней панели браузера — окно меняет высоту, док обязан остаться прижатым к низу.
import { expect, test, type Page } from '@playwright/test';

const ROWS = Array.from({ length: 30 }, (_, i) => ({
  sprint_id: `SPRINT_BAR_${i}`, name: `Спринт ${i}`, status_raw: '📋 PLANNED', valid_from: '2026-11-09T10:00:00Z',
}));

async function stub(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const body = p.includes('/count') ? { count: ROWS.length, total: ROWS.length }
      : p.includes('/slice/') ? { rows: ROWS, total: ROWS.length } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const measure = (page: Page) => page.evaluate(() => {
  const dock = document.querySelector('.sk-shell__dock') as HTMLElement | null;
  const r = dock?.getBoundingClientRect();
  const items = dock ? [...dock.querySelectorAll('a, button')].map(e => (e as HTMLElement).getBoundingClientRect()) : [];
  const body = document.querySelector('.sk-shell__body') as HTMLElement | null;
  const shell = document.querySelector('.sk-shell') as HTMLElement | null;
  return {
    vh: innerHeight, dockTop: r ? Math.round(r.top) : null, dockBottom: r ? Math.round(r.bottom) : null, dockH: r ? Math.round(r.height) : null,
    minTarget: items.length ? Math.round(Math.min(...items.map(i => Math.min(i.height, i.width)))) : null,
    bodyPadBottom: body ? getComputedStyle(body).paddingBottom : null,
    shellMinH: shell ? getComputedStyle(shell).minHeight : null,
    docH: document.documentElement.scrollHeight,
  };
});

for (const [w, h] of [[360, 800], [412, 915]] as const) {
  test(`нижний бар на ${w}×${h}: прижат к низу, цели ≥ 44, содержимое не под ним, высота окна меняется — бар на месте`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone-412', 'одна телефонная проекция; размер задаём сами');
    await page.setViewportSize({ width: w, height: h });
    await stub(page);
    await page.goto('/?sec=sprint');
    await expect(page.locator('.sk-shell__dock')).toBeVisible({ timeout: 20_000 });
    const a = await measure(page);
    console.log(`MP2-15 ${w}x${h}`, JSON.stringify(a));
    expect(a.dockBottom, 'док прижат к низу окна').toBe(a.vh);
    expect(a.minTarget ?? 0, 'цели дока ≥ 44 px').toBeGreaterThanOrEqual(44);
    // Прокрутка к концу: последняя строка списка — над доком, не под ним.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const lastBottom = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-record-id], .sk-list__row, tr');
      const last = rows[rows.length - 1] as HTMLElement | undefined;
      return last ? Math.round(last.getBoundingClientRect().bottom) : null;
    });
    const b = await measure(page);
    expect(lastBottom ?? 0, 'последняя строка над доком').toBeLessThanOrEqual((b.dockTop ?? 0) + 1);
    // «Прячется» панель браузера: окно выше на 56 px — док по-прежнему у нижнего края.
    await page.setViewportSize({ width: w, height: h + 56 });
    await page.waitForTimeout(200);
    const c = await measure(page);
    console.log(`MP2-15 ${w}x${h + 56}`, JSON.stringify(c));
    expect(c.dockBottom, 'после смены высоты окна док у низа').toBe(c.vh);
  });
}
