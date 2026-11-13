// useSprintBurn (SPRINT_UXR_S5_RECORD_TASKS/S5-03): ряд burnup/burndown спринта
// из двух срезов LORE (GET /lore/slice/task_created_dates и task_done_dates —
// те же, что у v1) с честным состоянием для BurnChart. kit не знает, как ходить
// в API (токен, база URL) — загрузчик среза передаёт экран.
//
//   ошибка любого среза → error (403 → forbidden), «пусто» не выдумывается;
//   неполная выдача любого среза (truncated / has_more / непроверенные поля)
//     → partial с полнотой этого среза: график по неполной истории врёт;
//   полная выдача без задач спринта → empty (проверенный ноль).
// K-14 (SPRINT_UXR_S7B_ADMIN/S7B-23_2): хук переехал из kit — срезы, спринт и формат
// task_uid «SPRINT_X/код» — предметность LORE; kit даёт расчёт (burnSeries) и график.
import { useMemo } from 'react';
import {
  burnSeries, completeness, metaOf, rowsOf, useLoadState,
  type BurnPoint, type BurnRow, type Completeness, type LoadState,
} from '@seidr/kit';

export const BURN_SLICES = { created: 'task_created_dates', done: 'task_done_dates' } as const;

/** Загрузчик среза: тело ответа /lore/slice/{slice} (массив или { rows, …метаданные }). */
export type BurnSliceLoader = (slice: string, signal: AbortSignal) => Promise<unknown>;

export interface SprintBurn {
  state: LoadState;
  points?: BurnPoint[];
  error?: unknown;
  completeness?: Completeness;
  onRetry: () => void;
}

/** Задача спринта — по префиксу task_uid с косой чертой: иначе SPRINT_X цеплял бы SPRINT_X2. */
export const inSprint = (sprintId: string) => (taskUid: string) => taskUid.startsWith(`${sprintId}/`);

export function useSprintBurn(sprintId: string, load: BurnSliceLoader): SprintBurn {
  const res = useLoadState(
    signal => Promise.all([load(BURN_SLICES.created, signal), load(BURN_SLICES.done, signal)]),
    [sprintId, load],
    { rows: ([c, d]) => [...(rowsOf(c) ?? []), ...(rowsOf(d) ?? [])] },
  );
  return useMemo<SprintBurn>(() => {
    const base = { onRetry: res.reload };
    if (res.state === 'error' || res.state === 'forbidden') return { ...base, state: res.state, error: res.error };
    if (res.state === 'loading' || !res.data) return { ...base, state: 'loading' };
    const [c, d] = res.data;
    const cRows = (rowsOf(c) ?? []) as BurnRow[];
    const dRows = (rowsOf(d) ?? []) as BurnRow[];
    const incomplete = [completeness(metaOf(c), cRows.length), completeness(metaOf(d), dRows.length)]
      .find(x => x.kind !== 'complete');
    const points = burnSeries(cRows, dRows, inSprint(sprintId));
    if (incomplete) return { ...base, state: 'partial', points, completeness: incomplete };
    return { ...base, state: points.length === 0 ? 'empty' : 'ok', points };
  }, [res.state, res.data, res.error, res.reload, sprintId]);
}
