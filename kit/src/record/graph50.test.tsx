// @vitest-environment jsdom
// S5-10 (SPRINT_UXR_S12_KIT3_VOLVA_GRAPH): граф на 50 связях. Замер в браузере 13.11: 50 соседей
// на кольце радиусом 96 px — 12 px на узел, подписи узлов слиплись, а 50 подписей связей
// собрались кашей вокруг центра.
//  · радиус кольца растёт с числом соседей на нём — у узла не меньше ~26 px дуги;
//  · подписи на рёбрах — только когда их немного (≤12): тип связи и так виден цветом и легендой.
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import { RecordGraph } from './RecordGraph';

const rec = (id: string): KitRecord => ({ id, kind: 'item', title: id, status: 'todo', fields: {} });
const config = {
  modules: [], menu: { groups: [] }, kinds: { item: { title: 'П', icon: 'quill', fields: [] } },
  statuses: { items: [{ code: 'todo', title: 'т', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  edges: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(t => [t, { label: `связь ${t}`, color: 'var(--acc)' }])),
  graph: { depth: 1 as const, limit: 1000 },
} as unknown as KitConfig;
function draw(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges: KitEdge[] = ids.map((id, i) => ({ from: 'ego', to: id, type: ['A', 'B', 'C', 'D', 'E'][i % 5] }));
  const data: KitData = { records: [rec('ego'), ...ids.map(rec)], edges, journal: [], meta: { generated_at: 'x', total: n + 1 } };
  const ctx = { config, data, href: (id: string) => `/r/${id}`, role: 'reader', lang: 'ru' } as unknown as KitCtx;
  return render(<RecordGraph record={rec('ego')} ctx={ctx} lang="ru" narrow={false} />);
}
beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('S5-10 · граф на 50 связях читается', () => {
  it('50 соседей: кольцо шире, чем на 10 (на узел не меньше ~26 px дуги)', () => {
    const r = (n: number) => { const { container, unmount } = draw(n); const v = Number(container.querySelector('.sk-rec-graph__ring')!.getAttribute('r')); unmount(); return v; };
    const r50 = r(50);
    expect(r50).toBeGreaterThan(r(10));
    expect((2 * Math.PI * r50) / 50).toBeGreaterThanOrEqual(26);
  });
  it('50 связей — подписей на рёбрах нет; 10 — есть', () => {
    const many = draw(50);
    expect(many.container.querySelectorAll('.sk-rec-graph__edge-label')).toHaveLength(0);
    many.unmount();
    const few = draw(10);
    expect(few.container.querySelectorAll('.sk-rec-graph__edge-label').length).toBeGreaterThan(0);
  });
});
