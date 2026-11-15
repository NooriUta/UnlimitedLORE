// Оптимистичная смена статуса с откатом (SPRINT_UXR_S10_SEIDR_KIT/K-05).
// Статус меняется на экране сразу; save → Promise; отказ — возврат прежнего
// статуса и текст ошибки (молча «сохранено» не бывает). Пока идёт сохранение,
// вторая смена не принимается — иначе откат первой затёр бы вторую.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KitRecord } from './contract';
import type { KitSaveFn } from './statusSave';
import { publishRecordUpdate } from './recordUpdates';

export interface StatusChangeState {
  status: string;
  pending: boolean;
  /** Причина последнего отказа сохранения; null — отказа не было. */
  error: string | null;
  /** Последний успешный переход (для «Вернуть»); null — возвращать нечего. */
  last: { from: string; to: string } | null;
  change(to: string): Promise<boolean>;
  undo(): Promise<boolean>;
}

export function useStatusChange(record: KitRecord, save: KitSaveFn, onChange?: (to: string) => void): StatusChangeState {
  const [status, setStatus] = useState(record.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ from: string; to: string } | null>(null);
  const busy = useRef(false);
  const current = useRef(record.status);
  current.current = status;
  const recordId = useRef(record.id);

  useEffect(() => {
    if (busy.current) return;
    // S4-18 (приёмка препрода 14.11.2026): приложение после записи перечитывает запись, и приходит
    // ровно тот статус, что мы поставили. Это подтверждение своей смены, а не чужая правка: окно
    // «Вернуть» остаётся. Снимается оно, только если пришёл ДРУГОЙ статус или другая запись.
    if (record.status === current.current && recordId.current === record.id) return;
    recordId.current = record.id;
    setStatus(record.status);
    setLast(null);
  }, [record.id, record.status]);

  const commit = useCallback(
    async (from: string, to: string, isUndo: boolean) => {
      if (busy.current || from === to) return false;
      busy.current = true;
      setPending(true);
      setError(null);
      setStatus(to);
      try {
        await save({ type: 'status', id: record.id, field: 'status', from, to });
        // K5-RECORD-UPDATED-EVENT: сервер принял — все места, где видна запись, обновляют элемент.
        publishRecordUpdate({ id: record.id, field: 'status', value: to });
        setLast(isUndo ? null : { from, to });
        onChange?.(to);
        return true;
      } catch (e) {
        setStatus(from);
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [save, record.id, onChange],
  );

  const change = useCallback((to: string) => commit(current.current, to, false), [commit]);
  const undo = useCallback(
    () => (last ? commit(last.to, last.from, true) : Promise.resolve(false)),
    [commit, last],
  );

  return { status, pending, error, last, change, undo };
}
