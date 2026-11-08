// Ось категорий статуса (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Решение владелицы D-2026-UXR-STATUS-AXIS: ось одна, шесть значений.
// Бэкенд отдаёт её в статусной статье модели (D-2026-LORE-MODEL-STATUS-ENTRIES)
// и не сужает; kit тоже не сужает — иначе потеря произойдёт молча.
//
// Зачем отдельное «действует». В прежней оси kit его не было, и принятый ADR
// схлопывался в «завершено». Но «принято и действует» и «сделано и закрыто» —
// разные вещи: по первому живут, второе лежит в архиве. Если ADR в интерфейсе
// выглядит завершённым, его перестают считать обязательным.

/** Ось в порядке жизненного цикла; unknown — последней. */
export const LORE_STATUS_AXIS = [
  'not_started', 'in_progress', 'in_force', 'finished', 'withdrawn', 'unknown',
] as const;

export type LoreStatusCategory = (typeof LORE_STATUS_AXIS)[number];

/**
 * Прежние четыре значения kit → ось. Нужно, чтобы конфиги, написанные до
 * решения, продолжали работать.
 *
 * `in_force` здесь намеренно отсутствует: вывести «действует» из старых
 * значений нельзя, его можно только прислать. Придумать его — значит
 * выдумать смысл, которого в старых данных не было.
 */
const LEGACY: Readonly<Record<string, LoreStatusCategory>> = {
  todo: 'not_started',
  planned: 'not_started',
  backlog: 'not_started',
  active: 'in_progress',
  review: 'in_progress',
  done: 'finished',
  closed: 'finished',
  cancelled: 'withdrawn',
};

export function isAxisCategory(v: unknown): v is LoreStatusCategory {
  return typeof v === 'string' && (LORE_STATUS_AXIS as readonly string[]).includes(v);
}

/**
 * Значение к оси. Незнакомое — `unknown`, а не «завершено»: сбой данных
 * должен быть виден, а не выглядеть закрытой записью.
 */
export function normalizeAxisCategory(v: unknown): LoreStatusCategory {
  if (typeof v !== 'string') return 'unknown';
  const s = v.trim().toLowerCase();
  if (isAxisCategory(s)) return s;
  return LEGACY[s] ?? 'unknown';
}

/**
 * Закрытая ли категория — для «показывать закрытые» (S4-27).
 *
 * «Действует» закрытым НЕ считается: принятый ADR живой, и прятать его
 * вместе с завершёнными нельзя. `unknown` тоже не прячем — непонятное
 * должно оставаться на виду.
 */
export function isClosedCategory(c: LoreStatusCategory): boolean {
  return c === 'finished' || c === 'withdrawn';
}
