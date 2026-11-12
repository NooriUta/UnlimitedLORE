// @vitest-environment jsdom
// ForceEngine (GC-03): ресайз и повторный показ подгоняют рамку (debounced
// refit), хабы (4+ связей) подписаны вне порога зума — после авто-подгонки
// зум ≈ 1, и без хабов граф остаётся безымянным. Canvas 2D в jsdom нет —
// force-graph подменён заглушкой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ForceEngine from './ForceEngine';
import { GX_DEFAULTS, type GxEdge, type GxNode } from './settings';
import type { GxEngineProps } from './engineTypes';

type DrawFn = (n: { id: string; title?: string; x?: number; y?: number }, ctx: { fillText: (t: string, x: number, y: number) => void }, scale: number) => void;

const h = vi.hoisted(() => ({
  instances: [] as {
    el: HTMLElement; zoomToFit: ReturnType<typeof vi.fn>; width: ReturnType<typeof vi.fn>; height: ReturnType<typeof vi.fn>;
    nodeCanvasObjectFn: DrawFn | null;
  }[],
  observers: [] as { fire: () => void }[],
}));

vi.mock('force-graph', () => {
  class MockFg {
    el: HTMLElement;
    zoomToFit = vi.fn(() => this);
    width = vi.fn(() => this);
    height = vi.fn(() => this);
    graphData = vi.fn(() => this);
    backgroundColor = vi.fn(() => this);
    nodeId = vi.fn(() => this);
    nodeLabel = vi.fn(() => this);
    nodeVal = vi.fn(() => this);
    onBackgroundClick = vi.fn(() => this);
    nodeCanvasObjectMode = vi.fn(() => this);
    nodeCanvasObjectFn: DrawFn | null = null;
    nodeCanvasObject = vi.fn((fn: DrawFn) => { this.nodeCanvasObjectFn = fn; return this; });
    onNodeClick = vi.fn(() => this);
    onEngineStop = vi.fn(() => this);
    nodeRelSize = vi.fn(() => this);
    nodeColor = vi.fn(() => this);
    linkColor = vi.fn(() => this);
    linkLineDash = vi.fn(() => this);
    linkWidth = vi.fn(() => this);
    linkDirectionalArrowLength = vi.fn(() => this);
    linkDirectionalArrowRelPos = vi.fn(() => this);
    d3ReheatSimulation = vi.fn(() => this);
    _destructor = vi.fn();
    d3Force = vi.fn((_name: string, force?: unknown) => (force === undefined ? undefined : this));
    constructor(el: HTMLElement) { this.el = el; h.instances.push(this); }
  }
  return { default: MockFg };
});

class MockRO {
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; h.observers.push({ fire: () => this.cb([], this as unknown as ResizeObserver) }); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const N: GxNode[] = [
  { id: 'HUB', type: 'rec', title: 'Центральная запись' },
  { id: 'A', type: 'rec' }, { id: 'B', type: 'rec' }, { id: 'C', type: 'rec' }, { id: 'D', type: 'rec' },
];
const E: GxEdge[] = [
  { from: 'A', to: 'HUB', rel: 'r' }, { from: 'B', to: 'HUB', rel: 'r' },
  { from: 'C', to: 'HUB', rel: 'r' }, { from: 'D', to: 'HUB', rel: 'r' },
];

const props = (): GxEngineProps => ({
  nodes: N, edges: E,
  nodeColor: () => '--acc', edgeColor: () => '--t2', edgeDash: () => null,
  // Порог в крайнее правое положение: 1 → подпись только при scale ≥ 4.
  settings: { ...GX_DEFAULTS, labels: 1 },
  selected: null,
  onSelect: () => {},
  onError: e => { throw e instanceof Error ? e : new Error(String(e)); },
});

const engine = async () => {
  await waitFor(() => expect(h.instances.length).toBeGreaterThan(0));
  return h.instances[h.instances.length - 1];
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockRO);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GC-03 · ForceEngine', () => {
  it('ресайз подгоняет рамку: refit один, с задержкой 200 мс', async () => {
    render(<ForceEngine {...props()} />);
    const g = await engine();
    expect(g.zoomToFit).not.toHaveBeenCalled();
    h.observers[h.observers.length - 1].fire();
    expect(g.width).toHaveBeenCalled();
    expect(g.zoomToFit).not.toHaveBeenCalled();
    // Дергаем ещё раз до истечения таймера — подгонка всё ещё одна.
    await new Promise(r => setTimeout(r, 60));
    h.observers[h.observers.length - 1].fire();
    await new Promise(r => setTimeout(r, 260));
    expect(g.zoomToFit).toHaveBeenCalledTimes(1);
  });

  it('хаб (4+ связей) подписан при зуме 1, лист — нет', async () => {
    render(<ForceEngine {...props()} />);
    const g = await engine();
    const fillText = vi.fn();
    const ctx = { fillText };
    // Зум 1 → scale 1 < labels(1)·4: порог подписей закрыт, хаб — вне его.
    g.nodeCanvasObjectFn!({ id: 'HUB', title: 'Центральная запись', x: 0, y: 0 }, ctx, 1);
    expect(fillText).toHaveBeenCalledWith('Центральная запись', 0, 14);
    g.nodeCanvasObjectFn!({ id: 'A', x: 0, y: 0 }, ctx, 1);
    expect(fillText).toHaveBeenCalledTimes(1);
  });
});
