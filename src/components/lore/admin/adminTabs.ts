import type { Tab } from './types';

// AH-05: у группы — подпись риска (прототип admin-v2), у вкладки — иконка game-icons.
// SH-16: русские подписи здесь — дефолты и опора тестов модели; на экран они идут
// через t() по ключам TAB_I18N / GROUP_I18N (ключи собраны не литералом в t(),
// поэтому их наличие в обеих локалях держит adminV2Tabs.test.ts).
export type GroupKey = 'access' | 'dicts' | 'sys';
export const NAV_GROUPS: { key: GroupKey; label: string; risk: string; rail: string; tabs: [Tab, string, string][] }[] = [
  { key: 'access', label: 'Доступ', risk: 'высокий риск', rail: 'var(--dng)', tabs: [['users', 'Люди', 'person'], ['agents', 'Агенты', 'robot-golem'], ['roles', 'Роли и права', 'key']] },
  { key: 'dicts', label: 'Справочники', risk: 'данные', rail: 'var(--acc)', tabs: [['dicts', 'Словари', 'book-cover'], ['projects', 'Проекты', 'open-folder'], ['tags', 'Теги', 'price-tag'], ['claudeRules', 'Правила CLAUDE', 'scroll-unfurled']] },
  { key: 'sys', label: 'Система', risk: 'обслуживание', rail: 'var(--inf)', tabs: [['settings', 'Настройки', 'cog'], ['quick', 'Быстрые команды', 'fast-arrow']] },
];
export const TAB_TITLES: Record<Tab, string> = {
  users: 'Люди', agents: 'Агенты', roles: 'Роли и права',
  dicts: 'Словари', projects: 'Проекты', tags: 'Теги', claudeRules: 'Правила CLAUDE', settings: 'Настройки',
  quick: 'Быстрые команды',
};
export const TAB_I18N: Record<Tab, string> = {
  users: 'lore.admin.navTabUsers', agents: 'lore.admin.navTabAgents', roles: 'lore.admin.navTabRoles',
  dicts: 'lore.admin.navTabDicts', projects: 'lore.admin.navTabProjects', tags: 'lore.admin.navTabTags',
  claudeRules: 'lore.admin.navTabClaudeRules', settings: 'lore.admin.navTabSettings', quick: 'lore.admin.navTabQuick',
};
export const GROUP_I18N: Record<GroupKey, { label: string; risk: string }> = {
  access: { label: 'lore.admin.navGrpAccess', risk: 'lore.admin.navRiskAccess' },
  dicts: { label: 'lore.admin.navGrpDicts', risk: 'lore.admin.navRiskDicts' },
  sys: { label: 'lore.admin.navGrpSys', risk: 'lore.admin.navRiskSys' },
};
export const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs.map(([k]) => k));
