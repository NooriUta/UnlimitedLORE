// Ряд вкладок сворачивается ПО ШИРИНЕ, и это единственное место правила,
// которое нельзя проверить в jsdom (паспорта v3, S4-29).
//
// В jsdom раскладка нулевая: там «влезло» всегда равно потолку, и тесты от
// этого детерминированы — но настоящий замер остаётся непроверенным. Здесь
// проверяется он: при сужении окна вкладки уходят в «Ещё» с конца, ряд не
// переносится на вторую строку и не мигает.
import { expect, test } from '@playwright/test';

/** Видимые вкладки ряда (без кнопки свёртки «Ещё»). */
async function row(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sk-tabs');
    if (!el) return null;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.sk-tab'));
    const tops = new Set(tabs.map(t => t.offsetTop));
    return {
      labels: tabs.map(t => (t.textContent ?? '').trim()),
      lines: tops.size,
      width: Math.round(el.getBoundingClientRect().width),
    };
  });
}

test('узкое окно: вкладки уходят в «Ещё» с конца, ряд в одну строку', async ({ page }) => {
  await page.goto('/kit');
  await expect(page.locator('.sk-tabs').first()).toBeVisible();

  const wide = await row(page);
  expect(wide, 'ряда вкладок на витрине нет — проверка прошла бы мимо').not.toBeNull();
  expect(wide!.lines, `ряд уже перенесён на ${wide!.lines} строк при полной ширине`).toBe(1);

  // Сужаем окно и ждём, пока ряд перестроится.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(600);
  const narrow = await row(page);

  expect(narrow!.lines, `на узком экране ряд разъехался на ${narrow!.lines} строк`).toBe(1);
  expect(narrow!.labels.length, 'на узком экране вкладок не меньше, чем на широком').toBeLessThanOrEqual(wide!.labels.length);
  // Уход именно С КОНЦА: то, что осталось, — начало прежнего порядка.
  expect(wide!.labels.slice(0, narrow!.labels.length)).toEqual(narrow!.labels);
});

test('ряд не мигает: после перестройки ширина и состав устойчивы', async ({ page }) => {
  await page.goto('/kit');
  await expect(page.locator('.sk-tabs').first()).toBeVisible();
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(600);

  const a = await row(page);
  await page.waitForTimeout(700);
  const b = await row(page);
  // Если усадка дрожит («убрал вкладку → пропала полоса прокрутки → стало
  // шире → вернул»), состав ряда между двумя замерами разойдётся.
  expect(b!.labels, 'состав ряда меняется сам по себе — усадка дрожит').toEqual(a!.labels);
  expect(b!.lines).toBe(1);
});
