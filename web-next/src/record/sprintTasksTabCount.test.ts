// Подмена вкладки «Задачи» не теряет число (ревью 10.11.2026, B13).
//
// Паспорт спринта подменяет вкладку задач настоящей таблицей (фазы, смена
// статуса в строке, сгорание) — `withSprintTasksTab`. Вкладка собиралась
// заново, и счётчик исходной вкладки-части при этом пропадал: в списке стояло
// «48/55», а в ряду паспорта — «Задачи» без числа. Это ровно та жалоба, с
// которой начался разбор паспорта спринта.
//
// Правило: подменяется СОДЕРЖИМОЕ вкладки, а не то, что о ней известно. Число
// приходит от части и переносится как есть, включая `null` — «не смогли
// посчитать» (часть не прочиталась) не должно превратиться в «считать нечего».
import { describe, expect, it } from 'vitest';
import type { KitConfig } from '@seidr/kit';
import { SPRINT_TASKS_TAB, withSprintTasksTab } from './sprintTasksTab';

const configOf = (count: number | null | undefined): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { sprint: { title: 'Спринты', icon: 'cog', tabs: [
    { key: SPRINT_TASKS_TAB, title: 'Задачи', count, render: () => 'список связей' },
    { key: 'phases', title: 'Фазы', count: 3, render: () => 'фазы' },
  ] } },
  statuses: { items: [] },
});

const tasksTab = (c: KitConfig) => c.kinds.sprint.tabs!.find(t => t.key === SPRINT_TASKS_TAB)!;

describe('B13 · подмена вкладки задач спринта сохраняет известное о ней', () => {
  it('положительный контроль: вкладка подменена и стоит первой', () => {
    const out = withSprintTasksTab(configOf(48), 'sprint', 'Задачи', () => 'таблица');
    expect(out.kinds.sprint.tabs![0].key).toBe(SPRINT_TASKS_TAB);
    expect(out.kinds.sprint.tabs![0].render({} as never, {} as never)).toBe('таблица');
  });

  it('число части переносится в подменённую вкладку', () => {
    expect(tasksTab(withSprintTasksTab(configOf(48), 'sprint', 'Задачи', () => 'т')).count).toBe(48);
  });

  it('«не смогли посчитать» остаётся «не смогли», а не «считать нечего»', () => {
    expect(tasksTab(withSprintTasksTab(configOf(null), 'sprint', 'Задачи', () => 'т')).count).toBeNull();
  });

  it('счётчика у части не было — и не выдумываем', () => {
    expect(tasksTab(withSprintTasksTab(configOf(undefined), 'sprint', 'Задачи', () => 'т')).count).toBeUndefined();
  });

  it('остальные вкладки вида и их числа не тронуты', () => {
    const out = withSprintTasksTab(configOf(48), 'sprint', 'Задачи', () => 'т');
    const phases = out.kinds.sprint.tabs!.find(t => t.key === 'phases')!;
    expect(phases.count).toBe(3);
  });
});
