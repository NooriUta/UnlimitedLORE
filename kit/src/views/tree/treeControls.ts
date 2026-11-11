// Фильтр и порядок для дерева (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-SPRINT-TASKS-CONTROLS).
//
// ПРАВИЛО ФИЛЬТРА В ДЕРЕВЕ — одно на все условия (текст, фасеты):
//   • условие судит только записи ПОСЛЕДНЕГО уровня (листья);
//   • запись верхнего уровня видна, если под ней есть подходящий лист: она —
//     контекст находки, и найденный лист стоит под своим родителем;
//   • запись верхнего уровня без подходящих листьев СКРЫТА (не свёрнута);
//   • совпадение в названии верхней записи листья не тянет — иначе условие
//     значило бы на разных уровнях разное.
// Порядок — только у листьев и только внутри своего родителя: иерархию он не
// перестраивает, верхние уровни остаются в порядке источника.
//
// Модель — общая со списком (applyControls = фильтр + порядок ListView), своей
// реализации поиска здесь нет. Предметных имён нет (K-14).
import type { KitConfig, KitRecord } from '../../core/contract';
import { applyControls, controlsActive, type ControlState } from '../../list/ControlBar';
import type { TreeFlatRow, TreeLevel } from './TreeTable';

/** Ряд дерева → запись списка (поля — всё, кроме служебных ключей ряда). */
export function treeRowRecord(row: TreeFlatRow): KitRecord {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'key' || k === 'kind' || k === 'parent' || k === 'title' || k === 'status') continue;
    fields[k] = v;
  }
  return {
    id: row.key,
    kind: row.kind,
    title: typeof row.title === 'string' ? row.title : row.key,
    status: typeof row.status === 'string' ? row.status : '',
    fields,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

/** Вид листьев — последний уровень; уровней нет — листьев нет. */
export function leafKindOf(levels: readonly TreeLevel[]): string | null {
  return levels.length ? levels[levels.length - 1].kind : null;
}

export interface TreeRowsFiltered {
  rows: TreeFlatRow[];
  /** Сколько листьев подошло. */
  shown: number;
  /** Сколько листьев всего. */
  total: number;
}

export function filterTreeRows(
  rows: readonly TreeFlatRow[], levels: readonly TreeLevel[], state: ControlState, config: KitConfig,
): TreeRowsFiltered {
  const leaf = leafKindOf(levels);
  const leaves = leaf ? rows.filter(r => r.kind === leaf) : [];
  const total = leaves.length;
  const filtering = controlsActive(state);
  if (!leaf || (!filtering && !state.sort)) return { rows: [...rows], shown: total, total };

  const kept = applyControls(leaves.map(treeRowRecord), state, config).map(r => r.id);
  const byKey = new Map(rows.map(r => [r.key, r]));
  // Предки подошедших листьев — контекст. Цикл в данных не вешает обход.
  const context = new Set<string>();
  if (filtering) {
    for (const id of kept) {
      let p = byKey.get(id)?.parent ?? null;
      while (p && !context.has(p)) {
        context.add(p);
        p = byKey.get(p)?.parent ?? null;
      }
    }
  }
  const upper = rows.filter(r => r.kind !== leaf && (!filtering || context.has(r.key)));
  // Верхние — в порядке источника, листья — в порядке условия: соседей
  // упорядочивает индекс ряда, поэтому лист встаёт по порядку внутри родителя.
  const out = [...upper, ...kept.map(id => byKey.get(id)!)];
  return { rows: out, shown: kept.length, total };
}
