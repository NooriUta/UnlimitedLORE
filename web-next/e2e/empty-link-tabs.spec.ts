// Пустые вкладки связей не занимают ряд (SPRINT_UXR_S14_KIT5/K5-EMPTY-LINK-TABS) — в настоящем
// браузере, на ноутбуке 1280 и телефоне 390. Подставная сеть: ADR без единой связи, все срезы
// отвечают пустым списком — значит каждая вкладка связи прочитана с нулём и должна уйти под «Ещё».
// «Не загрузилось» / «нет доступа» (вкладка в ряду со знаком «?») проверяет vitest kit: emptyLinkTabs.test.tsx.
import { expect, test, type Page } from '@playwright/test';

const A = 'ADR-EMPTY-TABS';

async function stub(page: Page) {
  await page.route('**/lore/**', async route => {
    const url = route.request().url();
    const name = new URL(url).pathname.split('/').pop();
    const body = /^adrs?$/.test(name ?? '')
      ? { rows: [{ adr_id: A, name: 'Пустые связи', status: 'ACCEPTED', valid_from: '2026-11-01T00:00:00Z', context_md: 'текст', decision_md: 'решение' }] }
      : url.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

/** Ряд вкладок паспорта: подпись, счётчик и признак вкладки связи. */
async function rowTabs(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('.sk-rec__tabs .sk-tabs');
    if (!row) return null;
    return Array.from(row.querySelectorAll<HTMLElement>('.sk-tab:not(.sk-tabs__more-btn)')).map(t => ({
      label: (t.textContent ?? '').trim(),
      count: t.querySelector('.sk-tab__count')?.textContent ?? null,
      relation: t.dataset.relation ?? null,
    }));
  });
}

test('ADR без связей: вкладки связей с нулём — под «Ещё», ряд в одну строку', async ({ page }, info) => {
  test.skip(!['desktop-1280', 'phone-390'].includes(info.project.name), 'две проекции: 1280 и 390');
  await stub(page);
  await page.goto(`/?sec=adr&open=${A}&place=full`);
  await expect(page.getByRole('heading', { level: 1, name: 'Пустые связи' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.sk-rec__tabs .sk-tabs')).toBeVisible();
  await page.waitForTimeout(600);

  const tabs = await rowTabs(page);
  expect(tabs, 'ряда вкладок паспорта нет — проверка прошла бы мимо').not.toBeNull();
  // «Задачи» спринта — вкладка ЧАСТИ от приложения (настоящая таблица), правило её не трогает:
  // оно только про вкладки связей. Пустые части — отдельным согласием (методика §7.4.2).
  const zeroRel = tabs!.filter(t => t.relation && t.count === '0' && !t.label.includes('Задачи'));
  expect(zeroRel, `в ряду стоят пустые вкладки связей: ${zeroRel.map(t => t.label).join(', ')}`).toEqual([]);

  // Пустые не удалены: они под «Ещё», со своим «0».
  await page.locator('.sk-rec__tabs .sk-tabs__more-btn').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sk-tabs__more-item .sk-tab__count', { hasText: /^0$/ }).first()).toBeVisible();
  await page.screenshot({ path: `e2e/.results/empty-link-tabs-${info.project.name}.png` });
});

