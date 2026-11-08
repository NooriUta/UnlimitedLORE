// Владелица 05.11: «в админку раздел по MCP, иначе он вообще теряется».
// Справочник инструментов и рецепт подключения жили только в главе «Основа»
// Forseti, где их не находят. Теперь у админки своя группа «MCP» с обоими
// экранами; старые адреса ?section=mcp / ?section=connections не трогаются.
//
// SPRINT_UXR_S0_SAFETY/S0-07: что экраны реально рисуются — в панели и по старым
// адресам — проверяет рендер-тест adminMcpGroup.render.test.tsx, а не поиск строк
// в исходнике (тот ломался от любого переноса кода).
import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, ALL_TABS, TAB_I18N, GROUP_I18N } from './adminTabs';
import ru from '../../../i18n/locales/ru/common.json';
import en from '../../../i18n/locales/en/common.json';

const get = (o: unknown, path: string) => path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);

describe('Админка: группа «MCP»', () => {
  it('есть группа mcp с вкладками «Инструменты MCP» и «Подключения»', () => {
    const g = NAV_GROUPS.find(x => x.key === 'mcp');
    expect(g).toBeTruthy();
    expect(g!.tabs.map(([k]) => k)).toEqual(['mcpApi', 'connections']);
    expect(ALL_TABS).toContain('mcpApi');
    expect(ALL_TABS).toContain('connections');
  });

  it('подписи группы и вкладок есть в обеих локалях', () => {
    for (const key of [TAB_I18N.mcpApi, TAB_I18N.connections, GROUP_I18N.mcp.label, GROUP_I18N.mcp.risk]) {
      expect(typeof get(ru, key), key).toBe('string');
      expect(typeof get(en, key), key).toBe('string');
    }
  });
});
