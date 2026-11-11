// Модель выделения списка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-10): чистые
// функции без React. Выбранным считается только показанное — массовое действие
// не должно уйти на запись, которую фильтр спрятал от глаз.

/** Долгое нажатие: время удержания и допуск сдвига пальца (больше — это прокрутка). */
export const LONG_PRESS = { ms: 500, slop: 10 } as const;

/** Выбранные id среди показанных записей — в порядке показа. */
export function visibleSelection(selected: ReadonlySet<string>, shown: readonly { id: string }[]): string[] {
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
export function selectAllShown(selected: ReadonlySet<string>, shown: readonly { id: string }[]): Set<string> {
  const all = shown.length > 0 && shown.every(r => selected.has(r.id));
  return all ? new Set() : new Set(shown.map(r => r.id));
}

/**
 * Группа так, как она стоит на экране (S9-06): ключ, её строки, есть ли у неё
 * шапка (а значит, и сворачивание) и, если есть, вторая ступень.
 */
export interface ShownGroup<T extends { id: string }> {
  key: string;
  items: readonly T[];
  /** Есть шапка — группу можно свернуть, и свёрнутая не показана. */
  headed: boolean;
  /** Вторая ступень: строки берутся из подгрупп, у каждой свой ключ сворачивания и потолка. */
  sub?: readonly ShownGroup<T>[];
}

/**
 * Что РЕАЛЬНО стоит на экране — то и есть набор, над которым действуют
 * (S4-10, вынесено из ListView в S9-06, чтобы у списка и вложенных таблиц было
 * ОДНО правило, а не две его копии).
 *
 * Свёрнутая группа и хвост за «ещё N» на экране не стоят — значит, и в
 * действие не уходят. Запись, попавшая в несколько групп (разрезы по связям),
 * на экране одна и уходит один раз.
 */
export function onScreenItems<T extends { id: string }>(
  groups: readonly ShownGroup<T>[],
  isOpen: (key: string) => boolean,
  limitOf: (key: string) => number,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const put = (rs: readonly T[]) => { for (const r of rs) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } };
  const walk = (g: ShownGroup<T>) => {
    if (g.headed && !isOpen(g.key)) return;
    if (g.sub) { for (const sg of g.sub) walk(sg); return; }
    put(g.items.slice(0, limitOf(g.key)));
  };
  for (const g of groups) walk(g);
  return out;
}
