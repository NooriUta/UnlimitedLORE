// Граф паспорта на серверном GET /lore/graph (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04, клиент).
// Сервер отдаёт окрестность записи на глубину 1–3 в обе стороны — фасад /lore/record
// давал только один шаг, и глубина 2–3 вкладки ничего не добавляла.
import { describe, expect, it, vi } from 'vitest';
import type { KitData } from '@seidr/kit';
import { fetchLoreGraph, graphNotes, mergeGraph, LORE_GRAPH_TYPES, type LoreGraphBody } from './loreGraph';

const BODY: LoreGraphBody = {
  nodes: [
    { id: 'SPRINT_X', type: 'sprint', title: 'Спринт X', status: 'active', status_category: 'in_progress', depth: 0 },
    { id: 'SPRINT_X/T-1', type: 'task', title: 'Задача', status: 'done', status_category: 'done', depth: 1 },
    { id: 'ADR-1', type: 'adr', title: 'Решение', status: null, status_category: null, depth: 2 },
  ],
  edges: [
    { from: 'SPRINT_X/T-1', rel: 'PART_OF', to: 'SPRINT_X', kind: 'structural' },
    { from: 'SPRINT_X/T-1', rel: 'JUSTIFIED_BY', to: 'ADR-1' },
  ],
  meta: {
    mode: 'neighborhood', depth: 2, complete: false, truncated: false, capped_at: null, hidden_by_scope: 3,
    dangling: [{ id: 'ADR-1', rel: 'DECIDED_IN', dir: 'in', reason: 'hidden_by_scope', count: 2 }], frontier_edges: 'not_read',
  },
};
const ok = (b: unknown, status = 200) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(b), { status }));

describe('GC-04 · клиент /lore/graph', () => {
  it('запрос — тип, код, глубина и слой структурных связей', async () => {
    const f = ok(BODY);
    await fetchLoreGraph({ type: 'sprint', id: 'SPRINT X/1', depth: 2, structural: true }, f);
    expect(f.mock.calls[0][0]).toBe('/lore/graph?type=sprint&id=SPRINT+X%2F1&depth=2&structural=true');
  });

  it('отказ сервера — код и причина, а не пустой граф', async () => {
    await expect(fetchLoreGraph({ type: 'adr', id: 'X', depth: 1 }, ok({ error: 'OUTSIDE_SCOPE', detail: 'вне проектов' }, 403)))
      .rejects.toThrow(/403 OUTSIDE_SCOPE: вне проектов/);
  });

  it('слияние с данными паспорта: новые записи с типом, названием и статусом; рёбра без дублей', () => {
    const base: KitData = {
      records: [{ id: 'SPRINT_X', kind: 'sprint', title: 'Спринт X', status: 'active', fields: { goal: 'g' } }],
      edges: [{ from: 'SPRINT_X/T-1', to: 'SPRINT_X', type: 'PART_OF' }],
      journal: [], meta: { generated_at: 't' },
    };
    const d = mergeGraph(base, BODY);
    expect(d.records.find(r => r.id === 'SPRINT_X')!.fields).toEqual({ goal: 'g' });
    expect(d.records.find(r => r.id === 'ADR-1')).toMatchObject({ kind: 'adr', title: 'Решение' });
    expect(d.records.find(r => r.id === 'SPRINT_X/T-1')).toMatchObject({ kind: 'task', status: 'done' });
    expect(d.edges).toHaveLength(2);
    expect(d.meta.truncated).toBe(true);
  });

  it('что граф не показывает — словами: края не прочитаны, скрыто скоупом, связи вне выдачи', () => {
    const notes = graphNotes(BODY.meta, 'ru');
    expect(notes.join(' | ')).toMatch(/между узлами .*2.* не показаны/);
    expect(notes.join(' | ')).toMatch(/скрыто правами: 3/i);
    expect(notes.join(' | ')).toMatch(/вне выдачи: 2/i);
    expect(graphNotes({ ...BODY.meta, complete: true, hidden_by_scope: 0, dangling: [], frontier_edges: undefined }, 'ru')).toEqual([]);
  });

  it('типы графа: подпись и цвет-токен у каждого типа LORE, без сырых цветов', () => {
    for (const t of ['sprint', 'task', 'adr', 'spec', 'decision', 'release', 'milestone', 'component', 'project']) {
      expect(LORE_GRAPH_TYPES('ru')[t]?.color, t).toMatch(/^--(acc|suc|wrn|dng|inf|t1|t2|t3)$/);
    }
  });
});
