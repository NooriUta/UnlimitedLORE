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

// AH-07 (зона 4): экран из пачки срезов. `Promise.all` ронял всё от одного
// сбоя, а `p.catch(() => [])` подменял упавший срез пустым — и экран рисовал
// нули. Здесь каждый срез сам по себе: загруженное — в `values`, упавшее — в
// `failed` (ключ → текст ошибки), и упавшего ключа в `values` НЕТ: «не
// загрузилось» не превращается в «пустой массив». Отмена сбоем не считается.
export interface SettledSlices<T> {
  values: Partial<T>;
  failed: Partial<Record<keyof T & string, string>>;
  /** Исходные ошибки упавших — чтобы отдать странице «выключен»/«недоступен». */
  errors: Partial<Record<keyof T & string, unknown>>;
}

export function settledSlices<T extends Record<string, unknown>>(
  keys: readonly (keyof T & string)[],
  results: readonly PromiseSettledResult<unknown>[],
): SettledSlices<T> {
  const values: Partial<T> = {};
  const failed: Partial<Record<keyof T & string, string>> = {};
  const errors: Partial<Record<keyof T & string, unknown>> = {};
  keys.forEach((k, i) => {
    const r = results[i];
    if (!r) return;
    if (r.status === 'fulfilled') { values[k] = r.value as T[typeof k]; return; }
    const d = describeLoreError(r.reason);
    if (d.kind === 'aborted') return;
    failed[k] = d.text;
    errors[k] = r.reason;
  });
  return { values, failed, errors };
}

/** `Promise.allSettled` по именованным срезам → {@link settledSlices}. */
export async function settleSlices<T extends Record<string, unknown>>(
  promises: { [K in keyof T]: Promise<T[K]> },
): Promise<SettledSlices<T>> {
  const keys = Object.keys(promises) as (keyof T & string)[];
  const results = await Promise.allSettled(keys.map(k => promises[k]));
  return settledSlices<T>(keys, results);
}

/** Первая ошибка уровня страницы («выключен»/«недоступен») среди упавших — её отдают onError. */
export function pageLevelError(errors: Record<string, unknown>): unknown {
  return Object.values(errors).find(e => describeLoreError(e).pageLevel);
}

/** Срезы-хуки (`useMartSlice` и т.п.) → имя → текст ошибки, только упавшие. */
export function sliceFailures(
  slices: Record<string, { error: string | null } | null | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, s] of Object.entries(slices)) if (s?.error) out[name] = s.error;
  return out;
}

// AH-07 (зона 4): «X не найден» рисовался на любой сбой — и на 404, и на обрыве
// сети, и на 500. «Не найден» — только ответ сервера NOT_FOUND; остальное —
// ошибка загрузки (pageLevel — отдать странице: «выключен»/«недоступен»).
export type LoadFailure =
  | { k: 'notFound' }
  | { k: 'error'; text: string; status?: number; pageLevel: boolean };

export function loadFailureOf(err: unknown): LoadFailure | null {
  const d = describeLoreError(err);
  if (d.kind === 'aborted') return null;
  if (d.kind === 'notFound') return { k: 'notFound' };
  return { k: 'error', text: d.text, status: d.status, pageLevel: d.pageLevel };
}
