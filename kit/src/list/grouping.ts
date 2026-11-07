// Общая группировка kit (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-06) поверх движка
// списка (listModel): ОДИН ключ группы даёт группы списка, дорожки доски и
// дорожки таймлайна. Ключ — поле записи (`status`, `fields.area`) или разрез
// по связи `rel:<ТИП>` (исходящие: группа = куда ведёт связь) / `rel:<ТИП>:in`
// (входящие: группа = откуда пришла). Разрезы — пресеты: перечислены в
// `config.list.groupings` рядом с полями, подпись — из `config.edges`.
// Контракт ядра (core/contract.ts) не меняется: ключ — та же строка groupings.
//
// Честность: запись в нескольких связанных — в каждой группе (сумма групп
// больше показанного, ListView говорит это вслух); связанная запись не
// загружена — `missing`, подпись не выдумывается; нет связи — группа `none`
// последней; бюджет S9 (топ-N + «Прочие») — как у полей.
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import { LIST_BUDGET, boardColumns, fieldValue, groupRecords, valueKey } from './listModel';
import type { ListGroup } from './listModel';

export type GroupKeySpec =
  | { type: 'none' }
  | { type: 'field'; key: string }
  | { type: 'rel'; edge: string; dir: 'out' | 'in' };

export const REL_PREFIX = 'rel:';

export function parseGroupKey(key: string | null | undefined): GroupKeySpec {
  if (!key) return { type: 'none' };
  if (!key.startsWith(REL_PREFIX)) return { type: 'field', key };
  const [edge, dir] = key.slice(REL_PREFIX.length).split(':');
  if (!edge) return { type: 'none' };
  return { type: 'rel', edge, dir: dir === 'in' ? 'in' : 'out' };
}

export interface RelationPreset {
  key: string;
  edge: string;
  dir: 'out' | 'in';
  /** Подпись из config.edges; тип вне словаря — сам код. */
  label: string;
  unknown?: boolean;
}

export interface GroupingOptions { fields: string[]; relations: RelationPreset[] }

/** Варианты группировки из конфига: поля и пресеты разрезов по связям. */
export function groupingOptions(config: KitConfig): GroupingOptions {
  const fields: string[] = [];
  const relations: RelationPreset[] = [];
  for (const key of config.list?.groupings ?? []) {
    const spec = parseGroupKey(key);
    if (spec.type === 'field') fields.push(key);
    else if (spec.type === 'rel') {
      const e = config.edges?.[spec.edge];
      relations.push({ key, edge: spec.edge, dir: spec.dir, label: e?.label ?? spec.edge, ...(e ? {} : { unknown: true }) });
    }
  }
  return { fields, relations };
}

type Budget = { maxGroups: number; topGroups: number };

/** Связанные записи (их id) для разреза; пусто — связи этого типа нет. */
function relTargets(data: Pick<KitData, 'edges'>, edge: string, dir: 'out' | 'in'): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of data.edges) {
    if (e.type !== edge) continue;
    const [self, other] = dir === 'out' ? [e.from, e.to] : [e.to, e.from];
    const arr = m.get(self);
    if (!arr) m.set(self, [other]);
    else if (!arr.includes(other)) arr.push(other);
  }
  return m;
}

/**
 * Группы по общему ключу. Поле — как groupRecords (статус порядком словаря);
 * разрез по связи — группа на каждую связанную запись, по размеру, «без связи»
 * последней; больше maxGroups — топ-topGroups + «Прочие» (без дублей записей).
 */
export function groupBy(
  records: readonly KitRecord[], key: string | null, config: KitConfig,
  data: Pick<KitData, 'records' | 'edges'>, budget: Budget = LIST_BUDGET,
): ListGroup[] {
  const spec = parseGroupKey(key);
  if (spec.type === 'none') return groupRecords(records, null, config, budget);
  if (spec.type === 'field') return groupRecords(records, spec.key, config, budget);

  const targets = relTargets(data, spec.edge, spec.dir);
  const titles = new Map(data.records.map(r => [r.id, r.title]));
  const map = new Map<string, KitRecord[]>();
  const none: KitRecord[] = [];
  for (const r of records) {
    const ts = targets.get(r.id);
    if (!ts?.length) { none.push(r); continue; }
    for (const t of ts) {
      const arr = map.get(t);
      if (arr) arr.push(r); else map.set(t, [r]);
    }
  }
  let groups: ListGroup[] = [...map].map(([k, rs]) => {
    const title = titles.get(k);
    return title !== undefined ? { key: k, records: rs, title } : { key: k, records: rs, missing: true };
  });
  groups.sort((a, b) => b.records.length - a.records.length || a.key.localeCompare(b.key));
  if (groups.length > budget.maxGroups) {
    const rest = groups.slice(budget.topGroups);
    const seen = new Set<string>();
    const merged = rest.flatMap(g => g.records).filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    groups = [
      ...groups.slice(0, budget.topGroups),
      { key: '\u0000other', records: merged, other: true, groupCount: rest.length },
    ];
  }
  if (none.length) groups.push({ key: '', records: none, none: true });
  return groups;
}

/** Сколько записей попало больше чем в одну группу (сумма групп > показанного). */
export function multiGroupCount(groups: readonly ListGroup[]): number {
  const n = new Map<string, number>();
  for (const g of groups) for (const r of g.records) n.set(r.id, (n.get(r.id) ?? 0) + 1);
  let c = 0;
  for (const v of n.values()) if (v > 1) c++;
  return c;
}

export interface BoardLane { lane: ListGroup; columns: ListGroup[] }

/**
 * Дорожки доски той же группировкой: в каждой — колонки всех статусов словаря.
 * Без группировки или по статусу (он уже колонки) — одна дорожка.
 */
export function boardLanes(
  records: readonly KitRecord[], key: string | null, config: KitConfig,
  data: Pick<KitData, 'records' | 'edges'>, budget: Budget = LIST_BUDGET,
): BoardLane[] {
  const spec = parseGroupKey(key);
  if (spec.type === 'none' || (spec.type === 'field' && spec.key === 'status')) {
    return [{ lane: { key: '', records: [...records] }, columns: boardColumns(records, config) }];
  }
  return groupBy(records, key, config, data, budget).map(lane => ({ lane, columns: boardColumns(lane.records, config) }));
}

export interface TimelineItem { record: KitRecord; start: string; end: string }
export interface TimelineLane { lane: ListGroup; items: TimelineItem[] }
export interface TimelineModel {
  lanes: TimelineLane[];
  /** Без даты начала или с невалидной датой — не на шкале, но и не потеряны. */
  undated: KitRecord[];
  range: { min: string; max: string } | null;
}

/** ISO-дата (YYYY-MM-DD…) или null — «вчера» и мусор на шкалу не попадают. */
function isoDate(v: unknown): string | null {
  const s = valueKey(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = s.slice(0, 10);
  return Number.isNaN(Date.parse(d)) ? null : d;
}

/**
 * Дорожки таймлайна той же группировкой. Нет конца — точка (end = start);
 * конец раньше начала — даты переставляются; без валидного начала — undated.
 */
export function timelineLanes(
  records: readonly KitRecord[], key: string | null, config: KitConfig,
  data: Pick<KitData, 'records' | 'edges'>, fields: { start: string; end?: string },
  budget: Budget = LIST_BUDGET,
): TimelineModel {
  const items = new Map<string, TimelineItem>();
  const undated: KitRecord[] = [];
  let min: string | null = null;
  let max: string | null = null;
  for (const r of records) {
    const s = isoDate(fieldValue(r, fields.start));
    if (!s) { undated.push(r); continue; }
    const e = (fields.end ? isoDate(fieldValue(r, fields.end)) : null) ?? s;
    const [start, end] = e < s ? [e, s] : [s, e];
    items.set(r.id, { record: r, start, end });
    if (min === null || start < min) min = start;
    if (max === null || end > max) max = end;
  }
  const dated = records.filter(r => items.has(r.id));
  const lanes = groupBy(dated, key, config, data, budget).map(lane => ({
    lane, items: lane.records.map(r => items.get(r.id)!),
  }));
  return { lanes, undated, range: min !== null && max !== null ? { min, max } : null };
}
