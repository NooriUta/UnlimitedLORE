// Модель фильтров listView (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05): чистые
// функции без React. Условия «есть / нет / пусто / не пусто» по полю (в том
// числе по полю-массиву — «Релиз» = release_ids), текст в ID и названии,
// счётчики значений по выдаче с прочими фильтрами (как в прототипе v4) и
// наследование поля от родителя. Всё на клиенте, по данным слайса.
import type { KitRecord } from '../core/contract';
import { fieldValue, valuesOf } from './listModel';
import type { FilterOp, ListState } from './listModel';

export interface FieldFilter { op: FilterOp; values: string[] }

export interface FilterSet {
  fields: Record<string, FieldFilter>;
  /** Текст в ID или названии; пусто — без текста. */
  text?: string;
}

/** Пусто / не пусто — активны всегда; есть / нет — только с выбранными значениями. */
export function isFilterActive(f: FieldFilter): boolean {
  return f.op === 'empty' || f.op === 'nonempty' || f.values.length > 0;
}

/**
 * Запись под условие поля. «есть» — хотя бы одно из отмеченных ('' среди них —
 * «без значения», совместимо со старым фильтром); «нет» — ни одного из
 * отмеченных; «пусто» / «не пусто» — значения не нужны.
 */
export function matchField(r: KitRecord, key: string, f: FieldFilter): boolean {
  if (!isFilterActive(f)) return true;
  const have = valuesOf(r, key);
  switch (f.op) {
    case 'empty': return have.length === 0;
    case 'nonempty': return have.length > 0;
    case 'not': return !have.some(h => f.values.includes(h));
    case 'any':
    default:
      return have.length === 0 ? f.values.includes('') : have.some(h => f.values.includes(h));
  }
}

function words(q: string | undefined): string[] {
  return (q ?? '').toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Текст в ID или названии: без учёта регистра, все слова должны встретиться. */
export function matchText(r: KitRecord, q: string | undefined): boolean {
  const ws = words(q);
  if (!ws.length) return true;
  const hay = `${r.id} ${r.title ?? ''} ${r.search ?? ''}`.toLocaleLowerCase();
  return ws.every(w => hay.includes(w));
}

/** Все поля — через И, плюс текст. skip — поле, чей фильтр не учитывать (для счётчиков). */
export function applyFilterSet(records: readonly KitRecord[], set: FilterSet, skip?: string): KitRecord[] {
  const fs = Object.entries(set.fields).filter(([k, f]) => k !== skip && isFilterActive(f));
  const hasText = words(set.text).length > 0;
  if (!fs.length && !hasText) return [...records];
  return records.filter(r => fs.every(([k, f]) => matchField(r, k, f)) && (!hasText || matchText(r, set.text)));
}

export interface Facet {
  /** Значения поля со счётчиком, по убыванию счётчика, при равенстве — по значению. */
  values: { value: string; count: number }[];
  empty: number;
  nonempty: number;
  /** Сколько записей в выдаче без своего фильтра. */
  total: number;
}

/**
 * Счётчики поля: по выдаче БЕЗ фильтра этого поля, но с прочими полями и
 * текстом — видно, сколько строк даст каждое значение. Значение с нулём не
 * показывается: под прочими фильтрами его нет.
 */
export function facetOf(records: readonly KitRecord[], set: FilterSet, key: string): Facet {
  const pool = applyFilterSet(records, set, key);
  const m = new Map<string, number>();
  let empty = 0;
  for (const r of pool) {
    const vs = valuesOf(r, key);
    if (!vs.length) empty++;
    for (const v of vs) m.set(v, (m.get(v) ?? 0) + 1);
  }
  const values = [...m].map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru', { numeric: true }));
  return { values, empty, nonempty: pool.length - empty, total: pool.length };
}

/** Состояние списка → набор фильтров: «есть» по умолчанию, пусто / не пусто без значений. */
export function toFilterSet(s: Pick<ListState, 'filters' | 'ops' | 'text'>): FilterSet {
  const fields: Record<string, FieldFilter> = {};
  const keys = new Set([...Object.keys(s.filters), ...Object.keys(s.ops ?? {})]);
  for (const k of keys) {
    const op = s.ops?.[k] ?? 'any';
    const values = op === 'empty' || op === 'nonempty' ? [] : (s.filters[k] ?? []);
    const f = { op, values };
    if (isFilterActive(f)) fields[k] = f;
  }
  return { fields, text: (s.text ?? '').trim() };
}

/** Описание условия словами: «a | b», «нет a», «пусто». */
export function describeFieldFilter(f: FieldFilter, opTitle: Record<FilterOp, string>, valueTitle: (v: string) => string): string {
  if (f.op === 'empty' || f.op === 'nonempty') return opTitle[f.op];
  const vs = f.values.map(valueTitle).join(' | ');
  return f.op === 'not' ? `${opTitle.not} ${vs}` : vs;
}

/**
 * Поле от родителя: ребёнку (задаче) копируется поле родителя (спринта) по
 * ссылке link. Родителя нет в выдаче — поле пустое, а не выдуманное. Вход не
 * мутируется. Пример: релиз задачи = release_ids её спринта — слайс задач
 * релиза не отдаёт, а слайс спринтов отдаёт.
 */
export function inheritField(
  children: readonly KitRecord[], parents: readonly KitRecord[], link: string, parentField: string, as: string,
): KitRecord[] {
  const byId = new Map(parents.map(p => [p.id, p]));
  return children.map(c => {
    const pid = fieldValue(c, link);
    const parent = typeof pid === 'string' ? byId.get(pid) : undefined;
    const v = parent ? fieldValue(parent, parentField) : undefined;
    const value = v === undefined || v === null ? [] : v;
    return { ...c, fields: { ...c.fields, [as]: value } };
  });
}
