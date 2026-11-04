// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-07: у загрузки четыре исхода, и «пусто» —
// только один из них. Экран, который на сбое рисует «ничего нет», врёт: данные
// могут существовать, просто их не удалось получить (тот же класс, что у
// KcState в kc-state.ts — там он решён для KC-моста, здесь для слайсов).
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
