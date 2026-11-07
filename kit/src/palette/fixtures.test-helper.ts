// Фикстура для тестов палитры (K-07): маленький KitData + KitConfig по контракту.
import type { KitConfig, KitData } from '../core/contract';

export function fixtureData(overrides: Partial<KitData['meta']> = {}): KitData {
  return {
    records: [
      { id: 'T-1', kind: 'task', title: 'План релиза весны', status: 'active', fields: {} },
      { id: 'T-2', kind: 'task', title: 'Задача про поиск', status: 'todo', fields: {} },
      { id: 'T-3', kind: 'task', title: 'Нарядить ёлку', status: 'done', fields: {} },
      { id: 'ADR-1', kind: 'adr', title: 'Решение о палитре', status: 'active', fields: {} },
      { id: 'ADR-10', kind: 'adr', title: 'Задача и решение', status: 'todo', fields: {} },
      { id: 'D-7', kind: 'doc', title: 'Создание справочника', status: 'done', fields: {} },
    ],
    edges: [],
    journal: [],
    meta: { generated_at: '2026-11-07T00:00:00Z', ...overrides },
  };
}

export function fixtureConfig(run: (id: string) => void = () => {}): KitConfig {
  return {
    modules: [],
    menu: { groups: [] },
    kinds: {
      task: { title: 'Задача', icon: 'scroll-unfurled' },
      adr: { title: 'ADR', icon: 'scales' },
      doc: { title: 'Документ', icon: 'scroll-quill' },
    },
    statuses: { items: [] },
    palette: {
      commands: [
        { id: 'new-task', title: 'Создать задачу', run: () => run('new-task') },
        { id: 'toggle-theme', title: 'Сменить тему', run: () => run('toggle-theme') },
      ],
    },
  };
}
