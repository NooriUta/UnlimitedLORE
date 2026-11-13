// Паспорт слева (SPRINT_UXR_MOBILE_POLISH/MP2-14-PLACE-LEFT): ?place=left открывает паспорт
// левой панелью, список — справа от него. Подставная сеть.
import { expect, test } from '@playwright/test';

const S = 'SPRINT_LEFT';
test('?place=left — паспорт слева от списка', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  await page.route('**/lore/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const body = name === 'sprints' ? { rows: [{ sprint_id: S, name: 'Слева', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z', context_md: 'текст' }] }
      : route.request().url().includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${S}&place=left`);
  const dock = page.locator('.sk-dock[data-placement="left"]');
  await expect(dock).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Слева' })).toBeVisible();
  const panel = await dock.locator('.sk-dock__panel').boundingBox();
  const list = await dock.locator('.sk-dock__backdrop').boundingBox();
  await page.screenshot({ path: 'e2e/.results/place-left.png' });
  expect(panel!.x).toBeLessThan(list!.x);
});
