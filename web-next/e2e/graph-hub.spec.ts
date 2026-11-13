// Хаб графа (SPRINT_UXR_POLISH_UAT_1113/PU-11): у записи 27 спек (на стенде — компонент FORSETI) — кластер «27 спек ▸»
// целиком внутри холста в «Секторах», и один узел-кластер в Force. Подставная сеть.
import { expect, test, type Page } from '@playwright/test';

const C = 'SPRINT_HUB';
const specs = Array.from({ length: 27 }, (_, i) => ({ id: `SPEC-LORE-${i}`, type: 'spec', title: `Спека ${i}`, status: null, status_category: null, depth: 1 }));
const graph = {
  nodes: [{ id: C, type: 'sprint', title: 'Хаб', status: null, status_category: null, depth: 0 }, ...specs],
  edges: specs.map(s => ({ from: s.id, rel: 'DOCUMENTED_IN', to: C })),
  meta: { complete: true, truncated: false, depth: 1, rels_available: [{ rel: 'DOCUMENTED_IN', count: 27 }] },
};

async function open(page: Page, gview: string) {
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop();
    const body = p.endsWith('/lore/graph') ? graph
      : name === 'sprints' ? { rows: [{ sprint_id: C, name: 'Хаб', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z' }] }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${C}&tab=graph&gview=${gview}`);
}

test('секторы: «27 спек ▸» внутри холста', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  await open(page, 'graph');
  const btn = page.locator('[data-cluster] .sk-rec-graph__cbtn');
  await expect(btn).toHaveText('27 спек ▸', { timeout: 20_000 });
  const svg = await page.locator('svg.sk-rec-graph__svg').boundingBox();
  const b = await btn.boundingBox();
  await page.locator('svg.sk-rec-graph__svg').screenshot({ path: 'e2e/.results/graph-hub-sectors.png' });
  expect(b!.x + b!.width).toBeLessThanOrEqual(svg!.x + svg!.width + 1);
  expect(b!.x).toBeGreaterThanOrEqual(svg!.x - 1);
});
