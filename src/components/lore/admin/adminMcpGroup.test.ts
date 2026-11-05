// Владелица 05.11: «в админку раздел по MCP, иначе он вообще теряется».
// Справочник инструментов и рецепт подключения жили только в главе «Основа»
// Forseti, где их не находят. Теперь у админки своя группа «MCP» с обоими
// экранами; старые адреса ?section=mcp / ?section=connections не трогаются.
import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, ALL_TABS, TAB_I18N, GROUP_I18N } from './adminTabs';
import ru from '../../../i18n/locales/ru/common.json';
import en from '../../../i18n/locales/en/common.json';

const PANEL_SRC = import.meta.glob('./LoreAdminPanel.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const LORE_PAGE = import.meta.glob('../../../pages/LorePage.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

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

  it('панель рендерит те же экраны, что и глава «Основа»', () => {
    const src = PANEL_SRC['./LoreAdminPanel.tsx'];
    expect(src).toMatch(/tab === 'mcpApi' && <LoreMcpApiScreen/);
    expect(src).toMatch(/tab === 'connections' && <LoreConnectionsScreen/);
  });

  it('старые адреса ?section=mcp и ?section=connections остаются рабочими', () => {
    const page = LORE_PAGE['../../../pages/LorePage.tsx'];
    expect(page).toContain("section === 'mcp' && <LoreMcpApiScreen");
    expect(page).toContain("section === 'connections' && <LoreConnectionsScreen");
  });
});
