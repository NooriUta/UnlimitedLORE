// Общее у графиков пачек 19.11.2026: загрузчик среза, честные состояния для ChartCommon kit.
import { completeness, metaOf, rowsOf, type LoadResult } from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import type { AppKey } from '../i18n';

/** Загрузчик среза — тело /lore/slice/{slice}; подменяется в тестах. */
export type ChartLoader = (slice: string, params: Record<string, string>, signal: AbortSignal) => Promise<unknown>;

export function chartLoader(load?: ChartLoader, fetchImpl?: typeof fetch): ChartLoader {
  if (load) return load;
  const f = sliceFetcher(fetchImpl ? { fetchImpl } : {});
  return (s, p, signal) => f(s, p, signal);
}

type T = (k: AppKey, v?: Record<string, string | number>) => string;

/** Сбой и «нет прав» — словами с причиной и «Повторить»; загрузка — скелет kit. */
export function chartState(t: T, res: Pick<LoadResult<unknown>, 'state' | 'error' | 'reload'>) {
  const loading = res.state === 'loading';
  const failed = res.state === 'error' || res.state === 'forbidden';
  const reason = res.error instanceof Error ? res.error.message : String(res.error ?? '');
  return {
    loading,
    ...(failed ? { error: t(res.state === 'forbidden' ? 'analytics.forbidden' : 'analytics.error', { reason }), onRetry: res.reload } : {}),
  };
}

/** Тело среза неполное (обрезано, страница, непроверенные поля). */
export const isPartial = (body: unknown) => completeness(metaOf(body), (rowsOf(body) ?? []).length).kind !== 'complete';

export const rowsOfBody = <R,>(body: unknown) => (rowsOf(body) ?? []) as R[];

/** «дд.мм» по UTC. */
export const ddmm = (ms: number) => new Date(ms).toISOString().slice(5, 10).split('-').reverse().join('.');
