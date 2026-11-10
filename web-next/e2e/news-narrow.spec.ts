// «Новости» на телефоне: ничего не обрезано и ничего за краем
// (SPRINT_UXR_S7A_NEWS/S7A-12 + жалоба владелицы 10.11.2026 со скриншотом с
// её планшета: «до этих пунктов у тебя все езе не адаптивный мобильный вид»).
//
// ПРИЧИНА, а не симптом. Страница при этом НЕ шире экрана (документ ровно 412),
// и прежняя проверка «нет горизонтальной прокрутки страницы» была зелёной —
// она смотрела не туда. Обрезано ВНУТРИ: ряд быстрых фильтров и чипы дня
// объявлены «в одну строку с прокруткой» (`overflow-x: auto`,
// `scrollbar-width: none`), и на телефоне половина фильтров просто не видна.
// Фильтр, которого не видно, — это фильтр, которого нет.
//
// Проверка браузерная: jsdom раскладку не считает, а здесь всё решает ширина.
import { expect, test } from '@playwright/test';

test('ни один элемент ленты не выходит за край и не обрезан', async ({ page }) => {
  await page.goto('/news');
  await expect(page.locator('[data-testid^="news-row-"]').first()).toBeVisible();
  const w = page.viewportSize()!.width;
  const bad = await page.evaluate((vw) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const cls = (el.className || '').toString().split(/\s+/).filter(c => c.startsWith('sk-')).join('.');
      if (!cls) continue;
      if (b.right > vw + 1) {
        const p = el.parentElement?.getBoundingClientRect();
        if (!p || p.right <= vw + 1) out.push(`${cls}: правый край ${Math.round(b.right)}`);
      } else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        out.push(`${cls}: обрезан, видно ${el.clientWidth} из ${el.scrollWidth}`);
      }
    }
    return [...new Set(out)];
  }, w);
  expect(bad, `экран ${w} px`).toEqual([]);
});

test('быстрые фильтры и чипы дня видны целиком, а не прокруткой вслепую', async ({ page }) => {
  await page.goto('/news');
  await expect(page.locator('[data-testid^="news-row-"]').first()).toBeVisible();
  const w = page.viewportSize()!.width;
  for (const sel of ['.sk-news__frow', '.sk-news__types']) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) continue;
    const r = await el.evaluate(node => ({ cw: (node as HTMLElement).clientWidth, sw: (node as HTMLElement).scrollWidth, right: node.getBoundingClientRect().right }));
    expect(r.sw, `${sel}: содержимое ${r.sw} не влезает в ${r.cw}`).toBeLessThanOrEqual(r.cw + 1);
    expect(Math.round(r.right), `${sel}: правый край при экране ${w}`).toBeLessThanOrEqual(w);
  }
});
