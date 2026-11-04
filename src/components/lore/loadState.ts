// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07: у загрузки четыре исхода, и «пусто» —
// только один из них. Экран, который на сбое рисует «ничего нет», врёт: данные
// могут существовать, просто их не удалось получить (тот же класс, что у
// KcState в kc-state.ts — там он решён для KC-моста, здесь для слайсов).
import { useCallback, useState } from 'react';
import { describeLoreError } from '../../api/lore';

export type LoadState<T> =
  | { k: 'loading' }
  | { k: 'error'; text: string; status?: number }
  | { k: 'empty' }
  | { k: 'ok'; rows: T[] };

export function loadStateOf<T>(rows: T[] | null, error: unknown): LoadState<T> {
  if (error) {
    const d = describeLoreError(error);
    return { k: 'error', text: d.text, status: d.status };
  }
  if (rows === null) return { k: 'loading' };
  return rows.length === 0 ? { k: 'empty' } : { k: 'ok', rows };
}

// AH-07 (зона 3): сбой списка-кандидатов (пикер, подсказки, селект) — не «пусто».
// Форма остаётся рабочей, но пользователь должен видеть, ЧТО не загрузилось:
// пустой селект «выбрать не из чего» неотличим от «вариантов нет», а связь,
// которую не дали выбрать, молча не появится. Имя списка → текст ошибки.
export function usePickerFailures() {
  const [failed, setFailed] = useState<Record<string, string>>({});
  /** `.catch(fail('компоненты'))` — отмена (abort) сбоем не считается. */
  const fail = useCallback((name: string) => (e: unknown) => {
    const d = describeLoreError(e);
    if (d.kind === 'aborted') return;
    setFailed(f => ({ ...f, [name]: d.text }));
  }, []);
  return [failed, fail] as const;
}
