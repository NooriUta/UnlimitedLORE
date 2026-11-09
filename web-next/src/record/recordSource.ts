// Откуда брать паспорт: боевой фасад `/lore/record` или эмуляция из срезов
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-PASSPORT-LIST, ADR-LORE-048 п. 5).
//
// Фасад — источник по умолчанию. Вместе с ним приходит то, чего в срезах нет
// и быть не может: `record.version` (без неё невозможна защита от затирания,
// SPRINT_UXR_S5_RECORD_TASKS/S5-08), настоящие `perms` (в эмуляции роль зашита)
// и `meta.data_state` по каждому блоку (S4-30).
//
// **Откат на эмуляцию никогда не молчит.** Молчаливый откат — худший исход:
// паспорт выглядит настоящим, версии в нём нет, права зашиты, и человек правит
// запись, считая, что защита работает. Поэтому откат пишет строку `lore.record`
// в состояние данных, и её видно в блоке «Состояние данных».
//
// И наоборот: «записи нет» (404) и «нет прав» (403) — это ОТВЕТЫ о записи, а
// не сбой источника. По ним откатываться нельзя: эмуляция из срезов показала
// бы то, что фасад закрыл проектным скоупом.
import type { KitLang } from '@seidr/kit';
import { RecordForbidden, RecordNotFound, fetchLoreRecord } from '../api/liveRecord';
import { loadPassport, type PassportType } from './passportAdapters';
import { toLoreRecord, type LoreRecord1, type LoreSource } from './loreRecordContract';
import type { SliceBody } from '../api/loreSlice';

type Slice = <T>(name: string, params?: Record<string, string>) => Promise<SliceBody<T>>;

export interface RecordSourceOptions {
  fetchImpl?: typeof fetch;
  /** Часы для `meta.loaded_at` (тесты). */
  now?: () => string;
}

/** Строка состояния про сам фасад: почему паспорт собран на клиенте. */
function facadeRow(reason: string): LoreSource {
  return { block: 'lore.record', state: 'error', reason };
}

/**
 * Паспорт записи: фасад, а при его сбое — эмуляция с названной причиной.
 *
 * Возвращает один и тот же объект контракта в обоих случаях, поэтому
 * `fromLoreRecord` и экраны не знают, откуда он пришёл — кроме `meta.facade`
 * и строки состояния, которые про это честно говорят.
 */
export async function loadRecordContract(
  type: PassportType, id: string, lang: KitLang, slice: Slice, opts: RecordSourceOptions = {},
): Promise<LoreRecord1> {
  const now = opts.now ?? (() => new Date().toISOString());
  let fallbackReason: string;
  try {
    return await fetchLoreRecord(type, id, { fetchImpl: opts.fetchImpl, now });
  } catch (e) {
    // Ответы О ЗАПИСИ наружу как есть: подменять их эмуляцией — значит
    // показать закрытое или несуществующее.
    if (e instanceof RecordNotFound || e instanceof RecordForbidden) throw e;
    fallbackReason = e instanceof Error ? e.message : String(e);
  }
  // Срезы тоже легли — наружу идёт ошибка: полупустой паспорт хуже отказа.
  const emulated = toLoreRecord(await loadPassport(type, id, lang, slice, now()), now(), lang);
  return {
    ...emulated,
    meta: {
      ...emulated.meta,
      facade: 'client-emulated',
      // Строка про фасад идёт ПЕРВОЙ: это причина, по которой всё остальное
      // в этом паспорте собрано на клиенте.
      sources: [facadeRow(`паспорт собран на клиенте: ${fallbackReason}`), ...emulated.meta.sources],
    },
  };
}
