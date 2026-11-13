// GC-02: «Структура» во вкладке «Граф» паспорта — React Flow с раскладкой ELK в воркере. Подставная сеть:
// 20 соседей разных типов; узлы видны карточками и раскладка уложилась (плашки «не уложилась» нет).
import { expect, test } from '@playwright/test';

test('«Структура»: узлы карточками по ELK, без плашки «не уложилась»', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  const C = 'SPRINT_STRUCT';
  const kinds = ['task', 'adr', 'spec', 'release'];
  const nb = Array.from({ length: 20 }, (_, i) => ({ id: `N-${i}`, type: kinds[i % 4], title: `Сосед ${i}`, status: null, status_category: null, depth: 1 }));
  const graph = {
    nodes: [{ id: C, type: 'sprint', title: 'Структура', status: null, status_category: null, depth: 0 }, ...nb],
    edges: nb.map((n, i) => ({ from: C, rel: ['HAS_TASK', 'DECIDED_BY', 'DOCUMENTED_IN', 'IN_RELEASE'][i % 4], to: n.id })),
    meta: { complete: true, truncated: false, depth: 1 },
  };
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop();
    const body = p.endsWith('/lore/graph') ? graph
      : name === 'sprints' ? { rows: [{ sprint_id: C, name: 'Структура', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z' }] }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${C}&tab=graph&gview=structure&place=full`);
  const stage = page.getByTestId('gx-structure');
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.locator('.react-flow__node')).toHaveCount(21, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await expect(page.getByTestId('gx-layout-slow')).toHaveCount(0);
  const xs = await stage.locator('.react-flow__node').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().x))).size);
  expect(xs, 'узлы разложены по слоям, а не в одну точку').toBeGreaterThan(1);
  await page.screenshot({ path: 'e2e/.results/graph-structure.png' });
});
