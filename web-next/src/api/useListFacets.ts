// Счётчики по всей выдаче — данными экрана (SPRINT_UXR_S9_SCALE_OPT/S9-01).
//
// Список kit в сеть не ходит (K-14): он знает форму счётчиков, а откуда они —
// дело приложения. Этот хук и есть «откуда»: экран списка зовёт его и передаёт
// результат в `ListView counts={…}`.
//
// Пока счёт идёт, возвращается `undefined` — и это не «ноль»: список тогда
// считает по загруженным строкам и САМ подписывает числа «по загруженным
// строкам». Отказ приходит значением (`unsupported` / `forbidden` / `failed`),
// потому что «не посчитали» — состояние, которое надо показать.
import { useEffect, useState } from 'react';
import type { LoreCounts } from './loreFacets';
import { fetchFacets } from './loreFacets';
import type { FacetsOptions } from './loreFacets';

export interface UseListFacetsOptions extends Omit<FacetsOptions, 'signal'> {
  /** Раздел без счётчиков — в сеть не ходим вовсе. */
  enabled?: boolean;
}

export function useListFacets(slice: string, opts: UseListFacetsOptions = {}): LoreCounts | undefined {
  const { axes, scopeProjects, params, fetchImpl, enabled = true } = opts;
  const [counts, setCounts] = useState<LoreCounts | undefined>(undefined);
  // Ключи-строки, а не массив и объект: новая ссылка с тем же содержимым — не
  // повод пересчитывать всю выдачу (выбор проектов приходит новым массивом на
  // каждый рендер оболочки).
  const scopeKey = (scopeProjects ?? []).join(',');
  const paramsKey = JSON.stringify(params ?? {});
  const axesKey = JSON.stringify(axes ?? null);
  useEffect(() => {
    if (!enabled) { setCounts(undefined); return; }
    const ctl = new AbortController();
    // Старые числа снимаются сразу: показывать счёт прошлой выдачи рядом с
    // новой — та же неправда, только незаметнее.
    setCounts(undefined);
    fetchFacets(slice, {
      ...(axes ? { axes } : {}),
      ...(scopeKey ? { scopeProjects: scopeKey.split(',') } : {}),
      ...(params ? { params } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
      signal: ctl.signal,
    }).then(
      c => { if (!ctl.signal.aborted) setCounts(c); },
      () => { /* отмена: экран ушёл или выдача перезапрошена */ },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice, axesKey, scopeKey, paramsKey, fetchImpl, enabled]);
  return counts;
}
