// S4-24 «Редактировать всё» во весь экран (прототип s4-24-edit-all одобрен 13.11). Подставная сеть:
// ADR открыт во весь экран → «✎ Редактировать» → полоса «Отмена · Сохранить», текстовые поля исходником.
import { expect, test } from '@playwright/test';

test('ADR во весь экран: «Редактировать» открывает правку всей записи', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  const adr = { adr_id: 'ADR-EDIT-1', name: 'Большое решение', status: 'ACCEPTED', valid_from: '2026-11-01T00:00:00Z', context_md: '## Контекст\n\nДлинный текст.', decision_md: 'Решение', consequences_md: 'Следствия' };
  await page.route('**/lore/**', async route => {
    const u = route.request().url();
    const body = u.includes('/slice/') ? { rows: [adr] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?sec=adr&open=ADR-EDIT-1&place=full');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  const btn = page.getByRole('button', { name: /Редактировать/ });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  const areas = page.locator('.sk-rec-editall__md');
  expect(await areas.count(), 'текстовых полей исходником').toBeGreaterThan(0);
  await areas.first().fill('## Контекст\n\nПравка.');
  await expect(page.getByTestId('kit-editall-state')).toContainText('изменено 1');
  await page.screenshot({ path: 'e2e/.results/edit-all.png' });
});
