// Модель listView kit (SPRINT_UXR_S10_SEIDR_KIT/K-03): чистые функции без
// React — фильтр, «Быстро»-счётчики, группы с бюджетом S9, порядок, честное
// «Показано N из M» и состояние в URL. Компонент (ListView.tsx) только рисует.
//
// Бюджет — правила SPRINT_UXR_S9_SCALE_OPT: S9-01 «не больше 50 строк на
// группу · ещё N», S9-02 «при >20 группах — топ-10 + Прочие, свёрнуто».
import type { KitConfig, KitFilter, KitMeta, KitRecord } from '../core/contract';

export const LIST_BUDGET = { perGroup: 50, maxGroups: 20, topGroups: 10 } as const;

const TOP_LEVEL = new Set(['id', 'kind', 'title', 'status', 'updated_at', 'body_md']);

function walk(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Значение поля записи: верхний уровень, `fields.a.b` или голое имя поля. */
export function fieldValue(r: KitRecord, key: string): unknown {
  if (TOP_LEVEL.has(key)) return (r as unknown as Record<string, unknown>)[key];
  const path = key.startsWith('fields.') ? key.slice(7).split('.') : key.split('.');
  return walk(r.fields, path);
}

/** Строковый ключ значения для сравнения и группировки ('' — «нет значения»). */
export function valueKey(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Строка — равенство, массив — любое из; '' совпадает с отсутствующим значением. */
export function matchFilter(r: KitRecord, f: KitFilter): boolean {
  for (const [key, want] of Object.entries(f)) {
    const have = valueKey(fieldValue(r, key));
    const wants = Array.isArray(want) ? want : [want];
    if (!wants.includes(have)) return false;
  }
  return true;
}

/** Все фильтры через И. */
export function applyFilters(records: readonly KitRecord[], filters: readonly KitFilter[]): KitRecord[] {
  const fs = filters.filter(f => Object.keys(f).length > 0);
  return fs.length ? records.filter(r => fs.every(f => matchFilter(r, f))) : [...records];
}

export interface QuickItem { id: string; title: string; filter: KitFilter }

/** Счётчик каждого «Быстро» по выдаче с учётом прочих фильтров. */
export function quickCounts(records: readonly KitRecord[], quick: readonly QuickItem[], base: readonly KitFilter[]): Record<string, number> {
  const pool = applyFilters(records, base);
  const out: Record<string, number> = {};
  for (const q of quick) out[q.id] = pool.filter(r => matchFilter(r, q.filter)).length;
  return out;
}

export interface ListGroup {
  key: string;
  records: KitRecord[];
  /** Статус вне словаря — сбой данных виден, а не прячется в первой категории. */
  unknown?: boolean;
  /** «Прочие»: слитые группы сверх топ-N. */
  other?: boolean;
  groupCount?: number;
}

function statusOrder(config: KitConfig): Map<string, number> {
  return new Map(config.statuses.items.map((s, i) => [s.code, i]));
}

/**
 * Группы по ключу. Статус — порядком словаря (вне словаря — в конце, unknown);
 * прочие ключи — по размеру, при равенстве — по значению. Больше maxGroups —
 * топ-topGroups по размеру + одна группа «Прочие».
 */
export function groupRecords(
  records: readonly KitRecord[], by: string | null, config: KitConfig,
  budget: Pick<typeof LIST_BUDGET, 'maxGroups' | 'topGroups'> = LIST_BUDGET,
): ListGroup[] {
  if (!by) return [{ key: '', records: [...records] }];
  const map = new Map<string, KitRecord[]>();
  for (const r of records) {
    const k = valueKey(fieldValue(r, by));
    const arr = map.get(k);
    if (arr) arr.push(r); else map.set(k, [r]);
  }
  let groups: ListGroup[] = [...map].map(([key, rs]) => ({ key, records: rs }));
  if (by === 'status') {
    const order = statusOrder(config);
    for (const g of groups) if (!order.has(g.key)) g.unknown = true;
    groups.sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity) || a.key.localeCompare(b.key));
    return groups;
  }
  groups.sort((a, b) => b.records.length - a.records.length || a.key.localeCompare(b.key));
  if (groups.length > budget.maxGroups) {
    const rest = groups.slice(budget.topGroups);
    groups = [
      ...groups.slice(0, budget.topGroups),
      { key: '\u0000other', records: rest.flatMap(g => g.records), other: true, groupCount: rest.length },
    ];
  }
  return groups;
}

/** Колонки доски: все статусы словаря (пустые тоже), «вне словаря» — если есть. */
export function boardColumns(records: readonly KitRecord[], config: KitConfig): ListGroup[] {
  const byStatus = new Map(groupRecords(records, 'status', config).map(g => [g.key, g]));
  const cols: ListGroup[] = config.statuses.items.map(s => byStatus.get(s.code) ?? { key: s.code, records: [] });
  for (const g of byStatus.values()) if (g.unknown) cols.push(g);
  return cols;
}

export interface ListSort { key: string; dir: 'asc' | 'desc' }

/** Порядок без мутации входа; статус — порядком словаря. */
export function sortRecords(records: readonly KitRecord[], sort: ListSort | null, config: KitConfig): KitRecord[] {
  const out = [...records];
  if (!sort) return out;
  const order = statusOrder(config);
  const sign = sort.dir === 'desc' ? -1 : 1;
  const cmp = (a: KitRecord, b: KitRecord): number => {
    if (sort.key === 'status') return (order.get(a.status) ?? Infinity) - (order.get(b.status) ?? Infinity);
    const va = fieldValue(a, sort.key);
    const vb = fieldValue(b, sort.key);
    if (typeof va === 'number' && typeof vb === 'number') return va - vb;
    return valueKey(va).localeCompare(valueKey(vb), 'ru', { numeric: true });
  };
  // стабильно: при равенстве — исходный порядок
  return out.map((r, i) => [r, i] as const).sort((a, b) => sign * cmp(a[0], b[0]) || a[1] - b[1]).map(x => x[0]);
}

export type ShownLine =
  | { kind: 'complete'; shown: number; loaded: number; total: number }
  | { kind: 'truncated'; shown: number; loaded: number; total: number }
  | { kind: 'unknown_total'; shown: number; loaded: number };

/**
 * «Показано N из M» по meta (формат K-01). N — подошло под фильтр среди
 * загруженного; M — серверный итог. Выдача обрезана, если так сказал сервер или
 * итог больше загруженного (флаг потеряли — «полной» не верим). Обрезано без
 * итога — M неизвестен и не выдумывается.
 */
export function shownOf(meta: KitMeta | null | undefined, loaded: number, shown: number): ShownLine {
  const total = typeof meta?.total === 'number' ? meta.total : undefined;
  const truncated = meta?.truncated === true || (total !== undefined && total > loaded);
  if (!truncated) return { kind: 'complete', shown, loaded, total: total ?? loaded };
  if (total === undefined) return { kind: 'unknown_total', shown, loaded };
  return { kind: 'truncated', shown, loaded, total };
}

/* ---------- состояние в URL ---------- */

export type ListViewKind = 'list' | 'board' | 'tree';

export interface ListState {
  view: ListViewKind;
  quick: string | null;
  group: string | null;
  sort: ListSort | null;
  filters: Record<string, string[]>;
}

export const DEFAULT_LIST_STATE: ListState = { view: 'list', quick: null, group: null, sort: null, filters: {} };

/** Ключи URL: lv (вид), lq (Быстро), lg (группа), ls (порядок, «-» — убывание), lf (фильтры). */
export const LIST_URL_KEYS = ['lv', 'lq', 'lg', 'ls', 'lf'] as const;

export function writeListState(s: ListState): Record<(typeof LIST_URL_KEYS)[number], string | null> {
  const f = Object.entries(s.filters).filter(([, v]) => v.length > 0);
  return {
    lv: s.view === 'list' ? null : s.view,
    lq: s.quick,
    lg: s.group,
    ls: s.sort ? `${s.sort.dir === 'desc' ? '-' : ''}${s.sort.key}` : null,
    lf: f.length ? JSON.stringify(Object.fromEntries(f)) : null,
  };
}

export function readListState(p: URLSearchParams): ListState {
  const lv = p.get('lv');
  const ls = p.get('ls');
  let filters: Record<string, string[]> = {};
  const lf = p.get('lf');
  if (lf) {
    try {
      const raw = JSON.parse(lf) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        filters = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
          .filter(([, v]) => Array.isArray(v))
          .map(([k, v]) => [k, (v as unknown[]).map(String)]));
      }
    } catch { /* битый URL — фильтр по умолчанию, а не падение экрана */ }
  }
  return {
    view: lv === 'board' || lv === 'tree' ? lv : 'list',
    quick: p.get('lq'),
    group: p.get('lg'),
    sort: ls ? { key: ls.replace(/^-/, ''), dir: ls.startsWith('-') ? 'desc' : 'asc' } : null,
    filters,
  };
}

/* ---------- движок списка v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04) ---------- */

/** Встроенные ключи порядка: есть у любой записи контракта. */
export const BUILTIN_SORT_KEYS = ['title', 'id', 'status', 'updated_at'] as const;

/** Колонки-виджеты: не поле записи, по ним не сортируют. */
const NON_FIELD_COLUMNS = new Set(['select', 'title+id', 'verdict', 'edges_count', 'kind']);

/**
 * Ключи порядка из конфига: встроенные + поля колонок, фильтров и группировок
 * (в этом порядке, без дублей). Экран, показавший колонку «Приоритет», должен
 * уметь по ней упорядочить — без отдельной настройки в каждом экране.
 */
export function sortKeysOf(config: KitConfig): string[] {
  const out: string[] = [...BUILTIN_SORT_KEYS];
  const seen = new Set<string>(out);
  const l = config.list;
  for (const k of [...(l?.columns ?? []), ...(l?.filters ?? []), ...(l?.groupings ?? [])]) {
    if (NON_FIELD_COLUMNS.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * Быстрая иконка «Быстро»: фильтр ровно по одному статусу словаря — иконка
 * этого статуса (одно правило на все экраны, а не иконка в каждом конфиге).
 * Иное — null: приложение может задать свою (проп quickIcons).
 */
export function quickIconOf(q: QuickItem, config: KitConfig): string | null {
  const keys = Object.keys(q.filter);
  if (keys.length !== 1 || keys[0] !== 'status') return null;
  const v = q.filter.status;
  const code = Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v;
  if (code === null || code === undefined) return null;
  return config.statuses.items.find(s => s.code === code)?.icon ?? null;
}
