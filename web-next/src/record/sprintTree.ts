// Паспорт спринта деревом (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TREE-NESTED).
//
// Решение владелицы 10.11.2026: иерархия рисуется деревом с ОДНОРОДНЫМИ
// столбцами — спринт (1) → фаза (2, необязательна) → задача (3). Рисует kit
// (`TreeTable`); здесь только прикладная часть — из ответа /lore/record спринта
// собрать ПЛОСКИЙ список строк `{key, kind, parent}` и состояние уровней.
//
// Откуда что:
//   • корень — сама запись спринта;
//   • фазы — часть `phases` (id = phase_uid);
//   • задачи — часть `tasks`; связь IN_PHASE приходит полем `values.phase_uid`.
//     Фазы нет — родитель задачи спринт: у спринта без фаз задачи встают на
//     второй уровень, у спринта с фазами kit собирает их в группу «вне фаз».
//
// Статус в строке — только у задачи. У фазы он вычисляемый (x/y по задачам, это
// столбец «прогресс»), у спринта — в шапке паспорта рядом; меню статусов в
// дереве — цикл задачи, и чужой ось-статус спринта в нём был бы ложью.
import type { TreeFlatRow, TreeLevel, TreeLevelState } from '@seidr/kit';
import type { LorePart, LoreRecord1 } from './loreRecordContract';

/** Уровни дерева спринта: фаза необязательна. */
export const SPRINT_TREE_LEVELS: readonly TreeLevel[] = [
  { kind: 'sprint' },
  { kind: 'phase', optional: true },
  { kind: 'task' },
];

/** Столбцы — одни на все уровни. */
export const SPRINT_TREE_COLUMNS: readonly string[] = [
  'status', 'fields.code', 'title', 'fields.executor', 'fields.effort', 'fields.progress',
];

export interface SprintTree {
  rows: TreeFlatRow[];
  levelState: Record<string, TreeLevelState>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Часть обрезана — об этом говорит `meta.sources` (из `meta.data_state` сервера: «срез · часть»). */
function truncated(c: LoreRecord1, key: string): boolean {
  return c.meta.sources.some(s => s.state === 'truncated' && (s.block === key || s.block.endsWith(` · ${key}`)));
}

/**
 * Состояние уровня по части. Части НЕТ в ответе — это не «уровня нет»: его не
 * проверяли, поэтому `error`. `none` — только проверенный ноль у необязательного
 * уровня.
 */
function stateOf(c: LoreRecord1, p: LorePart | undefined, optional: boolean): TreeLevelState {
  if (!p) return 'error';
  if (p.state === 'denied') return 'denied';
  if (p.state !== 'ok') return 'error';
  if (truncated(c, p.key)) return 'truncated';
  if (optional && p.items.length === 0) return 'none';
  return 'ok';
}

export function sprintTreeOf(c: LoreRecord1): SprintTree {
  const parts = c.parts ?? [];
  const phasesPart = parts.find(p => p.key === 'phases');
  const tasksPart = parts.find(p => p.key === 'tasks');
  const sid = c.record.id;
  const t = c.facts?.tasks;
  const sprintProgress = t && 'total' in t ? `${t.done}/${t.total}` : null;
  const title = str(c.values.title) ?? c.record.title ?? sid;

  const rows: TreeFlatRow[] = [{
    key: sid, kind: 'sprint', parent: null, title, status: '', code: sid, progress: sprintProgress,
  }];
  const phases = phasesPart?.state === 'ok' ? phasesPart.items : [];
  for (const ph of phases) {
    const v = ph.values ?? {};
    rows.push({
      key: ph.id, kind: 'phase', parent: sid, title: ph.title || ph.id, status: '',
      // PU-22: в «Код» — короткий код фазы с фасада; нет его — uid (не выдумываем).
      code: str(v.code) ?? ph.id, progress: str(v.progress),
    });
  }
  const phaseTitle = new Map(phases.map(ph => [ph.id, ph.title || ph.id]));
  const tasks = tasksPart?.state === 'ok' ? tasksPart.items : [];
  for (const tk of tasks) {
    const v = tk.values ?? {};
    // Фаза названа — родитель она, даже если её в выдаче нет: тогда kit
    // покажет задачу сиротой (обычный спутник denied у фаз), а не выдаст её за
    // задачу «вне фаз».
    const ph = str(v.phase_uid);
    rows.push({
      key: tk.id, kind: 'task', parent: ph ?? sid, title: tk.title || tk.id, status: tk.status ?? '',
      code: str(v.code) ?? tk.id, executor: str(v.executor), effort: typeof v.effort === 'number' ? v.effort : null,
      // Поле для фасета «Фаза» (S4-SPRINT-TASKS-CONTROLS): подписью, а фазы нет
      // в выдаче — её uid как есть (не выдумываем название).
      phase: ph ? phaseTitle.get(ph) ?? ph : null,
    });
  }
  return {
    rows,
    levelState: {
      phase: stateOf(c, phasesPart, true),
      task: stateOf(c, tasksPart, false),
    },
  };
}
