// Экран «Модель» админки v2 (SPRINT_LORE_MODEL_AS_CONFIG/MC-06). Подставная сеть: модель из LORE,
// схема не прочиталась. Сценарий владелицы: правка подписи → дифф → «Проверить» (несогласованная
// правка — 422 с причиной) → согласованная правка → «Применить…» с «что и зачем» → PUT с reason.
// Вкладка — в адресе. На телефоне горизонтальной прокрутки страницы нет.
import { expect, test, type Page, type Route } from '@playwright/test';

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

async function mockLore(page: Page): Promise<Record<string, unknown>[]> {
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
  return puts;
}

/** Страница не уезжает вбок: scrollWidth ≤ clientWidth. */
const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('админка → Модель: правка, дифф, 422 с причиной, применение с причиной', async ({ page }, info) => {
  test.skip(info.project.name === 'phone-390', 'телефонный сценарий — отдельный тест ниже');
  const puts = await mockLore(page);

  await page.goto('/?mod=admin&sec=adm-model&mtype=product');
  const label = page.getByLabel('Подпись code');
  await expect(label).toBeVisible({ timeout: 20_000 });
  // Поле подписи не схлопывается, когда рядом открыт дифф (сетка строки поля, 21:08 — схлопывалось в 0).
  await label.fill('Шифр');
  expect((await label.boundingBox())!.width, 'ширина поля подписи при открытом диффе').toBeGreaterThanOrEqual(120);
  await page.getByTestId('adm-model-reset').click();

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
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Применить', exact: true })).toBeDisabled();
  await page.getByTestId('kit-reason-input').fill('подпись кода по словарю');
  await page.screenshot({ path: `e2e/.results/model-admin-${info.project.name}.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Применить', exact: true }).click();
  await expect.poll(() => puts.length).toBe(3);
  expect(puts[2]).toMatchObject({ dry_run: false, reason: 'подпись кода по словарю', expected_hash: 'h1' });

  // Вкладка — в адресе; гигиена честно говорит «не смогли проверить».
  await page.getByRole('tab', { name: /Гигиена/ }).click();
  await expect(page).toHaveURL(/mtab=hyg/);
  await expect(page.getByTestId('adm-model-hyg')).toContainText('не смогли проверить');

  // Страница не уезжает вбок (телефон 412).
  expect(await pageOverflow(page), 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);

  // v4: экран правки поля — окно kit Dialog; на ноутбуке по центру, на телефоне во весь экран.
  await page.getByRole('tab', { name: /Типы/ }).click();
  await page.getByRole('button', { name: 'Изменить поле title' }).click();
  const dlg = page.getByRole('dialog', { name: /Поле title/ });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('tab', { name: /EN/ }).click();
  await dlg.getByLabel('Определение').fill('How people call it');
  const vw = page.viewportSize()!.width;
  const db = (await dlg.boundingBox())!;
  if (info.project.name === 'desktop-1280') expect(db.width, 'окно по центру, не во весь экран').toBeLessThan(vw - 100);
  else expect(db.width, 'на телефоне окно во весь экран').toBeGreaterThanOrEqual(vw - 1);
  await page.screenshot({ path: `e2e/.results/model-admin-field-${info.project.name}.png` });
  await dlg.getByRole('button', { name: 'В дифф' }).click();
  await expect(page.getByTestId('adm-model-diff')).toContainText('types[product].fields[title].definitionEn');
});

// Требование владелицы 19.11: «HTML админки не адаптирован под телефон» — она работает с телефона.
// 390×844 (проект phone-390) и 360 — нижняя граница: нет прокрутки страницы вбок, поля ввода во всю
// ширину, дифф — под формой правки, «Проверить» и «Применить» видны и нажимаются.
test('телефон 390 и 360: экран «Модель» без прокрутки вбок, дифф под формой, кнопки нажимаются', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'только проекция phone-390');
  const puts = await mockLore(page);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?mod=admin&sec=adm-model&mtype=product');
    const label = page.getByLabel('Подпись code');
    await expect(label).toBeVisible({ timeout: 20_000 });
    expect(await pageOverflow(page), `${width}: прокрутка страницы вбок до правки`).toBeLessThanOrEqual(0);

    // Поле ввода — во всю ширину содержимого, а не узкая ячейка таблицы.
    const box = (await label.boundingBox())!;
    expect(box.width, `${width}: ширина поля подписи`).toBeGreaterThanOrEqual(width * 0.6);
    expect(box.x + box.width, `${width}: поле не уходит за край`).toBeLessThanOrEqual(width);

    await label.fill(`Шифр ${width}`);
    const diff = page.getByTestId('adm-model-diff');
    await expect(diff).toBeVisible();
    // Дифф — под формой правки, а не сбоку.
    const fields = (await page.getByTestId('adm-model-fields').boundingBox())!;
    const d = (await diff.boundingBox())!;
    expect(d.y, `${width}: дифф под формой`).toBeGreaterThanOrEqual(fields.y + fields.height - 1);
    expect(d.x + d.width, `${width}: дифф не уходит за край`).toBeLessThanOrEqual(width);
    expect(await pageOverflow(page), `${width}: прокрутка страницы вбок с диффом`).toBeLessThanOrEqual(0);

    // Вкладки не раздувают страницу: ряд целиком в ширине экрана.
    const tabs = (await page.getByRole('tablist').first().boundingBox())!;
    expect(tabs.x + tabs.width, `${width}: ряд вкладок`).toBeLessThanOrEqual(width);

    // «Проверить» и «Применить» видны и нажимаются.
    const check = page.getByTestId('adm-model-check');
    await expect(check).toBeInViewport();
    await check.click();
    await expect(page.getByTestId('adm-model-check-out')).toHaveAttribute('data-state', 'ok');
    const apply = page.getByTestId('adm-model-apply');
    await expect(apply).toBeEnabled();
    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport();
    await apply.click();
    await page.getByTestId('kit-reason-input').fill(`подпись кода ${width}`);
    const ok = page.getByRole('dialog').getByRole('button', { name: 'Применить', exact: true });
    await expect(ok).toBeInViewport();
    await ok.click();
    await expect.poll(() => puts.filter(p => p.dry_run === false).length).toBe(width === 390 ? 1 : 2);
    await page.screenshot({ path: `e2e/.results/model-admin-phone-${width}.png`, fullPage: true });

    // Экран правки поля на телефоне — во весь экран, без прокрутки вбок; «В дифф» видна и нажимается.
    await page.getByRole('button', { name: 'Изменить поле code' }).click();
    const dlg = page.getByRole('dialog', { name: /Поле code/ });
    const db = (await dlg.boundingBox())!;
    expect(db.x, `${width}: окно поля с левого края`).toBeLessThanOrEqual(0);
    expect(db.width, `${width}: окно поля во весь экран`).toBeGreaterThanOrEqual(width - 1);
    expect(await dlg.evaluate(el => el.scrollWidth - el.clientWidth), `${width}: окно поля не листается вбок`).toBeLessThanOrEqual(0);
    const toDiff = dlg.getByRole('button', { name: 'В дифф' });
    await expect(toDiff).toBeInViewport();
    await page.screenshot({ path: `e2e/.results/model-admin-field-phone-${width}.png` });
    await dlg.getByTestId('adm-model-fe-cancel').click();
  }
});
