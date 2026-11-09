// Как выглядит статус: ОДИН источник на все виды (S4-STATUS-AXIS-CONFIG).
//
// Слова владелицы 09.11.2026: «статусную модель и иконки к ним по контракту
// несут они, а ты просто обрабатываешь согласно контракту, а то вся работа в
// тебя — ты мне так кит не сделаешь». И следом: «контракты пусть правят другие
// сессии, а тебе пишут что сделать универсального».
//
// ЧТО БЫЛО. У статусных иконок в kit было два источника: словарь приложения
// (`config.statuses`, он же словарь модели) и внутренняя таблица kit
// `statusMeta` с кодами LORE. Чип брал словарь, лента новостей — таблицу.
// Поэтому на проде v1.17.7 иконки статусов в новостях не совпадали с задачами
// и спринтами: это не разные вкусы, а две правды.
//
// ПРАВИЛО. Словарь главнее всегда. Таблица kit — только ЗАПАС на случай
// «словаря нет» (модель недоступна, витрина вне оболочки, код вне справочника),
// и этот случай ПОМЕЧЕН: `source: 'fallback'` плюс причина словами. Вид обязан
// иметь возможность сказать «иконка из запаса», а не выдавать её за данные
// приложения — иначе дыра в справочнике выглядит как замысел.
import { createContext, useContext } from 'react';
import { statusMeta } from '../elements/statusMeta';
import type { KitConfig } from './contract';
import { statusColor } from './statusModel';

export type StatusItems = KitConfig['statuses']['items'];

/**
 * Словарь статусов «для всех, кто рисует статус».
 *
 * Нужен потому, что вид статуса нужен не только там, где есть конфиг: лента
 * новостей, вкладка «Активность» и будущие виды получают данные своим
 * источником, а конфиг до них не доходит. Прокидывать его пропсами через
 * каждый экран означало бы, что однажды кто-то забудет — и этот вид молча
 * уедет на запас kit. Ровно так и случилось с лентой.
 *
 * Провайдер — оболочка (у неё конфиг в руках). Вне оболочки словаря нет, и это
 * честное состояние: `statusLook` помечает оформление как «из запаса».
 */
export const StatusDictCtx = createContext<StatusItems | undefined>(undefined);

/** Словарь статусов текущего приложения; `undefined` — его здесь нет. */
export function useStatusDict(): StatusItems | undefined {
  return useContext(StatusDictCtx);
}

export interface StatusLook {
  /** Слаг иконки: из словаря, иначе из запаса kit. */
  icon: string;
  /** Цвет-токен: из словаря, иначе из запаса; сырой hex не пропускаем. */
  color: string;
  /** Откуда взято оформление: данные приложения или запас kit. */
  source: 'dict' | 'fallback';
  /** Почему пришлось брать запас — словами, для подсказки и для отчёта. */
  why?: string;
}

/** Цвет годен, если это токен темы: сырой hex в тему не пускаем. */
const TOKEN_RE = /^var\(--[A-Za-z][\w-]*\)$/;

/**
 * Оформление статуса по его коду.
 *
 * `items` — словарь приложения (`config.statuses.items`). Не передан — значит
 * словаря на этом экране нет, и это отдельное состояние, а не «пусто».
 */
export function statusLook(code: string | null | undefined, items: StatusItems | undefined): StatusLook {
  const c = (code ?? '').trim();
  const spare = (why: string): StatusLook => {
    const m = statusMeta(c);
    return { icon: m.icon, color: m.color, source: 'fallback', why };
  };
  if (!c) return spare('кода статуса нет — показан общий значок «неизвестно»');
  if (!items || items.length === 0) {
    return spare('словаря статусов на этом экране нет — оформление из запаса kit');
  }
  const item = items.find(s => s.code === c);
  if (!item) return spare(`статуса «${c}» нет в словаре приложения — оформление из запаса kit`);

  const icon = (item.icon ?? '').trim();
  const rawColor = (item.color ?? '').trim();
  // Дыра в справочнике: статус есть, оформления нет. Так на проде выглядят
  // adr-статусы draft и deferred (замер серверной сессии 09.11.2026).
  if (!icon || !rawColor) {
    const what = !icon && !rawColor ? 'без иконки и без цвета' : !icon ? 'без иконки' : 'без цвета';
    const m = statusMeta(c);
    return {
      icon: icon || m.icon,
      color: rawColor ? statusColor(rawColor) : m.color,
      source: 'fallback',
      why: `в словаре приложения статус «${c}» ${what} — оформление из запаса kit`,
    };
  }
  const color = statusColor(rawColor);
  if (!TOKEN_RE.test(color)) {
    return {
      icon,
      color: 'var(--t3)',
      source: 'dict',
      why: `цвет статуса «${c}» не токен темы — показан нейтральным`,
    };
  }
  return { icon, color, source: 'dict' };
}
