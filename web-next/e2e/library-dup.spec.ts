// K2-LIBRARY-DUP-PASSPORT: в панели чтения библиотеки заголовок записи ровно один и имя «Контент»
// как вкладка — одно. Подставная сеть, раздел ADR, вид «Библиотека».
import { expect, test } from '@playwright/test';

test('библиотека: заголовок записи один, «Контент» один', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  const adr = { adr_id: 'ADR-LIB-1', id: 'ADR-LIB-1', title: 'Решение для библиотеки', status: 'ACCEPTED', area: 'platform', valid_from: '2026-11-01T00:00:00Z', body_md: 'Текст решения' };
  await page.route('**/lore/**', async route => {
    const u = route.request().url();
    const body = u.includes('/slice/') ? { rows: [adr] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?sec=adr&lv=library&lib=1&libo=ADR-LIB-1');
  await page.screenshot({ path: 'e2e/.results/library-dup.png' });
  const reader = page.locator('.sk-lib__reader, .sk-lib__body').first();
  await expect(reader).toBeVisible({ timeout: 20_000 });
  // Отрицательные проверки — только после загрузки записи (иначе считаем скелетон).
  await expect(page.getByRole('heading', { level: 1, name: 'ADR-LIB-1' })).toBeVisible({ timeout: 20_000 });
  const titles = await page.locator('.sk-lib h1, .sk-lib h2, .sk-lib h3').filter({ hasText: /^ADR-LIB-1$/ }).count();
  expect(titles, 'заголовков записи').toBe(1);
  const content = await page.locator('.sk-lib').getByText('Контент', { exact: true }).count();
  expect(content, '«Контент» как вкладка').toBeLessThanOrEqual(1);
});
