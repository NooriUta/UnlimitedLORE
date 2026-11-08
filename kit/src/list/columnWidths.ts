// Ширины колонок списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35).
//
// Решение владелицы 08.11.2026: «ширина личная, набор командный». Поэтому
// ширины kit хранит сам, в личном хранилище, и НЕ кладёт в адрес: их много,
// и ссылка выходит нечитаемой (так же в прототипе s4-35-columns.html).
//
// Набор колонок, наоборот, kit только отдаёт наружу — он командный и живёт
// в сохранённом виде.

/** Уже этого колонка нечитаема. Из прототипа владелицы. */
export const MIN_COL_W = 60;

/** Хранилище: подходит SafeStorage kit (откат в память, S4-00f). */
export interface WidthStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type ColumnWidths = Record<string, number>;

const keyOf = (screen: string) => `kit.cols.w.${screen}`;

/**
 * Ширина в допустимых пределах. `undefined` — «ширина не задана»: это не
 * ноль и не ошибка, таблица в этом случае считает ширину сама.
 */
export function clampWidth(col: string, width: number, mins: Readonly<Record<string, number>> = {}): number | undefined {
  if (!Number.isFinite(width)) return undefined;
  return Math.max(mins[col] ?? MIN_COL_W, width);
}

/**
 * Личные ширины раздела. Хранилище чужое и может содержать что угодно —
 * чужие и битые значения отсеиваем молча, но список из-за них не роняем.
 */
export function readWidths(store: WidthStore, screen: string): ColumnWidths {
  const raw = store.get(keyOf(screen));
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: ColumnWidths = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function writeWidths(store: WidthStore, screen: string, widths: ColumnWidths): void {
  store.set(keyOf(screen), JSON.stringify(widths));
}

/**
 * Ширины, которые реально применяются к таблице.
 *
 * На узком экране не применяются вовсе: там список показывается карточками,
 * а навязанные ширины сделали бы его нечитаемым (прототип: «телефон — ширины
 * не применяются»).
 */
export function widthsFor(
  widths: Readonly<ColumnWidths>,
  mins: Readonly<Record<string, number>> = {},
  narrow = false,
): ColumnWidths {
  if (narrow) return {};
  const out: ColumnWidths = {};
  for (const [col, w] of Object.entries(widths)) {
    const v = clampWidth(col, w, mins);
    if (v !== undefined) out[col] = v;
  }
  return out;
}
