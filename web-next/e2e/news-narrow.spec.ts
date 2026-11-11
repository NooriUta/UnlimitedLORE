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
    // Невидимая зона касания 44 px (kit: ::after у кнопок на сенсоре, #1179)
    // выступает за кнопку и поднимает scrollWidth — это не обрезка того, что
    // видно. Меряем видимое: зона на время замера — по размеру кнопки.
    // Перекрытие зон соседей ловит отдельная проверка ниже.
    document.documentElement.style.setProperty('--hit', '0px');
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
    document.documentElement.style.removeProperty('--hit');
    return [...new Set(out)];
  }, w);
  expect(bad, `экран ${w} px`).toEqual([]);
});

test('быстрые фильтры и чипы дня видны целиком, а не прокруткой вслепую', async ({ page }) => {
  await page.goto('/news');
  await expect(page.locator('[data-testid^="news-row-"]').first()).toBeVisible();
  const w = page.viewportSize()!.width;
  // Видимое содержимое, без невидимых зон касания (см. первую проверку).
  await page.evaluate(() => document.documentElement.style.setProperty('--hit', '0px'));
  for (const sel of ['.sk-news__frow', '.sk-news__types']) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) continue;
    const r = await el.evaluate(node => ({ cw: (node as HTMLElement).clientWidth, sw: (node as HTMLElement).scrollWidth, right: node.getBoundingClientRect().right }));
    expect(r.sw, `${sel}: содержимое ${r.sw} не влезает в ${r.cw}`).toBeLessThanOrEqual(r.cw + 1);
    expect(Math.round(r.right), `${sel}: правый край при экране ${w}`).toBeLessThanOrEqual(w);
  }
});

// Палец попадает туда, куда целился. На сенсоре у каждой кнопки kit есть
// невидимая зона 44 px (::after, #1179); у мелких соседей вплотную — столбики
// мини-графика 12 px через 3 px — зона следующего ложится поверх предыдущего,
// и нажатие на столбик дня открывало СОСЕДНИЙ день. Правило для всей ленты:
// центр каждого управляющего элемента принадлежит ему самому.
test('каждая кнопка ленты нажимается сама, а не соседняя (зоны касания)', async ({ page }) => {
  await page.goto('/news');
  await expect(page.locator('[data-testid^="news-row-"]').first()).toBeVisible();
  const miss = await page.evaluate(() => {
    const out: string[] = [];
    const sel = '.sk-news button, .sk-news [role="radio"], .sk-news a[href]';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || b.bottom < 0 || b.top > window.innerHeight) continue;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || hit === el || el.contains(hit)) continue;
      const tid = el.getAttribute('data-testid') ?? '';
      out.push(`${el.className} ${tid} → ${(hit as HTMLElement).className} ${(hit as HTMLElement).getAttribute('data-testid') ?? ''}`);
    }
    return out;
  });
  expect(miss).toEqual([]);
});
