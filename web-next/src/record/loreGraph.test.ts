// Граф паспорта на серверном GET /lore/graph (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-04, клиент).
// Сервер отдаёт окрестность записи на глубину 1–3 в обе стороны — фасад /lore/record
// давал только один шаг, и глубина 2–3 вкладки ничего не добавляла.
import { describe, expect, it, vi } from 'vitest';
import type { KitData } from '@seidr/kit';
import { depthsOf, fetchLoreGraph, graphNotes, mergeGraph, relsOf, topUpOpen, LORE_GRAPH_TYPES, type LoreGraphBody } from './loreGraph';
import { LORE_KIND_COLOR } from '../shell/loreKinds';

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

  it('связи выбранного типа — параметром rels (обход на сервере строго по ним), глубина до 4', async () => {
    const f = ok(BODY);
    await fetchLoreGraph({ type: 'adr', id: 'A', depth: 4, rels: ['JUSTIFIED_BY', 'DECIDED_IN'] }, f);
    expect(f.mock.calls[0][0]).toBe('/lore/graph?type=adr&id=A&depth=4&rels=JUSTIFIED_BY%2CDECIDED_IN');
  });

  it('типы связей окрестности: rels_available сервера; старый сервер — счёт по рёбрам ответа', () => {
    expect(relsOf({ ...BODY, meta: { ...BODY.meta, rels_available: [{ rel: 'X', count: 9 }] } })).toEqual([{ rel: 'X', count: 9 }]);
    expect(relsOf(BODY)).toEqual([{ rel: 'JUSTIFIED_BY', count: 1 }, { rel: 'PART_OF', count: 1 }]);
  });

  it('глубина узлов для подсветки уровней; строка «Уровни» — из by_depth сервера', () => {
    expect(depthsOf(BODY)).toEqual({ SPRINT_X: 0, 'SPRINT_X/T-1': 1, 'ADR-1': 2 });
    const notes = graphNotes({ ...BODY.meta, by_depth: { 1: 12, 2: 40, 3: 0 } }, 'ru');
    expect(notes).toContain('Уровни: 1 — 12 · 2 — 40 · 3 — 0');
  });

  it('глубина 4 без фильтра упёрлась в потолок — подсказка снять лишние типы связей', () => {
    const cut = { ...BODY.meta, depth: 4, truncated: true, complete: false, capped_at: 500, rels: null };
    expect(graphNotes(cut, 'ru').join('|')).toMatch(/снимите лишние типы связей/);
    expect(graphNotes({ ...cut, rels: ['HAS_TASK'] }, 'ru').join('|')).not.toMatch(/снимите/);
    expect(graphNotes({ ...cut, depth: 3 }, 'ru').join('|')).not.toMatch(/снимите/);
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
      expect(LORE_GRAPH_TYPES('ru')[t]?.color, t).toMatch(/^(--(acc|suc|wrn|dng|inf|t1|t2|t3)|var\(--section-[a-z]+\))$/);
    }
  });

  it('K4-MENTION-LOOK: узел графа — цветом вида, тем же, что упоминание (канон v1)', () => {
    const g = LORE_GRAPH_TYPES('ru');
    for (const [t, c] of Object.entries(LORE_KIND_COLOR)) expect(g[t]?.color, t).toBe(c);
  });
});

// S9-08, препрод 14.11 (ADR-LORE-045): раскрытый кластер обязан показать узлы своего типа.
// Сервер упёрся в потолок — тип догружается отдельным запросом (rels=тип), а не остаётся пустотой.
describe('S9-08 · раскрытие кластера при обрезанной выдаче', () => {
  const KD: KitData = { records: [], edges: [], journal: [], meta: { generated_at: 't' } };
  it('счёт типов по обрезанной окрестности помечен — точным его не считать', () => {
    expect(mergeGraph(KD, { ...BODY, meta: { ...BODY.meta, rels_available_truncated: true } }).meta.graphRelsCut).toBe(true);
    expect(mergeGraph(KD, BODY).meta.graphRelsCut).toBeFalsy();
  });
  it('выдача целая — догружать нечего, запроса нет', async () => {
    const f = ok(BODY);
    const got = await topUpOpen(BODY, ['JUSTIFIED_BY'], { type: 'sprint', id: 'SPRINT_X', depth: 2 }, f);
    expect(f).not.toHaveBeenCalled();
    expect(got).toBe(BODY);
  });
  it('выдача обрезана — раскрытые типы догружаются rels и сливаются без дублей', async () => {
    const cut: LoreGraphBody = { ...BODY, meta: { ...BODY.meta, truncated: true, capped_at: 3 } };
    const more: LoreGraphBody = {
      nodes: [BODY.nodes[0], { id: 'ADR-2', type: 'adr', title: 'Ещё', status: null, status_category: null, depth: 1 }],
      edges: [{ from: 'SPRINT_X', rel: 'JUSTIFIED_BY', to: 'ADR-2' }],
      meta: { complete: true, truncated: false },
    };
    const f = ok(more);
    const got = await topUpOpen(cut, ['JUSTIFIED_BY'], { type: 'sprint', id: 'SPRINT_X', depth: 2 }, f);
    expect(f.mock.calls[0][0]).toBe('/lore/graph?type=sprint&id=SPRINT_X&depth=2&rels=JUSTIFIED_BY');
    expect(got.nodes.map(n => n.id)).toEqual(['SPRINT_X', 'SPRINT_X/T-1', 'ADR-1', 'ADR-2']);
    expect(got.edges).toHaveLength(3);
    // Мета — от основного ответа: неполнота окрестности в целом остаётся названной.
    expect(got.meta.truncated).toBe(true);
  });
});
