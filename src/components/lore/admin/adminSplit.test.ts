// AH-03: админка разрезана по вкладкам. Гвард разреза без браузера:
// в модуле каждой вкладки есть её компонент, а оболочка рендерит все вкладки из ALL_TABS.
import { describe, expect, it } from 'vitest';
import { ALL_TABS } from './adminTabs';
import type { Tab } from './types';
import * as UsersTab from './UsersTab';
import * as AgentsTab from './AgentsTab';
import * as RolesTab from './RolesTab';
import * as DictsTab from './DictsTab';
import * as ProjectsTab from './ProjectsTab';
import * as TagsTab from './TagsTab';
import * as ClaudeRulesTab from './ClaudeRulesTab';
import * as SettingsTab from './SettingsTab';
import * as QuickCommandsTab from './QuickCommandsTab';
import * as LoreMcpApiScreen from '../LoreMcpApiScreen';
import * as LoreConnectionsScreen from '../LoreConnectionsScreen';
import LoreAdminPanel from './LoreAdminPanel';
import LoreAdminPanelLegacy from '../LoreAdminPanel';

// Исходник оболочки — тем же способом, что font-scale/i18n-гварды (без node:fs).
const SHELL_SRC = import.meta.glob('./LoreAdminPanel.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// [экспорт в модуле, модуль, имя в JSX оболочки — если отличается от экспорта]
const TAB_MODULES: Record<Tab, [string, Record<string, unknown>, string?]> = {
  users: ['UsersTab', UsersTab],
  agents: ['AgentsTab', AgentsTab],
  roles: ['RolesTab', RolesTab],
  dicts: ['DictsTab', DictsTab],
  projects: ['ProjectsTab', ProjectsTab],
  tags: ['TagsTab', TagsTab],
  claudeRules: ['ClaudeRulesTab', ClaudeRulesTab],
  settings: ['SettingsTab', SettingsTab],
  quick: ['QuickCommandsTab', QuickCommandsTab],
  // группа «MCP» (05.11) показывает те же экраны, что глава «Основа»: компонент — default-экспорт
  mcpApi: ['default', LoreMcpApiScreen, 'LoreMcpApiScreen'],
  connections: ['default', LoreConnectionsScreen, 'LoreConnectionsScreen'],
};

describe('AH-03: разрез LoreAdminPanel по вкладкам', () => {
  it('в модуле каждой вкладки есть её компонент, оболочка рендерит все 11 через ALL_TABS', () => {
    for (const [name, mod] of Object.values(TAB_MODULES)) {
      expect(typeof mod[name], name).toBe('function');
    }

    expect([...ALL_TABS].sort()).toEqual(Object.keys(TAB_MODULES).sort());
    expect(ALL_TABS).toHaveLength(11);
    const shell = Object.values(SHELL_SRC)[0];
    expect(typeof shell).toBe('string');
    for (const k of ALL_TABS) {
      const [name, , jsx] = TAB_MODULES[k];
      expect(shell, k).toContain(`tab === '${k}' && <${jsx ?? name}`);
    }

    // старый путь импорта (LorePage) отдаёт ту же оболочку
    expect(typeof LoreAdminPanel).toBe('function');
    expect(LoreAdminPanelLegacy).toBe(LoreAdminPanel);
  });
});
