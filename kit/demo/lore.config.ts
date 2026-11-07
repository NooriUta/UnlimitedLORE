// Демо-конфиг LORE для kit (контракт kit/src/core/contract.ts): задачи
// спринтов, ADR, спринты. Только то, что нужно витрине и рендер-тестам; живой
// конфиг LORE v2 собирается в web-next своими задачами.
import type { KitConfig } from '../src/core/contract';

export const loreConfig: KitConfig = {
  modules: [
    { id: 'forseti', title: 'Forseti', icon: 'scales', status: 'active' },
    { id: 'bragi', title: 'BRAGI', icon: 'harp', status: 'active' },
    { id: 'tyr', title: 'Týr', icon: 'sword-brandish', status: 'planned' },
  ],
  menu: {
    myViews: true,
    recent: true,
    groups: [
      { id: 'work', title: 'Работа', tone: 'var(--acc)', items: [
        { id: 'tasks', title: 'Задачи', icon: 'checkbox-tree', view: 'task' },
        { id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'sprint' },
      ] },
      { id: 'decisions', title: 'Решения', tone: 'var(--inf)', items: [
        { id: 'adrs', title: 'ADR', icon: 'scroll-unfurled', view: 'adr' },
      ] },
    ],
  },
  kinds: {
    task: { title: 'Задачи', icon: 'checkbox-tree', fields: [
      { key: 'sprint', title: 'Спринт', type: 'ref' },
      { key: 'component', title: 'Компонент', type: 'enum' },
      { key: 'effort', title: 'Оценка, дн', type: 'number' },
    ] },
    adr: { title: 'ADR', icon: 'scroll-unfurled', fields: [{ key: 'component', title: 'Компонент', type: 'enum' }] },
    sprint: { title: 'Спринты', icon: 'sprint' },
  },
  statuses: {
    items: [
      { code: 'backlog', title: 'бэклог', category: 'todo', icon: 'tied-scroll', color: 'var(--st-backlog)' },
      { code: 'planned', title: 'запланировано', category: 'todo', icon: 'calendar', color: 'var(--st-planned)' },
      { code: 'active', title: 'в работе', category: 'active', icon: 'progression', color: 'var(--st-active)' },
      { code: 'blocked', title: 'блокировано', category: 'active', icon: 'handcuffed', color: 'var(--st-blocked)' },
      { code: 'done', title: 'готово', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)' },
      { code: 'cancelled', title: 'отменено', category: 'cancelled', icon: 'cross-mark', color: 'var(--st-cancelled)' },
    ],
    selfApprove: false,
    bulk: true,
  },
  list: {
    views: ['list', 'board'],
    quick: [
      { id: 'active', title: 'в работе', filter: { status: 'active' } },
      { id: 'blocked', title: 'блокировано', filter: { status: 'blocked' } },
      { id: 'open', title: 'открытые', filter: { status: ['backlog', 'planned', 'active', 'blocked'] } },
    ],
    filters: ['kind', 'status', 'fields.component'],
    groupings: ['status', 'kind', 'fields.sprint', 'fields.component'],
    columns: ['select', 'title+id', 'status', 'kind', 'updated_at'],
  },
};
