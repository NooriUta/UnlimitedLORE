// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-03 — загрузка ряда burnup/burndown из срезов
// LORE (task_created_dates + task_done_dates) с честным состоянием: ошибка
// любого среза = error, 403 = forbidden, неполная выдача любого = partial.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { BURN_SLICES, inSprint, useSprintBurn } from './useSprintBurn';

const rows = (r: unknown[], extra: object = {}) => ({ rows: r, ...extra });
const CREATED = [{ task_uid: 'S/A', valid_from: '2026-11-01' }, { task_uid: 'S/B', valid_from: '2026-11-02' }];
const DONE = [{ task_uid: 'S/A', valid_from: '2026-11-03' }];

function loader(map: Record<string, unknown | Error>) {
  return vi.fn((slice: string) => {
    const v = map[slice];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
  });
}

describe('inSprint — формат task_uid LORE', () => {
  it('по префиксу с косой чертой: S не цепляет S2', () => {
    expect(inSprint('S')('S/A')).toBe(true);
    expect(inSprint('S')('S2/B')).toBe(false);
  });
});

describe('useSprintBurn', () => {
  it('грузит оба среза и считает ряд спринта', async () => {
    const load = loader({ [BURN_SLICES.created]: rows(CREATED), [BURN_SLICES.done]: rows(DONE) });
    const { result } = renderHook(() => useSprintBurn('S', load));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.points?.[result.current.points.length - 1]).toEqual({ date: '2026-11-03', scope: 2, done: 1, remaining: 1 });
    expect(load.mock.calls.map(c => c[0]).sort()).toEqual(['task_created_dates', 'task_done_dates']);
  });

  it('у спринта нет задач при полной выдаче — проверенный ноль (empty)', async () => {
    const load = loader({ [BURN_SLICES.created]: rows([{ task_uid: 'X/A', valid_from: '2026-11-01' }]), [BURN_SLICES.done]: rows([]) });
    const { result } = renderHook(() => useSprintBurn('S', load));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('ошибка одного среза — error, не «пусто»; onRetry перезапрашивает', async () => {
    const load = loader({ [BURN_SLICES.created]: rows(CREATED), [BURN_SLICES.done]: new Error('HTTP 500') });
    const { result } = renderHook(() => useSprintBurn('S', load));
    await waitFor(() => expect(result.current.state).toBe('error'));
    const before = load.mock.calls.length;
    result.current.onRetry?.();
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(before));
  });

  it('403 — forbidden', async () => {
    const load = loader({ [BURN_SLICES.created]: Object.assign(new Error('nope'), { status: 403 }), [BURN_SLICES.done]: rows(DONE) });
    const { result } = renderHook(() => useSprintBurn('S', load));
    await waitFor(() => expect(result.current.state).toBe('forbidden'));
  });

  it('срез обрезан сервером — partial с полнотой этого среза', async () => {
    const load = loader({ [BURN_SLICES.created]: rows(CREATED, { truncated: true, limit: 2 }), [BURN_SLICES.done]: rows(DONE) });
    const { result } = renderHook(() => useSprintBurn('S', load));
    await waitFor(() => expect(result.current.state).toBe('partial'));
    expect(result.current.completeness).toEqual({ kind: 'capped', shown: 2, limit: 2 });
    expect(result.current.points?.length).toBeGreaterThan(0);
  });
});
