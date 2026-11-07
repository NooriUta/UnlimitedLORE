// Хук честного состояния загрузки (S4-00c): loading|empty|error|forbidden|partial|ok.
// Экран отдаёт функцию загрузки, хук — состояние, данные, строки, полноту и
// reload. Ветвление «что рисовать» — в LoadStateView, а не в каждом экране.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { completeness, deriveLoadState, metaOf, rowsOf } from './loadState';
import type { Completeness, LoadState } from './loadState';

export interface LoadResult<T = unknown> {
  state: LoadState;
  data: T | undefined;
  /** Строки: сам массив-ответ или поле rows тела слайса. */
  rows: readonly unknown[] | undefined;
  error: unknown;
  completeness: Completeness;
  reload: () => void;
}

export interface UseLoadOptions<T> {
  /** Свои строки из ответа (по умолчанию — массив или data.rows). */
  rows?: (data: T) => readonly unknown[] | undefined;
}

/**
 * Строки по умолчанию: массив или data.rows; null — ноль строк (записи нет);
 * одиночный объект без rows (карточка записи) — одна строка. Иначе ответ без
 * строк навсегда остался бы в loading.
 */
function defaultRows(data: unknown): readonly unknown[] {
  if (data === null) return [];
  return rowsOf(data) ?? [data];
}

interface Snapshot<T> {
  loading: boolean;
  data?: T;
  error?: unknown;
}

/**
 * @param load загрузка; signal отменяется при смене deps и размонтировании —
 *             устаревший ответ не перетирает свежий.
 * @param deps от чего зависит запрос (смена = новый запрос, прежние данные
 *             сбрасываются: показывать чужую выдачу под новым запросом — враньё).
 */
export function useLoadState<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  opts: UseLoadOptions<T> = {},
): LoadResult<T> {
  const [tick, setTick] = useState(0);
  const [snap, setSnap] = useState<Snapshot<T>>({ loading: true });
  const lastTick = useRef(tick);

  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    // reload держит прежние строки на экране; новый запрос — нет.
    const isReload = lastTick.current !== tick;
    lastTick.current = tick;
    setSnap(s => (isReload && s.data !== undefined ? { loading: true, data: s.data } : { loading: true }));
    // load — из рендера, запустившего этот эффект, и вызывается сразу: через
    // ref/микрозадачу устаревший эффект позвал бы уже НОВУЮ функцию загрузки.
    let pending: Promise<T>;
    try {
      pending = Promise.resolve(load(ctl.signal));
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending
      .then(
        data => { if (alive) setSnap({ loading: false, data }); },
        error => { if (alive) setSnap({ loading: false, error: error ?? new Error('load failed') }); },
      );
    return () => {
      alive = false;
      ctl.abort();
    };
    // deps задаёт вызывающий — как у useEffect; tick — ручной reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);

  const rows = snap.data === undefined ? undefined : (opts.rows ? opts.rows(snap.data) : defaultRows(snap.data));
  const meta = metaOf(snap.data);
  return {
    state: deriveLoadState({ loading: snap.loading, error: snap.error, rows, meta }),
    data: snap.data,
    rows,
    error: snap.error,
    completeness: completeness(meta, rows?.length ?? 0),
    reload,
  };
}
