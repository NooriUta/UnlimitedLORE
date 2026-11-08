// Запись LORE → контракт kit (SPRINT_UXR_S5_RECORD_TASKS/S5-01).
// Паспорта v2 строятся из компонентов kit (RecordView, K-04) на строках
// СУЩЕСТВУЮЩИХ слайсов: спринт — строка слайса спринтов, задачи — строки задач
// спринта. Новых эндпоинтов не нужно. Типы строк — локальная минимальная копия
// полей, которые читает шапка (v1 src/api/lore.ts заморожен и в v2 не
// импортируется, D-2026-UXR-V2-FOLDER-V1-FROZEN).
import { KNOWN_STATUSES, statusMeta, type KitConfig, type KitData, type KitLang, type KitRecord, type RecordFactsSpec } from '@seidr/kit';
import { appT, type AppKey } from '../i18n';
import { planStatusOf } from '../sprints/taskStatus';

export const SPRINT_KIND = 'Sprint';
export const TASK_KIND = 'Task';
/** Ребро «спринт → задача» в X_DATA паспорта. */
export const HAS_TASK = 'HAS_TASK';
/** Имя блока в meta.errors, если задачи спринта не загрузились. */
export const TASKS_BLOCK = 'tasks';

/** Поля строки слайса спринтов, которые читает шапка. */
export interface SprintSliceRow {
  sprint_id: string;
  name: string;
  status_raw: string | null;
  planned_end_date: string | null;
  /** SCD2: дата текущего состояния спринта — это и есть «свежесть». */
  valid_from: string | null;
  context_md?: string | null;
}

/** Поля строки задач спринта, которые читает шапка. */
export interface SprintTaskSliceRow {
  task_id: string;
  title: string | null;
  status_raw: string | null;
  order_index: number;
}

/**
 * Строка-вердикт паспорта спринта: задачи по ребру HAS_TASK, срок —
 * planned_end_date, «задачи x/y» ведёт на вкладку «Задачи» (?tab=tasks).
 */
export const SPRINT_FACTS: RecordFactsSpec = {
  childEdge: HAS_TASK,
  dueField: 'planned_end_date',
  errorBlock: TASKS_BLOCK,
  tasksTab: 'tasks',
};

/** Задача пишется парой «спринт/код»: одинокий код принадлежит многим спринтам. */
export function taskRecordId(sprintId: string, taskId: string): string {
  return `${sprintId}/${taskId}`;
}

type Category = KitConfig['statuses']['items'][number]['category'];

/** Категория kit (todo/active/done/cancelled) из оси статусов v2 (statusMeta). */
function kitCategory(code: string): Category {
  const c = statusMeta(code).category;
  if (c === 'done') return 'done';
  if (c === 'closed') return 'cancelled';
  if (c === 'active' || c === 'review' || c === 'blocked') return 'active';
  return 'todo';
}

/** Статусы LORE для config.statuses: подпись из локали, иконка и цвет — из statusMeta kit. */
export function loreStatuses(lang: KitLang): KitConfig['statuses'] {
  return {
    items: KNOWN_STATUSES.map(code => {
      const m = statusMeta(code);
      return { code, title: appT(lang, `record.status.${code}` as AppKey), category: kitCategory(code), icon: m.icon, color: m.color };
    }),
  };
}

/** Спринт и его задачи → запись и X_DATA для RecordView. Ошибка загрузки задач — в meta.errors. */
export function sprintKitData(
  sprint: SprintSliceRow,
  tasks: readonly SprintTaskSliceRow[] | { error: string },
  generatedAt: string,
): { record: KitRecord; data: KitData } {
  const record: KitRecord = {
    id: sprint.sprint_id,
    kind: SPRINT_KIND,
    title: sprint.name,
    status: planStatusOf(sprint.status_raw),
    fields: { planned_end_date: sprint.planned_end_date },
    body_md: sprint.context_md ?? undefined,
    updated_at: sprint.valid_from ?? undefined,
  };
  const failed = !Array.isArray(tasks);
  const rows = failed ? [] : [...(tasks as readonly SprintTaskSliceRow[])].sort((a, b) => a.order_index - b.order_index);
  const taskRecords: KitRecord[] = rows.map(t => ({
    id: taskRecordId(sprint.sprint_id, t.task_id),
    kind: TASK_KIND,
    title: t.title ?? t.task_id,
    status: planStatusOf(t.status_raw),
    fields: { order_index: t.order_index },
  }));
  return {
    record,
    data: {
      records: [record, ...taskRecords],
      edges: taskRecords.map(t => ({ from: record.id, to: t.id, type: HAS_TASK })),
      journal: [],
      meta: {
        generated_at: generatedAt,
        ...(failed ? { errors: [{ block: TASKS_BLOCK, reason: (tasks as { error: string }).error }] } : {}),
      },
    },
  };
}
