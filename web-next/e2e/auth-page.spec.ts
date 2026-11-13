// PU-21: страница входа v2 — как у KC и Völva. Сервер с включённым входом на :4428, discovery
// Keycloak отвечает ошибкой → шлюз показывает «вход не удался» на новой странице входа.
// Запуск вручную: dev-сервер с VITE_LORE_AUTH_ENABLED=true на 4428 (см. отчёт PU-21).
import { expect, test } from '@playwright/test';

for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 360, height: 800 }]] as const) {
  test(`страница входа: иллюстрация, бренд, карточка (${name})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'размер задан сам');
    await page.setViewportSize(vp);
    await page.route('**/realms/fake/**', r => r.fulfill({ status: 500, body: 'down' }));
    await page.route('**/lore/**', r => r.fulfill({ status: 401, body: '{}' }));
    await page.goto('http://127.0.0.1:4428/');
    await expect(page.locator('.sk-auth__card')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sk-auth__art svg')).toHaveCount(1);
    await expect(page.locator('.sk-auth__name')).toHaveText('LORE');
    const doc = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(doc, 'страница не шире окна').toBeLessThanOrEqual(vp.width);
    await page.screenshot({ path: `e2e/.results/auth-page-${name}.png` });
  });
}
