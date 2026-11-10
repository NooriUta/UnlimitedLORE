// Список на телефоне НЕ шире экрана (SPRINT_UXR_S9_SCALE_OPT/S9-12, вторая половина).
//
// Замер соседней сессии на проде v1.17.8 при экране 393 px: страница имела
// scrollWidth 730, «+3 условия» стояло на x=491–566 — за правым краем, а с ним
// уезжали «Группировка» и «Порядок». Первую половину (полосу условий) я закрыл
// своей полосой прокрутки у чипов; осталась таблица на десять колонок.
//
// ПРИЧИНА, а не симптом: `.sk-list__scroll` имел `overflow-x: auto`, но не имел
// `min-width: 0`. У элемента внутри flex/grid минимальная ширина равна
// СОДЕРЖИМОМУ, пока не сказано иначе, поэтому собственная полоса прокрутки у
// бокса не появлялась — вместо неё раздвигалась страница. Тот же класс дефекта,
// что в полосе условий, и видно его только в настоящем браузере: jsdom
// раскладку не считает.
//
// Данные — подставная сеть (`page.route`): экран списка без API не рисует
// таблицу, а проверка раскладки по пустому экрану была бы ложно-зелёной.
// Поэтому первый тест — положительный контроль: строки и управление на месте.
import { expect, test, type Page } from '@playwright/test';

const ROWS = Array.from({ length: 14 }, (_, i) => ({
  sprint_id: `SPRINT_UXR_S${i}_V2_PARITY_LONG_CODE`,
  name: `Спринт ${i}: длинное название, как у настоящих спринтов LORE`,
  status_raw: i % 3 === 0 ? '🔄 IN PROGRESS' : '📋 PLANNED',
  git_projects: ['AIDA/UnlimitedLORE', 'AIDA/miniLORE'],
  components: ['lore-frontend', 'lore-backend'],
  release_ids: ['lore-v1.17.8'],
  milestone_ids: ['M-UXR-PARITY'],
  priority: (i % 5) + 1,
  planned_start_date: '2026-11-01',
  planned_end_date: '2026-11-30',
  valid_from: '2026-11-09T10:00:00Z',
}));

/** Сеть LORE, отвечающая срезом спринтов на всё, что просит экран. */
async function stub(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const body =
      p.includes('/count') ? { count: ROWS.length, total: ROWS.length }
      : p.includes('/slice/') ? { rows: ROWS, total: ROWS.length }
      : p.includes('/me/views') ? { views: [] }
      : p.includes('/me/settings') ? { settings: {} }
      : p.includes('/me/recent') ? { recent: [] }
      : p.includes('/me/favorites') ? { favorites: [] }
      : p.includes('/me/drafts') ? { drafts: [] }
      : p.includes('/me/memory') ? { memories: [] }
      : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function openSprints(page: Page) {
  await stub(page);
  await page.goto('/?sec=sprint');
  await expect(page.locator('.sk-list__table tbody tr').first()).toBeVisible({ timeout: 20_000 });
}

test('положительный контроль: список спринтов нарисован', async ({ page }) => {
  await openSprints(page);
  const n = await page.locator('.sk-list__table tbody tr').count();
  expect(n, 'строк в таблице').toBeGreaterThan(4);
});

// Мерить НЕ по window.innerWidth: в мобильной эмуляции Chrome раздувает слой
// раскладки до ширины содержимого, и при экране 412 px innerWidth был 692 —
// проверка «692 <= 692» прошла бы при живом дефекте. Эталон один: ширина окна,
// которую задал Playwright.
test('страница не шире экрана', async ({ page }) => {
  await openSprints(page);
  const w = page.viewportSize()!.width;
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    bw: document.body.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(r.sw, `документ ${r.sw} px при экране ${w} px`).toBeLessThanOrEqual(w);
  expect(r.bw, `body ${r.bw} px при экране ${w} px`).toBeLessThanOrEqual(w);
  expect(r.iw, `слой раскладки ${r.iw} px при экране ${w} px — содержимое раздвинуло страницу`).toBeLessThanOrEqual(w);
});

test('таблица прокручивается сама, а не распирает экран', async ({ page }) => {
  await openSprints(page);
  const box = await page.locator('.sk-list__scroll').boundingBox();
  expect(box, 'бокс таблицы').not.toBeNull();
  const w = page.viewportSize()!.width;
  expect(Math.round(box!.x + box!.width), `правый край таблицы при окне ${w} px`).toBeLessThanOrEqual(w);
  // У самого бокса прокрутка есть — иначе колонки просто обрезаны и недоступны.
  const own = await page.locator('.sk-list__scroll').evaluate(el => el.scrollWidth > el.clientWidth);
  expect(own, 'у таблицы своя горизонтальная прокрутка').toBe(true);
});

test('управление списком видно целиком: «Группировка», «Порядок», условия', async ({ page }) => {
  await openSprints(page);
  const w = page.viewportSize()!.width;
  const over = await page.evaluate(() => {
    const sel = ['.sk-list__controls', '.sk-list__quick', '.sk-list__desc', '.sk-list__chipmore', '.sk-shead'];
    const out: { sel: string; right: number }[] = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll<HTMLElement>(s)) {
        if (!el.offsetParent) continue;
        const b = el.getBoundingClientRect();
        if (b.right > window.innerWidth + 1) out.push({ sel: s, right: Math.round(b.right) });
      }
    }
    return out;
  });
  expect(over, `за правым краем (${w} px): ${over.map(o => `${o.sel} до ${o.right}`).join('; ')}`).toEqual([]);
});
