// GC-02 · замер для SPEC-LORE-GRAPH-VIEWS §10: «Структура» (React Flow + ELK в воркере)
// на подставных графах разного объёма. Меряем: время до карточек узлов и самую длинную
// задачу главного потока (PerformanceObserver longtask) за время раскладки. Цель
// воркера — раскладка не блокирует главный поток; длинные задачи остаются только от
// отрисовки React Flow. Числа печатаются строкой GC02-MEASURE для отчёта.
// 13.11.2026 (desktop-1280, dev-сервер): 61 узел — до карточек 0,39–0,44 с, длинных задач
// главного потока 1–2, самая длинная 50–59 мс; плашки «не уложилась» нет.
import { expect, test } from '@playwright/test';

const SIZES = [100, 300, 600];

for (const n of SIZES) {
  test(`замер «Структуры»: ${n} узлов`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1280', 'одна проекция');
    test.setTimeout(90_000);
    const C = 'SPRINT_M';
    const kinds = ['task', 'adr', 'spec', 'release'];
    // Все узлы — соседи записи, у каждого своя связь: иначе соседи одного вида и связи
    // сворачиваются в кластер-хаб (PU-11), и раскладке нечего считать. Паспорт режет
    // соседей пределом config.graph.limit (у LORE — 60): замер 13.11 — 61 узел при любом n.
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `N-${i}`, type: kinds[i % 4], title: `Узел ${i}`, status: null, status_category: null, depth: 1 + (i % 3) }));
    const edges = nodes.map((x, i) => ({ from: C, rel: `R_${i}`, to: x.id }))
      .concat(nodes.filter((_, i) => i % 7 === 0 && i > 10).map((x, i) => ({ from: `N-${i}`, rel: 'RELATES', to: x.id })));
    const graph = {
      nodes: [{ id: C, type: 'sprint', title: 'Замер', status: null, status_category: null, depth: 0 }, ...nodes],
      edges, meta: { complete: true, truncated: false, depth: 3 },
    };
    await page.addInitScript(() => {
      (window as unknown as { __long: number[][] }).__long = [];
      new PerformanceObserver(l => { for (const e of l.getEntries()) (window as unknown as { __long: number[][] }).__long.push([e.startTime, e.duration]); })
        .observe({ type: 'longtask', buffered: true });
    });
    await page.route('**/lore/**', async route => {
      const p = new URL(route.request().url()).pathname;
      const name = p.split('/').pop();
      const body = p.endsWith('/lore/graph') ? graph
        : name === 'sprints' ? { rows: [{ sprint_id: C, name: 'Замер', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-01T00:00:00Z' }] }
        : p.includes('/slice/') ? { rows: [] } : {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/?sec=sprint&open=${C}&tab=graph&gview=structure&place=full`);
    const stage = page.getByTestId('gx-structure');
    await expect(stage).toBeVisible({ timeout: 30_000 });
    const t0 = await page.evaluate(() => performance.now());
    await expect(stage.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 });
    const t1 = await page.evaluate(() => performance.now());
    const shown = await stage.locator('.react-flow__node').count();
    const slow = await page.getByTestId('gx-layout-slow').count();
    // Только задачи с начала показа холста: загрузка страницы в замер не входит.
    const long = (await page.evaluate(() => (window as unknown as { __long: number[][] }).__long)).filter(([st]) => st >= t0).map(([, d]) => d);
    const max = long.length ? Math.max(...long) : 0;
    const sum = long.reduce((a, b) => a + b, 0);
    console.log(`GC02-MEASURE n=${n} toNodesMs=${Math.round(t1 - t0)} rendered=${shown} slowBanner=${slow} longtasks=${long.length} maxLongMs=${Math.round(max)} sumLongMs=${Math.round(sum)}`);
    expect(shown).toBeGreaterThan(0);
  });
}
