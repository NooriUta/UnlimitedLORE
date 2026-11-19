// Экран «Модель» админки v2 (SPRINT_LORE_MODEL_AS_CONFIG/MC-06). Подставная сеть: модель из LORE,
// схема не прочиталась. Сценарий владелицы: правка подписи → дифф → «Проверить» (несогласованная
// правка — 422 с причиной) → согласованная правка → «Применить…» с «что и зачем» → PUT с reason.
// Вкладка — в адресе. На телефоне горизонтальной прокрутки страницы нет.
import { expect, test, type Route } from '@playwright/test';

const DOC = {
  format: 'lore-model/1',
  types: [
    { type: 'product', label: 'Продукт', icon: 'bullseye', fields: [
      { key: 'title', label: 'Название', kind: 'text', group: 'head', required: true },
      { key: 'code', label: 'Код', kind: 'text', group: 'head' },
      { key: 'sort_order', label: 'Порядок', kind: 'number', group: 'props' },
    ] },
    { type: 'sprint', label: 'Спринт', icon: 'sprint', fields: [{ key: 'title', label: 'Название', kind: 'text', group: 'head' }] },
  ],
  nav: [
    { id: 'work', labelKey: 'shell.grp.work', items: [{ section: 'sprint' }] },
    { id: 'product', labelKey: 'shell.grp.product', items: [{ section: 'product' }] },
  ],
  audience: { product: 'everywhere', sprint: 'everywhere' },
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('админка → Модель: правка, дифф, 422 с причиной, применение с причиной', async ({ page }, info) => {
  const puts: Record<string, unknown>[] = [];
  await page.route('**/lore/**', async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false });
    if (p === '/lore/model/config' && req.method() === 'PUT') {
      const body = req.postDataJSON() as Record<string, unknown>;
      puts.push(body);
      const doc = JSON.parse(String(body.content));
      const title = doc.types[0].fields.find((f: { key: string }) => f.key === 'title');
      if (title.group !== 'head') return json(route, { error: 'MODEL_INCONSISTENT', problems: ['product.title: поле названия обязано быть в группе head — паспорт без названия в шапке не строится'], written: false }, 422);
      return json(route, { ok: true, dry_run: body.dry_run === true, hash: 'h2', hash_before: 'h1', changed: true, types_changed: ['product'] });
    }
    if (p === '/lore/model/config') return json(route, { config_id: 'lore-model', source: 'lore', hash: 'h1', seed_drift: false, warning: null, content: JSON.stringify(DOC) });
    if (p === '/lore/model') return json(route, { missing: ['types'] });
    if (p.includes('/slice/')) return json(route, { rows: [] });
    return json(route, {});
  });

  await page.goto('/?mod=admin&sec=adm-model&mtype=product');
  const label = page.getByLabel('Подпись code');
  await expect(label).toBeVisible({ timeout: 20_000 });

  // Несогласованная правка: название не в шапке.
  await page.getByLabel('Группа title').selectOption('props');
  await expect(page.getByTestId('adm-model-diff')).toContainText('types[product].fields[title].group');
  await expect(page.getByTestId('adm-model-apply')).toBeDisabled();
  await page.getByTestId('adm-model-check').click();
  await expect(page.getByTestId('adm-model-check-out')).toHaveAttribute('data-state', 'bad');
  await expect(page.getByTestId('adm-model-check-out')).toContainText('обязано быть в группе head');
  await expect(page.getByTestId('adm-model-apply')).toBeDisabled();

  // Сброс и согласованная правка подписи.
  await page.getByTestId('adm-model-reset').click();
  await expect(page.getByTestId('adm-model-diff')).toHaveCount(0);
  await label.fill('Шифр');
  await page.getByTestId('adm-model-check').click();
  await expect(page.getByTestId('adm-model-check-out')).toHaveAttribute('data-state', 'ok');
  await page.screenshot({ path: `e2e/.results/model-admin-diff-${info.project.name}.png`, fullPage: true });
  await page.getByTestId('adm-model-apply').click();
  await expect(page.getByTestId('adm-model-apply-ok')).toBeDisabled();
  await page.getByTestId('adm-model-why').fill('подпись кода по словарю');
  await page.screenshot({ path: `e2e/.results/model-admin-${info.project.name}.png` });
  await page.getByTestId('adm-model-apply-ok').click();
  await expect.poll(() => puts.length).toBe(3);
  expect(puts[2]).toMatchObject({ dry_run: false, reason: 'подпись кода по словарю', expected_hash: 'h1' });

  // Вкладка — в адресе; гигиена честно говорит «не смогли проверить».
  await page.getByRole('tab', { name: /Гигиена/ }).click();
  await expect(page).toHaveURL(/mtab=hyg/);
  await expect(page.getByTestId('adm-model-hyg')).toContainText('не смогли проверить');

  // Страница не уезжает вбок (телефон 412).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
});
