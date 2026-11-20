// SPRINT_LORE_WORK_ANY_KIND/WK-01 — правка вида продукта ИТ / не ИТ (tech | service) в админке и показ
// в паспорте. Слово владелицы 20.11.2026: «правка вида — делай; с подтверждением и тестами до деплоя».
// Вид — набор (ADR-LORE-044): два переключателя; перед записью kit ReasonDialog с обязательной
// причиной. Подставная сеть держит состояние: после записи срез словаря и паспорт отдают новый вид.
// Ноутбук 1280 и телефон 390 — на телефоне страница не уезжает вбок.
import { expect, test, type Page, type Route } from '@playwright/test';

const SHOTS = process.env.WK01_SHOTS ?? 'e2e/.results';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Entry = { dict_type: string; code: string; label_ru: string; kind: string[] | string | null; [k: string]: unknown };

function product(code: string, label: string, kind: string[] | string | null, sort: number): Entry {
  return { dict_type: 'product', code, label_ru: label, label_en: label, color: null, icon: null, sort_order: sort, is_active: true, is_extensible: true, kind };
}

function recordOf(e: Entry) {
  const kind = Array.isArray(e.kind) ? e.kind : e.kind ? [e.kind] : [];
  return {
    contract: 'lore.record/1',
    record: { type: 'product', id: e.code, title: e.label_ru, status: null, version: null },
    values: { title: e.label_ru, code: e.code, kind, is_active: true, projects: [], components: [] },
    parts: [], links: [], facts: {}, meta: {}, computed: {},
    perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: 'продукт — статья словаря, правится в админке' },
    schema: {
      type: 'product', label: 'Продукт', label_key: 'pp.kind.product', icon: 'bullseye',
      fields: [
        { key: 'title', label: 'Название', label_key: 'pp.field.title', kind: 'text', group: 'head', required: true, editable: false },
        { key: 'code', label: 'Код', label_key: 'pp.field.code', kind: 'text', group: 'head', required: false, editable: false },
        { key: 'kind', label: 'Вид', label_key: 'pp.field.kind', kind: 'text', group: 'props', required: false, editable: false },
        { key: 'is_active', label: 'Активен', label_key: 'pp.field.isActive', kind: 'bool', group: 'props', required: false, editable: false },
      ],
    },
  };
}

async function mockLore(page: Page) {
  const dict: Entry[] = [
    product('AIDA', 'AIDA', ['tech'], 10),
    product('FREYJA', 'Freyja', 'service', 20),
    product('HARPA', 'HARPA', ['tech', 'service'], 30),
    { dict_type: 'area', code: 'core', label_ru: 'Ядро', kind: null, sort_order: 10, is_active: true },
  ];
  const posts: Record<string, unknown>[] = [];
  await page.route('**/lore/**', async route => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (p === '/lore/whoami') return json(route, { auth_enabled: false });
    if (p === '/lore/dict/entry' && req.method() === 'POST') {
      const b = req.postDataJSON() as Record<string, unknown>;
      posts.push(b);
      const e = dict.find(x => x.dict_type === b.dict_type && x.code === b.code);
      if (!e) return json(route, { error: 'NOT_FOUND' }, 404);
      if (Array.isArray(b.kind) && b.kind.length === 0) return json(route, { error: 'BAD_PARAMS', detail: 'пустой набор' }, 400);
      const was = JSON.stringify(Array.isArray(e.kind) ? e.kind : e.kind ? [e.kind] : []);
      if (b.kind && JSON.stringify(b.kind) !== was && !b.reason) return json(route, { error: 'BAD_PARAMS', detail: 'смена вида — правка с причиной: пришлите reason' }, 400);
      if (b.kind) e.kind = b.kind as string[];
      return json(route, { ok: true, dict_type: b.dict_type, code: b.code, outcome: 'updated' });
    }
    if (p.startsWith('/lore/slice/dictionary')) return json(route, { rows: dict });
    if (p.startsWith('/lore/slice/products')) return json(route, { rows: dict.filter(x => x.dict_type === 'product') });
    const rec = p.match(/^\/lore\/record\/product\/([^/]+)$/);
    if (rec) {
      const e = dict.find(x => x.dict_type === 'product' && x.code === decodeURIComponent(rec[1]));
      return e ? json(route, recordOf(e)) : json(route, { error: 'NOT_FOUND' }, 404);
    }
    if (p.includes('/slice/')) return json(route, { rows: [] });
    return json(route, {});
  });
  return posts;
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('словарь product: вид продукта — два переключателя, причина обязательна, новый вид — в паспорте', async ({ page }, info) => {
  const posts = await mockLore(page);
  const tag = info.project.name;

  await page.goto('/?mod=admin&sec=adm-dicts&adm-dict=product');
  const aida = page.getByTestId('adm-dict-AIDA');
  await expect(aida).toBeVisible({ timeout: 20_000 });
  await expect(aida.getByTestId('adm-dict-kind')).toHaveAttribute('data-kind', 'tech');
  await expect(page.getByTestId('adm-dict-HARPA').getByTestId('adm-dict-kind')).toHaveAttribute('data-kind', 'tech service');
  expect(await pageOverflow(page), 'список словаря на ширине экрана').toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/wk01-dicts-list-${tag}.png`, fullPage: true });

  await aida.getByRole('button', { name: 'Править' }).click();
  const form = page.getByTestId('adm-dict-form');
  const kinds = form.getByTestId('adm-dict-kinds');
  await expect(kinds).toBeVisible();
  const tech = kinds.getByRole('button', { name: /^ИТ/ });
  const service = kinds.getByRole('button', { name: /^не ИТ/ });
  await expect(tech).toHaveAttribute('aria-pressed', 'true');
  await expect(service).toHaveAttribute('aria-pressed', 'false');

  // Пустой набор: выключить единственный вид — предупреждение, запись не уходит.
  await tech.click();
  await expect(form.getByTestId('adm-dict-kind-empty')).toBeVisible();
  await form.getByRole('button', { name: /Применить/ }).click();
  await expect(page.getByTestId('kit-reason-input')).toHaveCount(0);
  expect(posts, 'пустой набор не записан').toHaveLength(0);

  // Оба вида: tech + service.
  await tech.click();
  await service.click();
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  expect(await pageOverflow(page), 'форма правки на ширине экрана').toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/wk01-dicts-form-${tag}.png`, fullPage: true });
  // Экран (не вся страница): на телефоне нижняя полоса закрывает переключатели на снимке fullPage.
  await kinds.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SHOTS}/wk01-toggles-${tag}.png` });

  await form.getByRole('button', { name: /Применить/ }).click();
  const why = page.getByTestId('kit-reason-input');
  await expect(why).toBeVisible();
  const ok = page.getByRole('button', { name: 'Сохранить вид' });
  await expect(ok, 'без причины подтвердить нельзя').toBeDisabled();
  await why.fill('AIDA продаёт и услуги внедрения');
  await expect(ok).toBeEnabled();
  expect(await pageOverflow(page), 'диалог причины на ширине экрана').toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/wk01-reason-${tag}.png`, fullPage: true });
  await ok.click();

  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({ dict_type: 'product', code: 'AIDA', kind: ['tech', 'service'], reason: 'AIDA продаёт и услуги внедрения' });
  await expect(page.getByTestId('adm-dict-AIDA').getByTestId('adm-dict-kind')).toHaveAttribute('data-kind', 'tech service');

  // Паспорт продукта показывает новый вид.
  await page.goto('/?sec=product&open=AIDA&place=full');
  // Свернутая группа «Свойства» сводкой уже называет вид; раскрытая — пунктами списка.
  const props = page.getByText('Свойства', { exact: true });
  await expect(props).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/tech, service/).first()).toBeVisible();
  await page.locator('summary.sk-rec-propsrow__sum').first().click();
  const items = page.locator('.sk-rec-fields li');
  await expect(items.filter({ hasText: /^service$/ })).toBeVisible();
  await expect(items.filter({ hasText: /^tech$/ })).toBeVisible();
  await expect(page.locator('.sk-rec-fields')).not.toContainText('["tech"');
  expect(await pageOverflow(page), 'паспорт на ширине экрана').toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/wk01-passport-${tag}.png`, fullPage: true });

  // Список продуктов: колонка «Вид» — тот же набор.
  await page.goto('/?sec=product');
  await expect(page.getByText('HARPA').first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/wk01-products-list-${tag}.png`, fullPage: true });
  // Вид — значения набора (tech, service), а не тип записи «Продукты» (ключ поля — product_kind).
  await expect(page.getByText(/^service$|tech, service/).first()).toBeVisible();
  expect(await pageOverflow(page), 'список продуктов на ширине экрана').toBeLessThanOrEqual(0);
});
