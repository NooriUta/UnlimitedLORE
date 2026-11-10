// Одно «неизвестно» на весь kit (SPRINT_UXR_S10_SEIDR_KIT_2/K2-CHAIN-EXPLAIN).
//
// Элементы, которые читают внешние системы, обязаны различать три совершенно
// разных «не знаем», и каждый из них уже назван словами:
//
//  • `unverified` — спросили, но не смогли проверить (источник не ответил);
//  • `forbidden`  — смотреть не дали (прав на просмотр нет);
//  • `unasked`    — НЕ СПРАШИВАЛИ. Это наш выбор, а не отказ источника, и
//    человек по нему делает другое: увидев сбой, идут чинить связь; увидев
//    «не спрашивали» — понимают, что чинить нечего, надо включить источник.
//
// Почему словарь вынесен в отдельный файл, а не продублирован у каждого
// элемента: эти слова читают на одних и тех же экранах доступа. Разойдись они
// («не смогли проверить» у ячейки и «проверка не удалась» у цепочки) — и
// человек начнёт искать разницу там, где её нет. Поэтому ключ локали один, и
// печатает его одна функция: добавить второй словарь теперь дороже, чем
// воспользоваться этим.
import { kitT, type KitLang } from '../i18n';

/** Три вида «неизвестно» — общие для всех элементов kit. */
export type UnknownState = 'unverified' | 'forbidden' | 'unasked';

/** Исход, который ничего не утверждает: причина обязательна там, где молчит. */
export interface UnknownOutcome {
  state: UnknownState;
  /** Почему не знаем — словами от приложения; kit причину не выдумывает. */
  reason?: string;
}

/** Порядок перечисления — от «пробовали» к «не пробовали». */
export const UNKNOWN_STATES: readonly UnknownState[] = ['unverified', 'forbidden', 'unasked'];

export function isUnknownState(state: string): state is UnknownState {
  return (UNKNOWN_STATES as readonly string[]).includes(state);
}

/** Само слово, без причины: когда причину рисуют отдельной строкой. */
export function unknownWord(lang: KitLang, state: UnknownState): string {
  return kitT(lang, `kit.unknown.${state}` as 'kit.unknown.unverified');
}

/** Слово и причина в одну строку: для подсказок и `aria-label`. */
export function sayUnknown(lang: KitLang, state: UnknownState, reason?: string): string {
  const base = unknownWord(lang, state);
  const why = reason?.trim();
  return why ? `${base}: ${why}` : base;
}
