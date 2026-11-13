// GC-02 (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-02): раскладка ELK — только вне главного потока, с настоящей
// отменой и честным таймаутом. Разбор GC-01: в LOOM отмена звала `terminate?.()`, а у ELK метод
// `terminateWorker()` — старые воркеры продолжали считать; таймаут молча давал сетку.
import { describe, expect, it, vi } from 'vitest';
import { elkLayoutOptions, layoutWithElk, type ElkLike } from './elkLayout';

const input = {
  nodes: [{ id: 'A', width: 120, height: 40 }, { id: 'B', width: 120, height: 40 }],
  edges: [{ id: 'A>B', from: 'A', to: 'B' }],
};

function fakeElk(result: Promise<unknown>) {
  const terminateWorker = vi.fn<() => void>();
  const elk: ElkLike = { layout: (() => result) as unknown as ElkLike['layout'], terminateWorker };
  return Object.assign(elk, { terminateWorker });
}

describe('layoutWithElk', () => {
  it('ответ ELK → координаты узлов', async () => {
    const elk = fakeElk(Promise.resolve({ children: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 200, y: 0 }] }));
    const r = await layoutWithElk(input, { elk, timeoutMs: 1000 });
    expect(r).toEqual({ state: 'ok', positions: { A: { x: 0, y: 0 }, B: { x: 200, y: 0 } } });
  });
  it('не уложилась в срок — state «timeout» и воркер остановлен terminateWorker()', async () => {
    vi.useFakeTimers();
    const elk = fakeElk(new Promise(() => {}));
    const p = layoutWithElk(input, { elk, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(600);
    expect(await p).toEqual({ state: 'timeout', ms: 500 });
    expect(elk.terminateWorker).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('отмена — state «aborted», воркер остановлен', async () => {
    const elk = fakeElk(new Promise(() => {}));
    const ac = new AbortController();
    const p = layoutWithElk(input, { elk, timeoutMs: 10_000, signal: ac.signal });
    ac.abort();
    expect(await p).toEqual({ state: 'aborted' });
    expect(elk.terminateWorker).toHaveBeenCalledTimes(1);
  });
  it('ошибка ELK — state «error» с причиной, а не пустой холст', async () => {
    const elk = fakeElk(Promise.reject(new Error('cycle')));
    expect(await layoutWithElk(input, { elk, timeoutMs: 1000 })).toEqual({ state: 'error', reason: 'cycle' });
  });
});

describe('elkLayoutOptions — по числу узлов (пороги LOOM 500/700, GC-01)', () => {
  it('маленький граф — layered с полным уточнением; большой — быстрее, без лишних проходов', () => {
    const small = elkLayoutOptions(50);
    const big = elkLayoutOptions(800);
    expect(small['elk.algorithm']).toBe('layered');
    expect(big['elk.algorithm']).toBe('layered');
    expect(Number(big['elk.layered.thoroughness'])).toBeLessThan(Number(small['elk.layered.thoroughness']));
  });
});
