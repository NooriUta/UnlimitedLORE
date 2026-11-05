import type { Tab } from './types';

// AH-05: у группы — подпись риска (прототип admin-v2), у вкладки — иконка game-icons.
// Подписи групп/вкладок пока мимо t() (SH-16 — отдельная пачка): переводятся
// разом с TAB_TITLES и заголовками таблиц.
export const NAV_GROUPS: { key: 'access' | 'dicts' | 'sys'; label: string; risk: string; rail: string; tabs: [Tab, string, string][] }[] = [
  { key: 'access', label: 'Доступ', risk: 'высокий риск', rail: 'var(--dng)', tabs: [['users', 'Люди', 'person'], ['agents', 'Агенты', 'robot-golem'], ['roles', 'Роли и права', 'key']] },
  { key: 'dicts', label: 'Справочники', risk: 'данные', rail: 'var(--acc)', tabs: [['dicts', 'Словари', 'book-cover'], ['projects', 'Проекты', 'open-folder'], ['tags', 'Теги', 'price-tag'], ['claudeRules', 'Правила CLAUDE', 'scroll-unfurled']] },
  { key: 'sys', label: 'Система', risk: 'обслуживание', rail: 'var(--inf)', tabs: [['settings', 'Настройки', 'cog'], ['quick', 'Быстрые команды', 'fast-arrow']] },
];
export const TAB_TITLES: Record<Tab, string> = {
  users: 'Люди', agents: 'Агенты', roles: 'Роли и права',
  dicts: 'Словари', projects: 'Проекты', tags: 'Теги', claudeRules: 'Правила CLAUDE', settings: 'Настройки',
  quick: 'Быстрые команды',
};
export const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs.map(([k]) => k));
