// Фильтры списков LORE в v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05). Сам фильтр
// — в kit (есть / нет / пусто / не пусто, текст, счётчики — FacetFilter и
// filterModel); здесь только то, что знает про LORE: какие поля слайсов
// фильтруются и какой иконкой рисуется значение (как в прототипе v4).
//
// «Релиз»: у спринтов — release_ids слайса спринтов. Слайсы задач релиза не
// отдают (tasks_of_sprint / all_tasks), поэтому релиз задачи наследуется от
// её спринта на клиенте — новая серверная колонка не нужна.
import { ICON_CANON } from '@seidr/kit';
import { inheritField } from '@seidr/kit';
import type { KitRecord, ValueIcon } from '@seidr/kit';

export const LORE_FILTER_FIELDS = {
  release: 'fields.release_ids',
  component: 'fields.components',
  project: 'fields.git_projects',
  milestone: 'fields.milestone_ids',
  priority: 'fields.priority',
  sprint: 'fields.sprint_id',
} as const;

/** Фасеты списка спринтов (порядок = порядок кнопок). */
export const SPRINT_FILTERS: readonly string[] = [
  'status', LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.project, LORE_FILTER_FIELDS.component,
  LORE_FILTER_FIELDS.milestone, LORE_FILTER_FIELDS.priority,
];

/** Фасеты списка задач: релиз — унаследованный от спринта (tasksWithSprintRelease). */
export const TASK_FILTERS: readonly string[] = [
  'status', LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.priority,
];

const PRIORITY_ICONS: Record<string, ValueIcon> = {
  P0: { icon: ICON_CANON.prioP0, color: 'var(--dng)' },
  P1: { icon: ICON_CANON.prioP1, color: 'var(--wrn)' },
  P2: { icon: ICON_CANON.prioP2, color: 'var(--t2)' },
  P3: { icon: ICON_CANON.prioP3, color: 'var(--t3)' },
};

const FIELD_ICONS: Record<string, ValueIcon> = {
  [LORE_FILTER_FIELDS.release]: { icon: 'open-book', color: 'var(--suc)' },
  [LORE_FILTER_FIELDS.component]: { icon: 'cog', color: 'var(--inf)' },
  [LORE_FILTER_FIELDS.project]: { icon: ICON_CANON.fieldProject, color: 'var(--acc)' },
  [LORE_FILTER_FIELDS.milestone]: { icon: 'crossed-axes', color: 'var(--wrn)' },
  [LORE_FILTER_FIELDS.sprint]: { icon: 'sprint', color: 'var(--acc)' },
};

/**
 * Иконка значения для ListView.valueIcon: undefined — оставить kit (статус и
 * вид — из словаря конфига), null — без иконки (пустое значение).
 */
export function loreValueIcon(key: string, value: string): ValueIcon | null | undefined {
  if (key === 'status' || key === 'kind') return undefined;
  if (!value) return null;
  if (key === LORE_FILTER_FIELDS.priority) return PRIORITY_ICONS[value] ?? { icon: ICON_CANON.prioP2, color: 'var(--t2)' };
  return FIELD_ICONS[key] ?? null;
}

/** Задачи с полем release_ids их спринта; спринта нет в выдаче — релиз пуст, а не выдуман. */
export function tasksWithSprintRelease(tasks: readonly KitRecord[], sprints: readonly KitRecord[]): KitRecord[] {
  return inheritField(tasks, sprints, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.release, 'release_ids');
}
