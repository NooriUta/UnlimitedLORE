// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE — оба экрана прототипа в настоящем браузере, 1280 и 390:
//   1 · поток «#тег» в TipTap (витрина kit, источник тегов на демо-данных): а → б → в, токен [[ЗАПИСЬ#тег]] в тексте;
//   2 · «сущности по тегу с полями» (/tags, подставная сеть по форме ответа LoreTagResource): колонки из ключей
//       рёбер, фасет «не задано», правка полей из строки; честное «не загрузилось» на 502.
// Проверка раскладки: страница не шире окна (телефон 390 — без горизонтальной прокрутки). Снимки — в SHOTS_DIR.
import { expect, test, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.SHOTS_DIR ?? 'e2e/.results/supertags';
fs.mkdirSync(SHOTS, { recursive: true });
// Витрина kit длинная — поток «#тег» снимается окном (поле и окно тегов в кадре), экран /tags — целиком.
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SHOTS, `${name}-${test.info().project.name}.png`), fullPage });

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const TABLE = {
  tag: 'security-review', state: 'ok', total: 7, types: { adr: 4, decision: 3 },
  columns: [{ key: 'risk', filled: 6 }, { key: 'reviewer', filled: 5 }, { key: 'due', filled: 3 }, { key: 'verdict', filled: 3 }],
  facets: {
    risk: { values: [{ value: 'medium', count: 3 }, { value: 'high', count: 2 }, { value: 'low', count: 1 }], empty: 1, nonempty: 6, total: 7 },
    reviewer: { values: [{ value: 'arharaga', count: 4 }, { value: 'CICDGitHub', count: 1 }], empty: 2, nonempty: 5, total: 7 },
    due: { values: [{ value: '2026-11-27', count: 1 }, { value: '2026-11-25', count: 1 }, { value: '2026-11-22', count: 1 }], empty: 4, nonempty: 3, total: 7 },
    verdict: { values: [{ value: 'нужна санитизация', count: 1 }, { value: 'ок, секреты через Infisical', count: 1 }, { value: 'замечаний нет', count: 1 }], empty: 4, nonempty: 3, total: 7 },
  },
  rows: [
    { type: 'adr', id: 'ADR-LORE-050', title: 'Ссылка на объект LORE прямо в MD', fields: { reviewer: 'arharaga', risk: 'high', due: '2026-11-27', verdict: 'нужна санитизация' }, tagged_at: '2026-11-20T10:00:00Z' },
    { type: 'decision', id: 'D-2026-QG-LLM-MODULE', title: 'Модуль вызова LLM для LORE', fields: { reviewer: 'arharaga', risk: 'medium', due: '2026-11-25' }, tagged_at: '2026-11-19T10:00:00Z' },
    { type: 'adr', id: 'ADR-QG-JOB-CONTRACT', title: 'Контракт джоба рутины QG', fields: { reviewer: 'CICDGitHub', risk: 'medium', verdict: 'ок, секреты через Infisical' }, tagged_at: '2026-11-18T10:00:00Z' },
    { type: 'decision', id: 'D-2026-OWN-HOST', title: 'Собственный хост LORE', fields: { risk: 'high', due: '2026-11-22' }, tagged_at: '2026-11-15T10:00:00Z' },
    { type: 'adr', id: 'ADR-LORE-053', title: 'Архитектура гейтов качества', fields: { reviewer: 'arharaga', risk: 'low', verdict: 'замечаний нет' }, tagged_at: '2026-11-12T10:00:00Z' },
    { type: 'decision', id: 'D-2026-MD-WINDOW', title: 'Мини-окно ссылок', fields: { reviewer: 'arharaga', risk: 'medium' }, tagged_at: '2026-11-11T10:00:00Z' },
    { type: 'adr', id: 'ADR-LORE-054', title: 'Договор мини-окна ссылки', fields: {}, tagged_at: '2026-11-10T10:00:00Z' },
  ],
};
const SUGGEST = { state: 'ok', tags: [
  { tag_id: 'security-review', uses: 7, keys: ['due', 'reviewer', 'risk', 'verdict'] },
  { tag_id: 'customer-visible', uses: 12, keys: ['customer'] },
  { tag_id: 'breaking-change', uses: 3, keys: [] },
] };

async function noPageOverflow(page: Page) {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(w.doc, `страница шире окна: ${w.doc} > ${w.win}`).toBeLessThanOrEqual(w.win + 1);
}

test.describe('supertags', () => {
  test.skip(({ viewport }) => ![1280, 390].includes(viewport?.width ?? 0), 'снимки — 1280 и 390');

  test('1 · поток «#тег» в TipTap: а → б → в', async ({ page }) => {
    await page.goto('/kit#kit-content');
    const box = page.getByTestId('kit-tags');
    await box.scrollIntoViewIfNeeded();
    const ed = box.locator('.ProseMirror');
    await ed.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Разбор: #sec');
    await expect(page.getByText('#security-review').first()).toBeVisible();
    await noPageOverflow(page);
    await shot(page, 'flow-a-list', false);
    await page.locator('.sk-tagpick__opt', { hasText: '#security-review' }).click();
    await page.getByLabel('risk').fill('medium');
    await page.getByLabel('reviewer').fill('arharaga');
    await noPageOverflow(page);
    await shot(page, 'flow-b-fields', false);
    await page.getByRole('button', { name: 'Поставить тег' }).click();
    await expect(box.locator('.sk-tagpick')).toHaveCount(0);
    await expect(box.locator('.sk-wref--tag').first()).toBeVisible();
    await noPageOverflow(page);
    await shot(page, 'flow-c-token', false);
  });

  test('2 · сущности по тегу с полями: колонки, фасет, правка ребра', async ({ page }) => {
    let applied: unknown = null;
    await page.route('**/lore/tag/suggest**', r => json(r, SUGGEST));
    await page.route('**/lore/tag/entities**', r => json(r, TABLE));
    await page.route('**/lore/tag/apply', async r => { applied = r.request().postDataJSON(); await json(r, { ok: true, action: 'updated' }); });
    await page.goto('/tags?tag=security-review');
    await expect(page.getByRole('link', { name: 'ADR-LORE-050' })).toBeVisible();
    await noPageOverflow(page);
    await shot(page, 'list-all');
    await page.getByRole('button', { name: /risk: high · 2/ }).click();
    await expect(page.getByRole('link', { name: 'ADR-LORE-053' })).toHaveCount(0);
    await shot(page, 'list-facet');
    await page.getByRole('button', { name: /Править поля · ADR-LORE-050/ }).click();
    await page.getByLabel('risk', { exact: true }).fill('medium');
    await noPageOverflow(page);
    await shot(page, 'list-edit');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect.poll(() => applied).toMatchObject({ type: 'adr', id: 'ADR-LORE-050', tag_id: 'security-review', fields: { risk: 'medium' } });
  });

  test('2 · честные состояния: 502 — «не смогли загрузить», пусто — «записей нет»', async ({ page }) => {
    await page.route('**/lore/tag/suggest**', r => json(r, SUGGEST));
    await page.route('**/lore/tag/entities**', r => (new URL(r.request().url()).searchParams.get('tag') === 'nothing'
      ? json(r, { ...TABLE, state: 'empty', total: 0, rows: [], columns: [], facets: {}, types: {} })
      : json(r, { error: 'UPSTREAM', detail: 'ArcadeDB недоступна' }, 502)));
    await page.goto('/tags?tag=security-review');
    await expect(page.getByRole('alert')).toContainText('502');
    await shot(page, 'state-error');
    await page.goto('/tags?tag=nothing');
    await expect(page.getByText('Записей с тегом «#nothing» нет')).toBeVisible();
    await noPageOverflow(page);
    await shot(page, 'state-empty');
  });
});
