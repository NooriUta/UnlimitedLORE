import type { Tab } from './types';

export const NAV_GROUPS: { label: string; rail: string; tabs: [Tab, string][] }[] = [
  { label: 'Доступ', rail: 'var(--dng)', tabs: [['users', 'Люди'], ['agents', 'Агенты'], ['roles', 'Роли и права']] },
  { label: 'Справочники', rail: 'var(--acc)', tabs: [['dicts', 'Словари'], ['projects', 'Проекты'], ['tags', 'Теги'], ['claudeRules', 'Правила CLAUDE']] },
  { label: 'Система', rail: 'var(--inf)', tabs: [['settings', 'Настройки'], ['quick', 'Быстрые команды']] },
];
export const TAB_TITLES: Record<Tab, string> = {
  users: 'Люди', agents: 'Агенты', roles: 'Роли и права',
  dicts: 'Словари', projects: 'Проекты', tags: 'Теги', claudeRules: 'Правила CLAUDE', settings: 'Настройки',
  quick: 'Быстрые команды',
};
export const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs.map(([k]) => k));
