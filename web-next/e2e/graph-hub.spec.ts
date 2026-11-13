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

// S5-10 (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH): граф на 50 связях — пять типов по 10 (ниже потолка
// кластера): все 50 соседей на холсте, ни один узел не за его краем.
test('50 связей: все соседи на холсте и внутри него', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
  const types = ['spec', 'task', 'adr', 'release', 'decision'];
  const rels = ['DOCUMENTED_IN', 'HAS_TASK', 'DECIDED_BY', 'IN_RELEASE', 'REFERENCES'];
  const nodes50 = types.flatMap((t, ti) => Array.from({ length: 10 }, (_, i) => ({ id: `${t.toUpperCase()}-${i}`, type: t, title: `${t} ${i}`, status: null, status_category: null, depth: 1, rel: rels[ti] })));
  const g50 = {
    nodes: [{ id: C, type: 'sprint', title: 'Хаб', status: null, status_category: null, depth: 0 }, ...nodes50.map(({ rel: _r, ...n }) => n)],
    edges: nodes50.map(n => ({ from: C, rel: n.rel, to: n.id })),
    meta: { complete: true, truncated: false, depth: 1, rels_available: rels.map(r => ({ rel: r, count: 10 })) },
  };
  await page.route('**/lore/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const name = p.split('/').pop();
    const body = p.endsWith('/lore/graph') ? g50
      : name === 'sprints' ? { rows: [{ sprint_id: C, name: 'Хаб', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z' }] }
      : p.includes('/slice/') ? { rows: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/?sec=sprint&open=${C}&tab=graph&gview=graph`);
  const svg = page.locator('svg.sk-rec-graph__svg');
  await expect(svg).toBeVisible({ timeout: 20_000 });
  await expect(svg.locator('a[data-node]')).toHaveCount(50);
  const box = (await svg.boundingBox())!;
  const outside = await svg.locator('a[data-node] .sk-rec-graph__dot').evaluateAll((els, b) => els.filter(e => {
    const r = e.getBoundingClientRect();
    return r.left < b.x - 1 || r.right > b.x + b.width + 1 || r.top < b.y - 1 || r.bottom > b.y + b.height + 1;
  }).length, box);
  await svg.screenshot({ path: 'e2e/.results/graph-50.png' });
  expect(outside, 'узлов за краем холста').toBe(0);
});
