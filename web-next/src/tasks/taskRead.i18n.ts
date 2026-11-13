// Строки чтения задачи (SPRINT_UXR_S5_RECORD_TASKS/S5-04). Своим модулем, а не
// в web-next/src/i18n/*.json: флот S4/S5 правит общий файл локалей параллельно,
// и дописывание в его хвост конфликтует при каждом слиянии. Паритет ru/en —
// taskRecord.test.ts. Подписи записи, листалки и ушка — из kit.
import { useKitLang, type KitLang } from '@seidr/kit';

const ru = {
  'task.kind': 'Задачи',
  'task.loading': 'Загружаем задачу',
  'task.crumbs.sprint': 'Спринт {id}',
  'task.error.title': 'Задачу не удалось загрузить',
  'task.error.hint': 'Сервер LORE не ответил — это сбой, а не «задачи нет».',
  'task.forbidden.title': 'Нет доступа к задачам спринта',
  'task.notFound.title': 'Задачи {id} в спринте нет',
  'task.notFound.hint': 'Спринт загружен целиком, такой задачи в нём нет — проверено.',
  'task.notFound.unverified': 'Выборка спринта неполная — проверить, есть ли задача, не удалось.',
  'task.badPassport.title': 'Задача открывается парой «спринт/код»',
  'task.badPassport.hint': 'Один и тот же код бывает у задач разных спринтов — без спринта задачу не найти.',
  'task.edge.PART_OF': 'в спринте',
  'task.edge.TAGGED_WITH': 'компонент',
  'task.edge.REALIZES': 'реализует сценарий',
  'task.prop.status': 'Статус',
  'task.prop.sprint': 'Спринт',
  'task.prop.type': 'Тип',
  'task.prop.workClass': 'Класс работы',
  'task.prop.effort': 'Оценка, дн',
  'task.prop.author': 'Автор',
  'task.prop.executor': 'Исполнитель',
  'task.prop.reviewer': 'Ревьюер',
  'task.prop.components': 'Компоненты',
  'task.prop.uc': 'Сценарии',
  'task.prop.none': 'не задано',
  'task.status.backlog': 'Бэклог',
  'task.status.todo': 'К работе',
  'task.status.planned': 'Запланировано',
  'task.status.design': 'Проектирование',
  'task.status.in_progress': 'В работе',
  'task.status.partial': 'Частично',
  'task.status.ready_for_deploy': 'К выкатке',
  'task.status.uat': 'UAT — приёмка',
  'task.status.blocked': 'Заблокировано',
  'task.status.deferred': 'Отложено',
  'task.status.done': 'Готово',
  'task.status.cancelled': 'Отменено',
} as const;

export type TaskReadKey = keyof typeof ru;

const en: Record<TaskReadKey, string> = {
  'task.kind': 'Tasks',
  'task.loading': 'Loading the task',
  'task.crumbs.sprint': 'Sprint {id}',
  'task.error.title': 'The task could not be loaded',
  'task.error.hint': 'The LORE server did not answer — this is a failure, not “no task”.',
  'task.forbidden.title': 'No access to the sprint tasks',
  'task.notFound.title': 'Task {id} is not in the sprint',
  'task.notFound.hint': 'The whole sprint was loaded and has no such task — checked.',
  'task.notFound.unverified': 'The sprint selection is incomplete — whether the task exists could not be checked.',
  'task.badPassport.title': 'A task is opened by the “sprint/code” pair',
  'task.badPassport.hint': 'The same code exists in tasks of different sprints — without the sprint the task cannot be found.',
  'task.edge.PART_OF': 'in sprint',
  'task.edge.TAGGED_WITH': 'component',
  'task.edge.REALIZES': 'realizes use case',
  'task.prop.status': 'Status',
  'task.prop.sprint': 'Sprint',
  'task.prop.type': 'Type',
  'task.prop.workClass': 'Work class',
  'task.prop.effort': 'Estimate, days',
  'task.prop.author': 'Author',
  'task.prop.executor': 'Executor',
  'task.prop.reviewer': 'Reviewer',
  'task.prop.components': 'Components',
  'task.prop.uc': 'Use cases',
  'task.prop.none': 'not set',
  'task.status.backlog': 'Backlog',
  'task.status.todo': 'To do',
  'task.status.planned': 'Planned',
  'task.status.design': 'Design',
  'task.status.in_progress': 'In progress',
  'task.status.partial': 'Partial',
  'task.status.ready_for_deploy': 'Ready for deploy',
  'task.status.uat': 'UAT Testing',
  'task.status.blocked': 'Blocked',
  'task.status.deferred': 'Deferred',
  'task.status.done': 'Done',
  'task.status.cancelled': 'Cancelled',
};

export const TASK_READ_DICTS: { ru: Record<TaskReadKey, string>; en: Record<TaskReadKey, string> } = { ru, en };

export function taskT(lang: KitLang, key: TaskReadKey, vars?: Record<string, string | number>): string {
  const s = (TASK_READ_DICTS[lang] ?? TASK_READ_DICTS.ru)[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function useTaskT() {
  const lang = useKitLang();
  return (key: TaskReadKey, vars?: Record<string, string | number>) => taskT(lang, key, vars);
}
