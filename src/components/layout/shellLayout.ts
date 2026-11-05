// SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-08 — «где я» в шапке на телефоне.
//
// На узкой шапке (≤720px) выбор проекта не рисовался вовсе — сменить скоуп с
// телефона было нечем; а кнопка глав показывала только иконку пространства, и
// по ней нельзя было понять, в каком разделе находишься.

/** Выбор проекта: в шапке на десктопе, в меню «⋯» на телефоне. */
export const projectPickerInMore = (narrow: boolean) => narrow;

/**
 * Подпись «где я». В Forseti на телефоне — название текущей главы (строки глав
 * нет, а иконка пространства одна на все главы); в остальных случаях —
 * название пространства, как и раньше.
 */
export function whereAmILabel(o: { narrow: boolean; inProjects: boolean; chapter: string; space: string }): string {
  return o.narrow && o.inProjects ? o.chapter : o.space;
}
