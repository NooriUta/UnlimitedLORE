// @vitest-environment jsdom
// GC-02 (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02): договор kit на графовые виды.
//  · вход один — узлы {id,type,title} и рёбра (from, rel, to, kind?); рёбра договора kit
//    (KitEdge: from, type, to) переводятся одним местом, а не каждым экраном;
//  · отрисовщик выбирается по ВИДУ и ОБЪЁМУ, а не по вкусу экрана: React Flow — доска, mind map,
//    структура и правка до ~300 узлов; sigma (WebGL) — больше; «живая» физика — d3-force в воркере
//    поверх sigma; граф знаний до 300 — force-graph;
//  · раскладка не уложилась в N с — сказано словами, а не пустой/висящий холст.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { chooseGraphRenderer, gxEdgesFromKit, REACTFLOW_MAX } from './graphContract';
import { GraphExplorer } from './GraphExplorer';
import type { GxEngineProps } from './engineTypes';

describe('gxEdgesFromKit — рёбра договора kit → рёбра графа', () => {
  it('type становится rel, вид и концы сохраняются', () => {
    expect(gxEdgesFromKit([{ from: 'A', to: 'B', type: 'DEPENDS_ON' }])).toEqual([{ from: 'A', to: 'B', rel: 'DEPENDS_ON' }]);
  });
});

describe('chooseGraphRenderer — по виду и объёму', () => {
  it('доска, mind map, структура до 300 — React Flow', () => {
    for (const view of ['board', 'mindmap', 'structure'] as const) expect(chooseGraphRenderer({ view, nodes: 120 }).renderer).toBe('reactflow');
  });
  it('доска больше 300 — sigma с причиной словами (React Flow не тянет)', () => {
    const r = chooseGraphRenderer({ view: 'board', nodes: REACTFLOW_MAX + 1 });
    expect(r.renderer).toBe('obsidian');
    expect(r.reason).toBe('too-many-for-reactflow');
  });
  it('правка — только React Flow; больше 300 — отказ с причиной, а не тихая подмена', () => {
    expect(chooseGraphRenderer({ view: 'board', nodes: 50, editing: true }).renderer).toBe('reactflow');
    const r = chooseGraphRenderer({ view: 'board', nodes: 500, editing: true });
    expect(r.renderer).toBeNull();
    expect(r.reason).toBe('edit-too-large');
  });
  it('граф знаний: до 300 — force-graph, больше — sigma; «живая» физика — всегда воркер + sigma', () => {
    expect(chooseGraphRenderer({ view: 'knowledge', nodes: 200 }).renderer).toBe('force');
    expect(chooseGraphRenderer({ view: 'knowledge', nodes: 7354 }).renderer).toBe('obsidian');
    expect(chooseGraphRenderer({ view: 'live', nodes: 10 }).renderer).toBe('obsidian');
  });
});

// Движок-заглушка: раскладку завершает по команде теста (или никогда).
let finish: (() => void) | null = null;
vi.mock('./ForceEngine', () => ({ default: (p: GxEngineProps) => { finish = () => p.onLayoutDone?.(); return <div data-testid="eng-force" />; } }));
vi.mock('./ObsidianEngine', () => ({ default: (p: GxEngineProps) => { finish = () => p.onLayoutDone?.(); return <div data-testid="eng-obsidian" />; } }));

describe('раскладка не уложилась в N с — честно словами', () => {
  beforeEach(() => { vi.useFakeTimers(); finish = null; });
  afterEach(() => { vi.useRealTimers(); });
  const nodes = [{ id: 'A', type: 't' }, { id: 'B', type: 't' }];
  const edges = [{ from: 'A', to: 'B', rel: 'R' }];

  it('движок не сообщил о конце раскладки за срок — плашка «не уложилась в 8 с», холст на месте', async () => {
    render(<GraphExplorer nodes={nodes} edges={edges} lang="ru" layoutTimeoutMs={8000} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByTestId('gx-layout-slow').textContent).toMatch(/не уложилась в 8 с/);
    expect(screen.getByTestId('eng-force')).toBeTruthy();
  });
  it('раскладка закончилась вовремя — плашки нет', async () => {
    render(<GraphExplorer nodes={nodes} edges={edges} lang="ru" layoutTimeoutMs={8000} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    act(() => { finish?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.queryByTestId('gx-layout-slow')).toBeNull();
  });
});
