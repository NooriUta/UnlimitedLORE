// Фильтр «Изменены с … по …» в разделах LORE (SPRINT_UXR_S10_SEIDR_KIT_2/K2-DATE-RANGE).
//
// Kit даёт абстрактный диапазон дат (значение, быстрые периоды, адрес, чип). Всё
// предметное — здесь, в приложении (K-14):
//   · ключ адреса — `changed` (`?changed=2026-11-10..2026-11-11`);
//   · поле времени записи — `updated_at` kit, куда records.ts кладёт `changed_at` среза;
//   · параметры среза — `changed_from` / `changed_to`, мгновения UTC включительно
//     (SPRINT_LORE_MEASURE_TRUTH/MT-MCP-CHANGED-RANGE).
//
// Сервер параметры может ещё не знать: тогда он отвечает 400 «unknown param»,
// мы повторяем запрос без них и отбираем по загруженному — и kit говорит это
// словами. Отказ запоминается на срез, чтобы не спрашивать на каждом шаге.
import { rangeInstants, type DateRangeValue } from '@seidr/kit';
import { LoreApiError } from '../api/loreClient';

/** Ключ диапазона в адресе. */
export const DATE_URL_PARAM = 'changed';
/** Поле отметки времени в записи kit (records.ts: changed_at → updated_at). */
export const DATE_FIELD = 'updated_at';

/** Параметры среза из диапазона; открытая граница не отправляется. */
export function changedParams(v: DateRangeValue, now: string, tz: string): Record<string, string> {
  const r = rangeInstants(v, now, tz);
  return {
    ...(r.from ? { changed_from: r.from } : {}),
    ...(r.to ? { changed_to: r.to } : {}),
  };
}

/** Отказ сервера именно из-за диапазона (параметр неизвестен или срез без времени). */
export function isRangeRejected(e: unknown): boolean {
  return e instanceof LoreApiError && e.status === 400 && /changed_(from|to)/.test(`${e.code} ${e.detail}`);
}

const unsupported = new Set<string>();

/** Срез уже отказал в диапазоне — больше не спрашиваем, отбор по загруженному. */
export const rangeUnsupported = (slice: string): boolean => unsupported.has(slice);
export const markRangeUnsupported = (slice: string): void => { unsupported.add(slice); };
/** Тесты: забыть отказы. */
export const forgetRangeSupport = (): void => { unsupported.clear(); };

