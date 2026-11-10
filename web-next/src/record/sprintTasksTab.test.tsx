// Вкладка «Задачи» паспорта спринта в оболочке (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13,
// «да» владелицы 09.11 на перевод спринта в оболочку).
import { describe, expect, it } from 'vitest';
import type { KitConfig } from '@seidr/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPRINT_TASKS_TAB, withSprintTasksTab } from './sprintTasksTab';
import { SPRINT_FACTS } from './loreRecord';

const cfg = (tabs?: { key: string; title: string }[]): KitConfig => ({
  modules: [], menu: { groups: [] }, statuses: { items: [] },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint', tabs: tabs?.map(t => ({ ...t, render: () => null })) } },
} as unknown as KitConfig);

describe('вкладка «Задачи» у спринта в оболочке', () => {
  it('добавляется первой, ключ — тот, на который ведёт «задачи x/y» вердикта', () => {
    const c = withSprintTasksTab(cfg([{ key: 'activity', title: 'Активность' }]), 'sprint', 'Задачи', () => null);
    expect(c.kinds.sprint.tabs!.map(t => t.key)).toEqual([SPRINT_TASKS_TAB, 'activity']);
    expect(SPRINT_FACTS.tasksTab).toBe(SPRINT_TASKS_TAB);
  });

  it('не дублируется, если вкладка с тем же ключом уже была', () => {
    const c = withSprintTasksTab(cfg([{ key: 'tasks', title: 'старая' }]), 'sprint', 'Задачи', () => null);
    expect(c.kinds.sprint.tabs!.filter(t => t.key === 'tasks')).toHaveLength(1);
    expect(c.kinds.sprint.tabs![0].title).toBe('Задачи');
  });

  it('паспорт оболочки подключает её у спринта (таблица задач, а не только связи)', () => {
    const src = readFileSync(join(__dirname, 'ListPassport.tsx'), 'utf8');
    expect(src).toMatch(/withSprintTasksTab\(/);
    expect(src).toMatch(/<SprintTasksTab /);
    expect(src).toMatch(/<SprintBurnLine /);
  });
});
