// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · хук паспорта: история записи → источник
// вкладки «История» kit (RecordView.history). Загрузка → ok/ошибка/нет прав;
// переход на слайс сказан словами; после возврата история перечитывается.
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { KitLangProvider } from '@seidr/kit';
import { useRecordHistory } from './useRecordHistory';
import type { FetchLike } from './recordHistory';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wrap = ({ children }: { children: ReactNode }) => <KitLangProvider lang="ru">{children}</KitLangProvider>;

const row = (valid_from: string, valid_to: string | null, note_md: string) =>
  ({ valid_from, valid_to, content_hash: null, source_commit: null, status_raw: 'TODO', effort_days: null, note_md });

describe('S5-11 · useRecordHistory', () => {
  it('loading → ok; слайс вместо S2 — честная пометка; restorable по виду', async () => {
    const f: FetchLike = async url => url.startsWith('/lore/history')
      ? new Response('nope', { status: 404 })
      : json(200, { rows: [row('2026-11-06', null, 'b')] });
    const { result } = renderHook(() => useRecordHistory('task', 'S/T-1', { title: 'Задача', fetchImpl: f }), { wrapper: wrap });
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.data?.versions).toHaveLength(1);
    expect(result.current.data?.warnings.join(' ')).toContain('history_task');
    expect(result.current.restorable).toEqual(['note_md', 'effort_days']);
    expect(typeof result.current.onRestore).toBe('function');
  });

  it('403 — forbidden, 500 — error с повтором', async () => {
    const f403: FetchLike = async () => json(403, { error: 'FORBIDDEN' });
    const a = renderHook(() => useRecordHistory('adr', 'ADR-1', { title: 'A', fetchImpl: f403 }), { wrapper: wrap });
    await waitFor(() => expect(a.result.current.state).toBe('forbidden'));

    let n = 0;
    const f500: FetchLike = async () => (++n === 1 ? json(500, { error: 'BOOM' }) : json(200, {
      target: { type: 'adr', id: 'ADR-1', title: null }, tracking: 'scd2', hist_type: 'KnowADRHist', versions: [],
      anomalies: [], page: null, scope: null, outside_scope: null, warnings: [],
    }));
    const b = renderHook(() => useRecordHistory('adr', 'ADR-1', { title: 'A', fetchImpl: f500 }), { wrapper: wrap });
    await waitFor(() => expect(b.result.current.state).toBe('error'));
    act(() => b.result.current.onRetry?.());
    await waitFor(() => expect(b.result.current.state).toBe('ok'));
  });

  it('без права записи (canEdit=false) — onRestore нет: вкладка покажет «только для чтения»', async () => {
    const f: FetchLike = async () => new Response('nope', { status: 404 });
    const { result } = renderHook(() => useRecordHistory('task', 'S/T-1', { title: 'T', canEdit: false, fetchImpl: f }), { wrapper: wrap });
    expect(result.current.onRestore).toBeUndefined();
  });

  it('после успешного возврата история перечитывается (новая версия видна)', async () => {
    let reads = 0;
    const f: FetchLike = async (url, init) => {
      if (init?.method === 'POST') return json(200, { ok: true });
      if (url.startsWith('/lore/history')) return new Response('nope', { status: 404 });
      reads++;
      return json(200, { rows: reads === 1
        ? [row('2026-11-05', '2026-11-06', 'a'), row('2026-11-06', null, 'b')]
        : [row('2026-11-05', '2026-11-06', 'a'), row('2026-11-06', '2026-11-07', 'b'), row('2026-11-07', null, 'a')] });
    };
    const { result } = renderHook(() => useRecordHistory('task', 'S/T-1', { title: 'T', fetchImpl: f }), { wrapper: wrap });
    await waitFor(() => expect(result.current.data?.versions).toHaveLength(2));
    const old = result.current.data!.versions[1];
    await act(async () => {
      await result.current.onRestore!({ record_id: 'S/T-1', version: old, changes: [{ field: 'note_md', from: 'b', to: 'a', change: 'changed' }] });
    });
    await waitFor(() => expect(result.current.data?.versions).toHaveLength(3));
  });
});
