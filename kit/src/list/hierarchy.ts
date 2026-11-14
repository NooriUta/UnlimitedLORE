// Иерархия одного типа строками таблицы (SPRINT_UXR_POLISH_UAT_1113/PU-23, вторая ветка правила
// владелицы 14.11.2026: «…и унифицированно — если это иерархия (ссылка сама на себя однотипных
// объектов)»). Родителя список знает из list.tree.parent — той же настройки, что у вида «Дерево»
// (S4-22); второй настройки нет.
//
// Чистая функция без React: показанные записи (уже отфильтрованные и упорядоченные) → строки в
// порядке «родитель, затем его дети» с глубиной.
//   • Порядок — внутри уровня: соседи идут в том порядке, в каком их поставила сортировка списка.
//   • Фильтр: совпал ребёнок — его предки показываются строками ПУТИ (path), иначе найденное
//     висело бы без контекста; при фильтре всё, что ведёт к найденному, раскрыто.
//   • Честность данных: родителя нет в данных — запись в корне; цикл родителей разрывается, а не
//     вешает построение.
import type { KitRecord } from '../core/contract';

export interface HierarchyRow {
  record: KitRecord;
  /** Глубина: корень — 0. */
  depth: number;
  /** Сколько показанных детей у строки (0 — лист, кнопки раскрытия нет). */
  kids: number;
  /** Дети строки видны. */
  open: boolean;
  /** Строка пути: сама условию не отвечает, показана ради пути до найденного потомка. */
  path: boolean;
}

/** Родитель записи по полю list.tree.parent; список (несколько рёбер) — первый. */
export function parentIdOf(r: KitRecord, field: string): string | null {
  const v = r.fields?.[field];
  const one = Array.isArray(v) ? v[0] : v;
  if (one === null || one === undefined || one === '') return null;
  return String(one);
}

/**
 * @param shown     записи группы после фильтра и сортировки — то, что список показал бы плоско
 * @param all       все загруженные записи: из них берутся предки для строк пути
 * @param expanded  раскрытые строки (адрес, lh)
 * @param filtering выдача сужена условием — путь до найденного раскрыт сам
 */
export function hierarchyRows(
  shown: readonly KitRecord[],
  all: readonly KitRecord[],
  parentField: string,
  expanded: ReadonlySet<string>,
  filtering: boolean,
): HierarchyRow[] {
  const byId = new Map<string, KitRecord>();
  for (const r of shown) if (!byId.has(r.id)) byId.set(r.id, r);
  for (const r of all) if (!byId.has(r.id)) byId.set(r.id, r);

  // Родитель — только существующая запись; цикл разрывается на узле, который его замкнул.
  const parent = new Map<string, string | null>();
  for (const id of byId.keys()) {
    const p = parentIdOf(byId.get(id)!, parentField);
    parent.set(id, p !== null && p !== id && byId.has(p) ? p : null);
  }
  const state = new Map<string, 1 | 2>();
  for (const start of byId.keys()) {
    const path: string[] = [];
    let cur: string | null = start;
    while (cur !== null && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      const p: string | null = parent.get(cur) ?? null;
      if (p !== null && state.get(p) === 1) { parent.set(cur, null); break; }
      cur = p;
    }
    for (const id of path) state.set(id, 2);
  }

  // Видимые: показанные и их предки; место предка — по первому его показанному потомку.
  const shownIds = new Set<string>();
  const rank = new Map<string, number>();
  shown.forEach((r, i) => {
    if (shownIds.has(r.id)) return;
    shownIds.add(r.id);
    let cur: string | null = r.id;
    while (cur !== null) {
      const had = rank.get(cur);
      if (had !== undefined && had <= i) break;
      rank.set(cur, i);
      cur = parent.get(cur) ?? null;
    }
  });

  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of rank.keys()) {
    const p = parent.get(id) ?? null;
    if (p === null) roots.push(id);
    else (kids.get(p) ?? kids.set(p, []).get(p)!).push(id);
  }
  const byRank = (a: string, b: string) => rank.get(a)! - rank.get(b)!;

  const out: HierarchyRow[] = [];
  const walk = (list: string[], depth: number) => {
    list.sort(byRank);
    for (const id of list) {
      const own = kids.get(id) ?? [];
      const isPath = !shownIds.has(id);
      const open = own.length > 0 && (filtering || isPath || expanded.has(id));
      out.push({ record: byId.get(id)!, depth, kids: own.length, open, path: isPath });
      if (open) walk(own, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
