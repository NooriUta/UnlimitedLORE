// SPRINT_UXR_S10_SEIDR_KIT/K-04 · локальный граф записи: ego + секторы по типу ребра.
import { describe, expect, it } from 'vitest';
import type { KitConfig, KitData, KitEdge, KitRecord } from '../core/contract';
import { egoGraph, edgeColor, toCssColor, typesAround, verdictTone } from './graph';

const rec = (id: string, kind = 'task'): KitRecord => ({ id, kind, title: `T ${id}`, status: 'todo', fields: {} });
const data = (edges: KitEdge[], ids: string[]): KitData => ({
  records: ids.map(i => rec(i)),
  edges,
  journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z' },
});

describe('K-04 · egoGraph', () => {
  const edges: KitEdge[] = [
    { from: 'A', to: 'B', type: 'PREREQ' },
    { from: 'C', to: 'A', type: 'PREREQ' },
    { from: 'A', to: 'D', type: 'SUBTOPIC' },
    { from: 'B', to: 'E', type: 'SUBTOPIC' },
    { from: 'X', to: 'Y', type: 'PREREQ' },
  ];
  const d = data(edges, ['A', 'B', 'C', 'D', 'E', 'X', 'Y']);

  it('глубина 1: только прямые соседи, центр — отдельно', () => {
    const g = egoGraph('A', d, { depth: 1, limit: 50 });
    expect(g.center.id).toBe('A');
    expect(g.nodes.map(n => n.id).sort()).toEqual(['B', 'C', 'D']);
    expect(g.nodes.every(n => n.depth === 1)).toBe(true);
    expect(g.truncated).toBe(false);
    expect(g.total).toBe(3);
  });

  it('направление ребра к центру сохраняется: out/in', () => {
    const g = egoGraph('A', d, { depth: 1, limit: 50 });
    expect(g.nodes.find(n => n.id === 'B')?.dir).toBe('out');
    expect(g.nodes.find(n => n.id === 'C')?.dir).toBe('in');
  });

  it('глубина 2: сосед соседа наследует сектор первого шага', () => {
    const g = egoGraph('A', d, { depth: 2, limit: 50 });
    const e = g.nodes.find(n => n.id === 'E');
    expect(e?.depth).toBe(2);
    expect(e?.sector).toBe('PREREQ'); // через B, ребро A→B типа PREREQ
    expect(g.nodes.some(n => n.id === 'X')).toBe(false);
  });

  it('секторы по типу ребра: по одному на тип, без пересечений и по порядку', () => {
    const g = egoGraph('A', d, { depth: 1, limit: 50 });
    expect(g.sectors.map(s => s.type)).toEqual(['PREREQ', 'SUBTOPIC']);
    expect(g.sectors[0].count).toBe(2);
    expect(g.sectors[0].end).toBeLessThanOrEqual(g.sectors[1].start);
    for (const n of g.nodes) {
      const s = g.sectors.find(x => x.type === n.sector)!;
      expect(n.angle).toBeGreaterThanOrEqual(s.start);
      expect(n.angle).toBeLessThanOrEqual(s.end);
    }
  });

  it('лимит: лишние узлы отрезаются честно — truncated и total', () => {
    const g = egoGraph('A', d, { depth: 2, limit: 2 });
    expect(g.nodes).toHaveLength(2);
    expect(g.truncated).toBe(true);
    expect(g.total).toBe(4);
  });

  it('рёбра только между показанными узлами', () => {
    const g = egoGraph('A', d, { depth: 1, limit: 50 });
    const shown = new Set(['A', ...g.nodes.map(n => n.id)]);
    expect(g.links.every(l => shown.has(l.from) && shown.has(l.to))).toBe(true);
    expect(g.links).toHaveLength(3);
  });

  it('узел вне выборки (нет записи в data.records) помечен, а не выброшен', () => {
    const g = egoGraph('A', data([{ from: 'A', to: 'Z', type: 'PREREQ' }], ['A']), { depth: 1, limit: 10 });
    expect(g.nodes[0]).toMatchObject({ id: 'Z', record: undefined });
  });

  it('детерминирован: одинаковый вход — одинаковые координаты', () => {
    const a = egoGraph('A', d, { depth: 2, limit: 50 });
    const b = egoGraph('A', { ...d, edges: [...d.edges].reverse() }, { depth: 2, limit: 50 });
    expect(b.nodes).toEqual(a.nodes);
  });

  it('без рёбер — пустой граф, не ошибка', () => {
    const g = egoGraph('A', data([], ['A']), { depth: 2, limit: 10 });
    expect(g.nodes).toEqual([]);
    expect(g.sectors).toEqual([]);
  });
});

describe('K-04 · цвета графа — только токены', () => {
  it('--acc и acc → var(--acc); var(...) как есть', () => {
    expect(toCssColor('--acc')).toBe('var(--acc, var(--t3))');
    expect(toCssColor('acc')).toBe('var(--acc, var(--t3))');
    expect(toCssColor('var(--suc)')).toBe('var(--suc)');
    expect(toCssColor(undefined)).toBe('var(--t3)');
  });

  it('цвет типа ребра — из config.edges, неизвестный тип — нейтральный', () => {
    const cfg = { edges: { PREREQ: { label: 'требует', color: '--acc' } } } as unknown as KitConfig;
    expect(edgeColor(cfg, 'PREREQ')).toBe('var(--acc, var(--t3))');
    expect(edgeColor(cfg, 'NOPE')).toBe('var(--t3)');
  });

  it('тон вердикта: всё ок — suc, часть — wrn, мало — dng, нет — t3', () => {
    expect(verdictTone({ score: 5, max: 5, failed: [], hints: [] })).toBe('suc');
    expect(verdictTone({ score: 3, max: 5, failed: ['x'], hints: [] })).toBe('wrn');
    expect(verdictTone({ score: 1, max: 5, failed: ['x'], hints: [] })).toBe('dng');
    expect(verdictTone(undefined)).toBe('t3');
  });
});

describe('S5-10 · egoGraph — фильтр типов рёбер', () => {
  const edges: KitEdge[] = [
    { from: 'A', to: 'B', type: 'PREREQ' },
    { from: 'A', to: 'D', type: 'SUBTOPIC' },
    { from: 'D', to: 'F', type: 'PREREQ' },
  ];
  const d = data(edges, ['A', 'B', 'D', 'F']);

  it('types — обход только по разрешённым рёбрам; через выключенное не идём', () => {
    const g = egoGraph('A', d, { depth: 2, limit: 50, types: new Set(['PREREQ']) });
    expect(g.nodes.map(n => n.id)).toEqual(['B']);
    expect(g.links.every(l => l.type === 'PREREQ')).toBe(true);
  });

  it('без types — все типы, как раньше', () => {
    const g = egoGraph('A', d, { depth: 2, limit: 50 });
    expect(g.nodes.map(n => n.id).sort()).toEqual(['B', 'D', 'F']);
  });

  it('typesAround — типы рёбер в пределах глубины со счётом, без учёта фильтра', () => {
    expect(typesAround('A', d, 2)).toEqual([{ type: 'PREREQ', count: 2 }, { type: 'SUBTOPIC', count: 1 }]);
    expect(typesAround('A', d, 1)).toEqual([{ type: 'PREREQ', count: 1 }, { type: 'SUBTOPIC', count: 1 }]);
  });
});
