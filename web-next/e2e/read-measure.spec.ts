// Мера чтения одинакова на всех вкладках паспорта (SPRINT_UXR_S5_RECORD_TASKS/S5-05).
//
// Жалоба владелицы 08.11: «переключая вкладки, у меня изменяется ширина».
// Поправка 09.11: мера считается от ДИСПЛЕЯ (`--rec-frame: 66vw`, `--rec-col`),
// контейнер только ограничивает. Unit-тесты проверяли правила CSS, а владелица
// просила проверку в браузере: jsdom ширину не считает.
//
// Данные — подставная сеть (`page.route`): паспорт без фасада не рисует вкладок,
// а замер пустого экрана был бы ложно-зелёным. Поэтому первый тест —
// положительный контроль: паспорт и вкладки на месте.
import { expect, test, type Page } from '@playwright/test';

const LONG = Array.from({ length: 12 }, (_, i) => `Абзац ${i}: длинный текст контекста спринта, чтобы строка точно упиралась в меру чтения, а не в своё содержимое.`).join('\n\n');

const RECORD = {
  contract: 'lore.record/1',
  record: { type: 'sprint', id: 'SPRINT_A', title: 'Спринт А', status: 'active', version: '2026-11-08T10:00:00Z' },
  values: { title: 'Спринт А', status: 'active', context_md: LONG },
  parts: [{
    key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in', owned: true, relation: 'composition', state: 'ok', count: 1,
    items: [{ id: 'SPRINT_A/A-1', title: 'Задача', status: 'done', values: { code: 'A-1', effort: 1 } }],
  }],
  links: [{ rel: 'DEPENDS_ON', dir: 'out', id: 'SPRINT_B', type: 'sprint', title: 'Спринт Б', status: 'active' }],
  perms: { can_edit: true, can_status: true, can_create: true, status_next: ['done'], reason: null },
  facts: { tasks: { done: 1, total: 1, open: 0 } },
  schema: {
    type: 'sprint', label: 'Спринт', label_key: 'rec.sprint', icon: 'sprint',
    fields: [
      { key: 'title', label: 'Название', label_key: 'f.title', kind: 'text', group: 'head', required: true, editable: true, write: { field: 'name' } },
      { key: 'context_md', label: 'Контекст', label_key: 'f.context', kind: 'md', group: 'body', required: false, editable: true, write: { field: 'context_md' } },
    ],
    layout: {},
    relations: [
      { key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'PART_OF', dir: 'in', target_type: 'task', place: 'part', manageable: false },
      { key: 'depends_on', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out', target_type: 'sprint', place: 'link_tab', manageable: true },
    ],
  },
  meta: { facade: 'server', sources: { block: ['tasks'] }, data_state: [] },
};

async function stub(page: Page) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const body =
      p.includes('/record/') ? RECORD
      : p.includes('/count') ? { count: 1, total: 1 }
      : p.includes('/slice/') ? { rows: [{ sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS' }], total: 1 }
      : p.includes('/me/views') ? { views: [] }
      : p.includes('/me/settings') ? { settings: {} }
      : p.includes('/me/recent') ? { recent: [] }
      : p.includes('/me/favorites') ? { favorites: [] }
      : p.includes('/me/drafts') ? { drafts: [] }
      : p.includes('/me/memory') ? { memories: [] }
      : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function openFull(page: Page) {
  await stub(page);
  await page.goto('/?mod=forseti&sec=sprint&open=SPRINT_A&place=full');
  await expect(page.locator('[data-placement="full"] [role="tab"]').first()).toBeVisible({ timeout: 20_000 });
}

/** Ширина содержимого вкладки — того, на что действует мера `--rec-col`. */
const panelWidth = (page: Page) => page.locator('.sk-dock[data-placement="full"] .sk-tabpanel > *').first()
  .evaluate(el => Math.round(el.getBoundingClientRect().width));

test('положительный контроль: паспорт на весь экран и его вкладки нарисованы', async ({ page }) => {
  await openFull(page);
  expect(await page.locator('[data-placement="full"] [role="tab"]').count()).toBeGreaterThan(1);
});

test('ширина строки одинакова на всех вкладках', async ({ page }) => {
  await openFull(page);
  // Подсказка kit-сессии: ширины не должны сходиться по пустым заглушкам —
  // в «Контенте» обязан стоять настоящий текст тела.
  await expect(page.locator('.sk-dock[data-placement="full"] .sk-tabpanel')).toContainText('Абзац 0');
  const tabs = page.locator('[data-placement="full"] [role="tablist"] [role="tab"]:not([aria-haspopup])');
  const n = await tabs.count();
  const widths: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const tab = tabs.nth(i);
    const name = (await tab.textContent())?.trim() || String(i);
    await tab.click();
    await page.waitForTimeout(150);
    widths[name] = await panelWidth(page);
  }
  const distinct = [...new Set(Object.values(widths))];
  expect(distinct, `ширина по вкладкам: ${JSON.stringify(widths)}`).toHaveLength(1);
});

// До 900 px мера — 100% (seidr.css, @media max-width: 900px): на телефоне 66%
// дисплея — это 270 px строки, читать нечего. Поэтому правило 66vw — для
// широкого экрана, а на узком мера просто не шире окна.
test('мера: на широком не шире 66% дисплея, на узком — не шире окна', async ({ page }) => {
  await openFull(page);
  const vw = page.viewportSize()!.width;
  const w = await panelWidth(page);
  const cap = vw > 900 ? Math.ceil(vw * 0.66) : vw;
  expect(w, `ширина ${w} при окне ${vw}`).toBeLessThanOrEqual(cap);
});
