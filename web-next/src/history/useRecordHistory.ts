// Хук паспорта v2 (SPRINT_UXR_S5_RECORD_TASKS/S5-11): история записи →
// источник вкладки «История» kit. Паспорт отдаёт результат в
// <RecordView history={useRecordHistory(kind, id, {title, canEdit})} …/>.
//
// 403 — forbidden (нет прав / вне проектов), прочие сбои — error с повтором;
// переход на SCD2-слайс (S2-03 не выкачен) — предупреждение словами; после
// успешного возврата история перечитывается, чтобы новая версия была видна.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKitLang, type KitHistory, type KitRestoreRequest, type RecordHistorySource } from '@seidr/kit';
import { appT } from '../i18n';
import {
  HistoryHttpError, RESTORABLE, fetchRecordHistory, restoreRecordVersion,
  type HistoryKind, type HistoryOptions,
} from './recordHistory';

export interface UseRecordHistoryOptions extends HistoryOptions {
  /** Текущий заголовок записи — write-API требует его при каждой правке. */
  title: string;
  /** Право правки записи; false — вкладка только для чтения. По умолчанию true. */
  canEdit?: boolean;
}

type Loaded = { state: 'loading' } | { state: 'ok'; data: KitHistory } | { state: 'error' | 'forbidden'; error: unknown };

export function useRecordHistory(kind: HistoryKind, id: string, opts: UseRecordHistoryOptions): RecordHistorySource {
  const lang = useKitLang();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const { fetchImpl, headers, title, canEdit = true } = opts;

  useEffect(() => {
    const ac = new AbortController();
    setLoaded({ state: 'loading' });
    fetchRecordHistory(kind, id, { fetchImpl, headers, signal: ac.signal })
      .then(r => {
        if (ac.signal.aborted) return;
        const data = r.source === 'legacy' && r.slice
          ? { ...r.history, warnings: [appT(lang, 'history.legacySlice', { slice: r.slice }), ...r.history.warnings] }
          : r.history;
        setLoaded({ state: 'ok', data });
      })
      .catch((error: unknown) => {
        if (ac.signal.aborted) return;
        setLoaded({ state: error instanceof HistoryHttpError && error.status === 403 ? 'forbidden' : 'error', error });
      });
    return () => ac.abort();
  }, [kind, id, fetchImpl, headers, lang, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);

  const onRestore = useMemo(() => (canEdit
    ? async (req: KitRestoreRequest) => {
      await restoreRecordVersion(kind, id, req, { title, fetchImpl, headers });
      reload();
    }
    : undefined), [canEdit, kind, id, title, fetchImpl, headers, reload]);

  return {
    ...loaded,
    onRetry: reload,
    restorable: RESTORABLE[kind],
    onRestore,
  };
}
