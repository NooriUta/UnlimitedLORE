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

/**
 * Поля фасетов — по ключам ЗАПИСИ, а не по именам столбцов среза.
 *
 * Было наоборот: `fields.release_ids`, `fields.git_projects`,
 * `fields.milestone_ids` — имена из слайсов, а `sprintRecord` пишет `release`,
 * `project`, `milestone`. Экраны этим набором не пользовались (задавали
 * фильтры строками у себя), поэтому расхождение ничего не роняло — оно просто
 * ждало первого, кто возьмёт набор и получит пустые фасеты.
 *
 * Теперь набор один и его берут экраны (`screens.ts`), а тест держит это
 * равенство: два места для имён одного поля расходятся молча, одно — нет.
 */
export const LORE_FILTER_FIELDS = {
  release: 'fields.release',
  component: 'fields.components',
  project: 'fields.project',
  milestone: 'fields.milestone',
  priority: 'fields.priority',
  sprint: 'fields.sprint',
  /** S9-03: теги — многозначная ось (Σcount > total — норма, kit это говорит). */
  tags: 'fields.tags',
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
  // Одно и то же поле зовут двумя написаниями: фасет — «fields.release»,
  // колонка таблицы — «release» (`fieldValue` понимает оба). Иконка не должна
  // зависеть от написания, иначе в фильтре она есть, а в ячейке её нет.
  const k = key.startsWith('fields.') ? key : `fields.${key}`;
  if (key === 'status' || key === 'kind') return undefined;
  if (!value) return null;
  if (k === LORE_FILTER_FIELDS.priority) return PRIORITY_ICONS[value] ?? { icon: ICON_CANON.prioP2, color: 'var(--t2)' };
  return FIELD_ICONS[k] ?? null;
}

/** Задачи с полем release_ids их спринта; спринта нет в выдаче — релиз пуст, а не выдуман. */
export function tasksWithSprintRelease(tasks: readonly KitRecord[], sprints: readonly KitRecord[]): KitRecord[] {
  // Имя поля у задачи — то же, что у спринта (`release`): два имени одного
  // поля разошлись бы, как разошлись имена фасетов.
  return inheritField(tasks, sprints, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.release, 'release');
}

/**
 * Фасет статуса. Имя простое («status» — поле записи, не её `fields`), но
 * лежит здесь по той же причине, что и остальные: имена фасетов живут в одном
 * месте, иначе они расходятся.
 */
export const STATUS_FACET = 'status';
