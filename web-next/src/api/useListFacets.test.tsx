// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-01 — счётчики по всей выдаче как данные экрана.
//
// Список в сеть не ходит (K-14): числа ему передаёт экран. Хук и есть это
// «передаёт»: пока счёт идёт — `undefined` (список честно считает по
// загруженным строкам и так и подписывает), пришло — `ListCounts`, отказ —
// тоже `ListCounts`, а не исключение: «не посчитали» надо показать, а не упасть.
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useListFacets } from './useListFacets';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const axes = { sprint_id: 'fields.sprint' };
const body = { facets: { sprint_id: { values: [{ value: 'S1', count: 240 }], empty: 0, nonempty: 240, total: 240 } }, completeness: 'complete' };

describe('S9-01 · useListFacets', () => {
  it('положительный контроль: пока считается — undefined, потом числа источника', async () => {
    const f = vi.fn(async () => json(body));
    const { result } = renderHook(() => useListFacets('sprints', { axes, fetchImpl: f as unknown as typeof fetch }));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current?.kind).toBe('counted'));
    expect(result.current?.kind === 'counted' && result.current.axes['fields.sprint'].total).toBe(240);
  });

  it('отказ приходит значением, а не исключением: «не посчитали» надо показать', async () => {
    const f = vi.fn(async () => json({ error: 'NOT_FACETABLE', detail: 'срез не фасетится' }, 400));
    const { result } = renderHook(() => useListFacets('docs', { axes, fetchImpl: f as unknown as typeof fetch }));
    await waitFor(() => expect(result.current?.kind).toBe('unsupported'));
  });

  it('сменился выбор проектов — счёт перезапрашивается: прежние числа уже не про эту выдачу', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (u: RequestInfo | URL) => { seen.push(String(u)); return json(body); });
    const { result, rerender } = renderHook(
      ({ proj }: { proj: string[] }) => useListFacets('sprints', { axes, scopeProjects: proj, fetchImpl: f as unknown as typeof fetch }),
      { initialProps: { proj: ['A'] } },
    );
    await waitFor(() => expect(result.current?.kind).toBe('counted'));
    rerender({ proj: ['A', 'B'] });
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toContain('scope_projects=A%2CB');
  });

  it('тот же выбор в новом массиве — повторного запроса нет: ссылка не повод считать заново', async () => {
    const f = vi.fn(async () => json(body));
    const { result, rerender } = renderHook(
      ({ proj }: { proj: string[] }) => useListFacets('sprints', { axes, scopeProjects: proj, fetchImpl: f as unknown as typeof fetch }),
      { initialProps: { proj: ['A'] } },
    );
    await waitFor(() => expect(result.current?.kind).toBe('counted'));
    rerender({ proj: ['A'] });
    await new Promise(r => setTimeout(r, 10));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('выключено — в сеть не ходим вовсе (раздел без счётчиков)', async () => {
    const f = vi.fn(async () => json(body));
    const { result } = renderHook(() => useListFacets('sprints', { axes, enabled: false, fetchImpl: f as unknown as typeof fetch }));
    await new Promise(r => setTimeout(r, 10));
    expect(f).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});
