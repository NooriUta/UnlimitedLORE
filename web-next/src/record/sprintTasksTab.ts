// Вкладка «Задачи» паспорта спринта в оболочке (владелица 09.11: «да, переводи
// задачу и спринт в оболочку»). До этого таблица задач спринта — группировка по
// фазам/статусам в адресе, смена статуса в строке, правка, строка сгорания —
// жила только на отдельной странице ?section=sprints&passport=… вне оболочки,
// где пропадало меню. Паспорт оболочки её не имел, и убрать отдельную страницу
// значило бы потерять функцию (инвентаризация в SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13).
//
// Ключ вкладки — 'tasks': на него уже ведёт «задачи x/y» строки-вердикта
// (SPRINT_FACTS.tasksTab), и kit показывает переход, только если вкладка есть.
import type { KitConfig, KindConfig, KitRecord } from '@seidr/kit';
import type { ReactNode } from 'react';

export const SPRINT_TASKS_TAB = 'tasks';

type Tab = NonNullable<KindConfig['tabs']>[number];

/** Конфиг паспорта с вкладкой «Задачи» у вида записи; прочие вкладки вида — следом. */
export function withSprintTasksTab(
  config: KitConfig,
  kind: string,
  title: string,
  render: (r: KitRecord) => ReactNode,
): KitConfig {
  const k = config.kinds[kind];
  if (!k) return config;
  const tab: Tab = { key: SPRINT_TASKS_TAB, title, render: r => render(r) };
  const rest = (k.tabs ?? []).filter(x => x.key !== SPRINT_TASKS_TAB);
  return { ...config, kinds: { ...config.kinds, [kind]: { ...k, tabs: [tab, ...rest] } } };
}
