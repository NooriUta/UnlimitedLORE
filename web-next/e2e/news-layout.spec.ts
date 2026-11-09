// «Новости» v2 в настоящем браузере (SPRINT_UXR_S7A_NEWS/S7A-12): лента —
// первая на любой ширине, без переполнения, и ни одна функция паритета
// (SPEC-LORE-UXR-NEWS-PARITY, 30 пунктов) и ни один разрез S7A-02/03 не
// потерян — каждый виден сразу или после ОДНОГО действия: открыть панель
// «Фильтры» или раскрыть строку метрик.
//
// Экран работает на фикстуре контракта (web-next/src/news/source.ts,
// NEWS_LIVE = false) — числа здесь не проверяются, только раскладка.
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/news');
  await expect(page.locator('[data-testid^="news-row-"]').first()).toBeVisible();
}

test('нет горизонтальной прокрутки страницы', async ({ page }) => {
  await open(page);
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  expect(sw, `ширина документа ${sw} > окна ${w}`).toBeLessThanOrEqual(w);
});

test('первая карточка ленты видна без прокрутки', async ({ page }) => {
  await open(page);
  const box = await page.locator('[data-testid^="news-row-"]').first().boundingBox();
  const h = page.viewportSize()!.height;
  expect(box, 'первая строка ленты не отрисована').not.toBeNull();
  expect(box!.y + box!.height, `низ первой карточки ${Math.round(box!.y + box!.height)} px при высоте окна ${h}`).toBeLessThanOrEqual(h);
});

test('панель «Фильтры» закрывается Esc и не даёт переполнения', async ({ page }) => {
  await open(page);
  await page.getByTestId('news-filters-btn').click();
  const sheet = page.getByTestId('news-sheet');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

// how: none — видно на первом экране или прокруткой ленты; filters — после
// нажатия «Фильтры»; metrics — после раскрытия строки метрик; valid — после ⚠.
type How = 'none' | 'filters' | 'metrics' | 'valid';
const ACTION: Record<Exclude<How, 'none'>, string> = {
  filters: 'news-filters-btn',
  metrics: 'news-strip-toggle',
  valid: 'news-valid-btn',
};

const PARITY: Array<[id: string, how: How, selector: string]> = [
  ['п.1 событие с иконкой', 'none', '[data-kind-tag]'],
  ['п.2 тип записи с иконкой раздела', 'none', '[data-testid^="news-type-chip-"]'],
  ['п.3 день сворачивается', 'none', '[data-testid^="news-day-"] button[aria-expanded]'],
  ['п.4 группировка внутри дня', 'filters', '[data-testid="news-group-opt-type"]'],
  ['п.5 итог дня', 'none', '[data-testid="news-cube-total"]'],
  ['п.6 разбивка дня по событиям', 'none', '[data-testid^="news-cube-kind-"]'],
  ['п.6 разбивка дня по типам', 'none', '[data-testid="news-day-types"]'],
  ['п.7 сгорание дня', 'none', '[data-testid="news-cube-burn"]'],
  ['п.8 Δ уникальных', 'none', '[data-testid="news-cube-delta"]'],
  ['п.9 с прошлого раза', 'none', '[data-testid="news-since"]'],
  ['п.9 прочитано', 'none', '[data-testid="news-mark-read"]'],
  ['п.9 черта «прочитано до сюда»', 'none', '[data-testid="news-read-line"]'],
  ['п.10 свёртка ×N', 'none', '[data-testid="news-mult"]'],
  ['п.11 время строки', 'none', '[data-testid="news-time-local"]'],
  ['п.11/17 пометка «будущее»', 'none', '[data-testid="news-future"]'],
  ['п.12 переход к записи', 'none', 'a.sk-news__link[href]'],
  ['п.14/15 период', 'none', '[data-testid="news-period"] [role="radio"]'],
  ['п.18 порядок', 'filters', '[data-testid="news-order"] [role="radio"][aria-checked="true"]'],
  ['п.19/20 события сервера', 'none', '[data-kind-tag="created"], [data-kind-tag="changed"], [data-kind-tag="version"]'],
  ['п.21 мультипринадлежность ×N', 'none', '[data-testid="news-groups-n"]'],
  ['п.21/22 фильтр по проекту', 'filters', '[data-testid="news-filter-project"] button'],
  ['п.23 код записи', 'none', '.sk-news__meta'],
  ['п.27 время Местное/UTC', 'filters', '[data-testid="news-zone"] [role="radio"]'],
  ['S7A-02 фильтр: компонент', 'filters', '[data-testid="news-filter-component"]'],
  ['S7A-02 фильтр: спринт', 'filters', '[data-testid="news-filter-sprint"]'],
  ['S7A-02 фильтр: веха', 'filters', '[data-testid="news-filter-milestone"]'],
  ['S7A-02 фильтр: автор', 'filters', '[data-testid="news-filter-author"]'],
  ['S7A-02 фильтр: событие', 'filters', '[data-testid="news-filter-kind"]'],
  ['S7A-02 фильтр: тип', 'none', '[data-testid="news-type-chip-task"]'],
  ['S7A-02 подгруппы', 'filters', '[data-testid="news-sub"]'],
  ['S7A-03 метрики периода', 'metrics', '[data-testid="news-metrics"]'],
  ['S7A-03 дельта к прошлому', 'none', '[data-testid="news-strip"] [data-testid="news-delta"]'],
  ['S7A-02 разрез по оси', 'metrics', '[data-testid="news-groups"]'],
  ['S7A-02 матрица дни × проекты', 'metrics', '[data-testid="news-matrix"]'],
  ['S7A-03 сгорание своё/общее', 'metrics', '[data-testid="news-burn"]'],
  ['S7A-03 знания', 'metrics', '[data-testid="news-knowledge"]'],
  ['S7A-07 сверка чисел', 'valid', '[data-testid="news-validation"]'],
  ['v2 мини-график сгорания наверху', 'none', '[data-testid="news-spark"]'],
  ['v2 быстрый фильтр: проект', 'none', '[data-testid="news-facet-project"]'],
  ['v2 быстрый фильтр: компонент', 'none', '[data-testid="news-facet-component"]'],
  ['v2 быстрый фильтр: кто', 'none', '[data-testid="news-facet-who"]'],
];
// Не здесь: п.13/16/26 (ошибка, 403, 502 — фикстура не падает; kit NewsFeed.test.tsx),
// п.24/28/29/30 (ниже и в сторожах i18n), п.25 (сам вход /news — open()).

for (const [id, how, selector] of PARITY) {
  test(`паритет: ${id} — ${how === 'none' ? 'без действий' : 'одно действие'}`, async ({ page }) => {
    await open(page);
    if (how !== 'none') await page.getByTestId(ACTION[how]).click();
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    await expect(el).toBeVisible();
  });
}

test('п.29 клавиатура: Enter сворачивает день', async ({ page }) => {
  await open(page);
  const btn = page.locator('[data-testid^="news-day-"] button[aria-expanded]').first();
  const was = await btn.getAttribute('aria-expanded');
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(btn).not.toHaveAttribute('aria-expanded', was!);
});

test('порядок показывает текущее значение, а не обратное', async ({ page }) => {
  await open(page);
  await page.getByTestId('news-filters-btn').click();
  const on = page.locator('[data-testid="news-order"] [role="radio"][aria-checked="true"]');
  await expect(on).toHaveText(/нов|new/i);
});

// Скрины «до/после» — только по запросу: SHOT_DIR=… SHOT_LABEL=before|after.
test('скрин', async ({ page }, info) => {
  const dir = process.env.SHOT_DIR;
  test.skip(!dir, 'SHOT_DIR не задан');
  await page.goto('/news');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/news-${process.env.SHOT_LABEL ?? 'shot'}-${info.project.name}.png` });
});

// Владелица 09.11 (планшет): «название выровняй — глаза разъезжаются».
test('заголовки строк начинаются с одной линии, подпись вида целиком влезает в плашку', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLElement>('a.sk-news__link')].filter(a => a.offsetParent);
    const xs = links.map(a => Math.round(a.querySelector('.sk-news__rtitle')!.getBoundingClientRect().left - a.getBoundingClientRect().left));
    const clipped = links.map(a => a.querySelector<HTMLElement>('.sk-news__tag')!).filter(t => t.scrollWidth > t.clientWidth + 1).map(t => t.textContent);
    return { xs: [...new Set(xs)], clipped, n: links.length };
  });
  expect(r.n).toBeGreaterThan(2);
  expect(r.xs, `отступы заголовков: ${r.xs.join(', ')}`).toHaveLength(1);
  expect(r.clipped).toEqual([]);
});
