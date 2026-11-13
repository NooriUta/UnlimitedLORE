// MD-WINDOW §3a: вставка голых ID в текст записи — ссылки [[тип:ID]], найденная зелёная, ненайденная
// красная с полосой «Не найдены записи…». Подставная сеть: ADR-LORE-050 есть, SPEC-NOPE — 404.
import { expect, test } from '@playwright/test';

test('вставка ID: зелёная и красная ссылки, полоса ненайденных', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  const S = 'SPRINT_PASTE';
  await page.route('**/lore/**', async route => {
    const u = route.request().url();
    const p = new URL(u).pathname;
    if (p.startsWith('/lore/record/adr/ADR-LORE-050')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (p.startsWith('/lore/record/spec/SPEC-NOPE')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"NOT_FOUND"}' });
    const name = p.split('/').pop();
    const body = name === 'sprints' ? { rows: [{ sprint_id: S, name: 'Вставка', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z', context_md: 'текст' }] }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${S}&place=full`);
  await page.getByRole('button', { name: /Править «Текст»/ }).first().click();
  const pm = page.locator('.ProseMirror').first();
  await expect(pm).toBeVisible({ timeout: 20_000 });
  await pm.click();
  await page.keyboard.press('End');
  await pm.evaluate(el => {
    const dt = new DataTransfer();
    dt.setData('text/plain', ' см. ADR-LORE-050 и SPEC-NOPE');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-raw="[[adr:ADR-LORE-050]]"]')).toHaveAttribute('data-ref-state', 'ok', { timeout: 10_000 });
  await expect(page.locator('[data-raw="[[spec:SPEC-NOPE]]"]')).toHaveAttribute('data-ref-state', 'missing');
  await expect(page.getByTestId('kit-ref-missing')).toContainText('SPEC-NOPE');
  await pm.screenshot({ path: 'e2e/.results/ref-paste.png' });
  await page.getByTestId('kit-ref-missing').screenshot({ path: 'e2e/.results/ref-paste-bar.png' });
});
