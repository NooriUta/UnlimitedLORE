// @vitest-environment jsdom
// GC-02: третий отрисовщик — React Flow с раскладкой ELK в воркере («Структура»: доска, mind map,
// структура до ~300 узлов). В jsdom холста React Flow нет — он и ELK подменены; проверяется договор:
// узлы встают по координатам ELK, конец раскладки сообщается, таймаут даёт сетку без «конца»
// (GraphExplorer покажет плашку), ошибка ELK — словами через onError.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { GxEngineProps } from './engineTypes';
import { GX_DEFAULTS } from './settings';

let layoutResult: unknown = { state: 'ok', positions: { A: { x: 0, y: 0 }, B: { x: 200, y: 80 } } };
vi.mock('./elkLayout', () => ({
  layoutWithElk: vi.fn(async () => layoutResult),
}));
vi.mock('@xyflow/react', () => ({
  ReactFlow: (p: { nodes: { id: string; position: { x: number; y: number }; data: { label: string } }[]; onNodeClick?: (e: unknown, n: { id: string }) => void }) => (
    <div data-testid="rf">
      {p.nodes.map(n => (
        <button key={n.id} type="button" data-pos={`${n.position.x},${n.position.y}`} onClick={e => p.onNodeClick?.(e, n)}>{n.data.label}</button>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
}));
vi.mock('@xyflow/react/dist/style.css', () => ({}));

import ReactFlowEngine from './ReactFlowEngine';

const props = (over: Partial<GxEngineProps> = {}): GxEngineProps => ({
  nodes: [{ id: 'A', type: 't', title: 'Альфа' }, { id: 'B', type: 't' }],
  edges: [{ from: 'A', to: 'B', rel: 'R' }],
  nodeColor: () => 'var(--acc)', edgeColor: () => 'var(--t3)', edgeDash: () => null,
  settings: GX_DEFAULTS, selected: null, onSelect: vi.fn(), onError: vi.fn(), onLayoutDone: vi.fn(),
  ...over,
});

beforeEach(() => { layoutResult = { state: 'ok', positions: { A: { x: 0, y: 0 }, B: { x: 200, y: 80 } } }; });

describe('ReactFlowEngine', () => {
  it('узлы по координатам ELK, подпись — название, конец раскладки сообщён', async () => {
    const p = props();
    await act(async () => { render(<ReactFlowEngine {...p} />); });
    expect(screen.getByRole('button', { name: 'Альфа' }).getAttribute('data-pos')).toBe('0,0');
    expect(screen.getByRole('button', { name: 'B' }).getAttribute('data-pos')).toBe('200,80');
    expect(p.onLayoutDone).toHaveBeenCalled();
  });
  it('щелчок по узлу — выбор', async () => {
    const p = props();
    await act(async () => { render(<ReactFlowEngine {...p} />); });
    fireEvent.click(screen.getByRole('button', { name: 'Альфа' }));
    expect(p.onSelect).toHaveBeenCalledWith('A');
  });
  it('ELK не уложился — узлы сеткой, «конца» нет (плашку ставит GraphExplorer)', async () => {
    layoutResult = { state: 'timeout', ms: 7000 };
    const p = props();
    await act(async () => { render(<ReactFlowEngine {...p} />); });
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(p.onLayoutDone).not.toHaveBeenCalled();
  });
  it('ошибка ELK — onError с причиной', async () => {
    layoutResult = { state: 'error', reason: 'cycle' };
    const p = props();
    await act(async () => { render(<ReactFlowEngine {...p} />); });
    expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('cycle') }));
  });
});
