// Задачи спринта — модель строки, группировка и проверка правки в строке
// (SPRINT_UXR_S5_RECORD_TASKS/S5-02). Без React и без API: экран переводит
// ответ слайса tasks_of_sprint в TaskRowData, таблица рисует готовые группы.
import { STATUS_CATEGORIES, statusMeta, type StatusCategory } from '../elements/statusMeta';

/** Строка задачи — то, что видно в таблице без перехода в паспорт. */
export interface TaskRowData {
  /** task_uid — ключ записи (POST /lore/status и /lore/task/edit пишут по нему). */
  uid: string;
  /** task_id — код задачи (S5-02). */
  id: string;
  title: string | null;
  status: string | null;
  /** phase_uid; null — задача вне фаз. */
  phase: string | null;
  effortDays: number | null;
  executor: string | null;
  reviewer: string | null;
  taskType: string | null;
  /** work_class — класс работы (S4-36): плашка из словаря `work_class`. */
  workClass: string | null;
  /** order_index — порядок в спринте. */
  order: number;
}

export interface TaskPhase {
  uid: string;
  id: string;
  title: string | null;
  order: number;
}

/**
 * Разрезы таблицы задач. `phase_status` (S9-07) — фаза, а внутри неё статусы:
 * на спринте в 200+ задач «что в фазе застряло» иначе ищется глазами.
 * Порядок массива — порядок кнопок; умолчание экрана — «Фаза», первым.
 */
export type TaskGroupBy = 'phase' | 'phase_status' | 'status' | 'none';
export const TASK_GROUP_BYS: readonly TaskGroupBy[] = ['phase', 'phase_status', 'status', 'none'];

export type TaskGroupKind = 'phase' | 'nophase' | 'orphan' | 'status' | 'all';

export interface TaskGroup {
  key: string;
  kind: TaskGroupKind;
  /** Готовая подпись для фазы («P1 · Разведка»); для status/nophase/orphan/all — пусто, подпись локализует таблица. */
  label: string;
  /** Категория статуса — только у kind=status. */
  category?: StatusCategory;
  tasks: TaskRowData[];
  /**
   * Подгруппы по статусу — только у разреза `phase_status`. `tasks` при этом
   * остаётся ПОЛНЫМ составом группы: шапка фазы называет все её задачи.
   */
  subgroups?: TaskGroup[];
}

/**
 * Статусы, которые палитра предлагает задаче, — тот же набор, что v1 даёт
 * сменить в строке задачи (TASK_PICK_TOKENS) и что принимает POST /lore/status.
 */
export const TASK_STATUSES = [
  'todo', 'planned', 'active', 'partial', 'ready_for_deploy', 'uat', 'done', 'blocked', 'cancelled',
] as const;
/**
 * Код статуса задачи.
 *
 * С S4-STATUS-AXIS-CONFIG статусы приходят из конфигурации (а в неё — из
 * модели), поэтому список перестал быть закрытым: `TASK_STATUSES` остались
 * умолчанием, когда конфигурации нет. `string & {}` сохраняет подсказку
 * известных кодов и при этом не врёт, будто других не бывает.
 */
export type TaskStatus = (typeof TASK_STATUSES)[number] | (string & {});

const byOrder = (a: TaskRowData, b: TaskRowData) => a.order - b.order || a.id.localeCompare(b.id);

export function phaseLabel(p: TaskPhase): string {
  return p.title?.trim() ? `${p.id} · ${p.title.trim()}` : p.id;
}

/**
 * Группы задач. Пустые группы не рисуются; задачи без фазы и с фазой, которой
 * нет в списке фаз (сбой данных), не теряются — у них свои группы в конце.
 */
export function groupTasks(tasks: readonly TaskRowData[], by: TaskGroupBy, phases: readonly TaskPhase[]): TaskGroup[] {
  if (tasks.length === 0) return [];
  const sorted = [...tasks].sort(byOrder);
  if (by === 'none') return [{ key: 'all', kind: 'all', label: '', tasks: sorted }];

  if (by === 'status') return byStatus(sorted, '');

  const known = new Map(phases.map(p => [p.uid, p]));
  const groups: TaskGroup[] = [...phases]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(p => ({ key: p.uid, kind: 'phase' as const, label: phaseLabel(p), tasks: sorted.filter(t => t.phase === p.uid) }))
    .filter(g => g.tasks.length > 0);
  const nophase = sorted.filter(t => t.phase == null || t.phase === '');
  const orphan = sorted.filter(t => t.phase != null && t.phase !== '' && !known.has(t.phase));
  if (nophase.length) groups.push({ key: 'nophase', kind: 'nophase', label: '', tasks: nophase });
  if (orphan.length) groups.push({ key: 'orphan', kind: 'orphan', label: '', tasks: orphan });
  if (by === 'phase_status') for (const g of groups) g.subgroups = byStatus(g.tasks, g.key + '/');
  return groups;
}

/** Статусные группы в порядке категорий; ключ с префиксом — уникален внутри фазы. */
function byStatus(sorted: readonly TaskRowData[], prefix: string): TaskGroup[] {
  const buckets = new Map<StatusCategory, TaskRowData[]>();
  for (const t of sorted) {
    const c = statusMeta(t.status).category;
    buckets.set(c, [...(buckets.get(c) ?? []), t]);
  }
  return STATUS_CATEGORIES.filter(c => buckets.has(c)).map(c => ({
    key: prefix + c, kind: 'status' as const, label: '', category: c, tasks: buckets.get(c)!,
  }));
}

/** Черновик правки в строке — как введено в поля. */
export interface TaskDraft {
  title: string;
  effort: string;
}

/**
 * Изменённые поля — то, что уйдёт в POST /lore/task/edit. Ролей здесь нет (PU-17): роль задачи —
 * ребро заявленной личности и меняется только выбором из кандидатов в паспорте задачи.
 */
export interface TaskPatch {
  title?: string;
  effortDays?: number;
}

export type TaskDraftResult =
  | { ok: true; patch: TaskPatch }
  | { ok: false; field: keyof TaskDraft };

export function draftOf(t: TaskRowData): TaskDraft {
  return {
    title: t.title ?? '',
    effort: t.effortDays == null ? '' : String(t.effortDays),
  };
}

/**
 * Проверка черновика. Бэкенд (POST /lore/task/edit) требует непустой title и
 * читает null в остальных полях как «не трогать» — поэтому стереть оценку или
 * роль правкой в строке нельзя, и это честный отказ, а не молчаливый no-op.
 */
export function validateTaskDraft(t: TaskRowData, d: TaskDraft): TaskDraftResult {
  const patch: TaskPatch = {};
  const title = d.title.trim();
  if (!title) return { ok: false, field: 'title' };
  if (title !== (t.title ?? '').trim()) patch.title = title;

  const effortRaw = d.effort.trim().replace(',', '.');
  if (effortRaw === '') {
    if (t.effortDays != null) return { ok: false, field: 'effort' };
  } else {
    const n = Number(effortRaw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, field: 'effort' };
    if (n !== t.effortDays) patch.effortDays = n;
  }

  return { ok: true, patch };
}
