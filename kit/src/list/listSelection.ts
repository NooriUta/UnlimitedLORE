// Модель выделения списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10): чистые
// функции без React. Выбранным считается только показанное — массовое действие
// не должно уйти на запись, которую фильтр спрятал от глаз.
import type { KitRecord } from '../core/contract';

/** Долгое нажатие: время удержания и допуск сдвига пальца (больше — это прокрутка). */
export const LONG_PRESS = { ms: 500, slop: 10 } as const;

/** Выбранные id среди показанных записей — в порядке показа. */
export function visibleSelection(selected: ReadonlySet<string>, shown: readonly KitRecord[]): string[] {
  if (selected.size === 0) return [];
  return shown.filter(r => selected.has(r.id)).map(r => r.id);
}

/** Переключить id; вход не меняется. */
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(selected);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
}

/** «Выбрать все показанные»: всё показанное уже выбрано — снять, иначе выбрать всё показанное. */
export function selectAllShown(selected: ReadonlySet<string>, shown: readonly KitRecord[]): Set<string> {
  const all = shown.length > 0 && shown.every(r => selected.has(r.id));
  return all ? new Set() : new Set(shown.map(r => r.id));
}
