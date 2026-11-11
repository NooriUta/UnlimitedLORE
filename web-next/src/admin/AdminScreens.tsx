// Экраны модуля «Админка» в оболочке v2 (SPRINT_UXR_S7B_ADMIN/S7B-01).
// Свой чанк (V2Shell грузит его лениво): админка нужна немногим, и оболочка
// за неё не платит. Экраны те же, что были на странице /admin, — здесь только
// выбор экрана по разделу и переход между разделами навигацией оболочки.
import { useMemo, type ComponentType } from 'react';
import { setUrlParams, useKitShell } from '@seidr/kit';
import { v2Auth } from '../auth/session';
import { ActionsScreen } from './ActionsScreen';
import { AgentsScreen } from './AgentsScreen';
import { DictsScreen } from './DictsScreen';
import { FlagsScreen } from './FlagsScreen';
import { AdminHome } from './HomeScreen';
import { MachinesScreen } from './MachinesScreen';
import { McpScreen } from './McpScreen';
import { RolesScreen } from './RolesScreen';
import { RulesScreen } from './RulesScreen';
import { WhoWhereScreen } from './WhoWhereScreen';
import { WizardsScreen } from './WizardsScreen';
import { AdminNavProvider, type AdminNav } from './adminNav';
import type { AdminSection } from './adminModule';

const SCREENS: Record<AdminSection, ComponentType> = {
  'adm-home': () => <AdminHome />,
  'adm-wiz': () => <WizardsScreen meSub={v2Auth.getState().user?.sub ?? null} />,
  'adm-agents': () => <AgentsScreen />,
  // S7B-ACL-3: доступ людей к машинам miniLORE — сосед «Агентов».
  'adm-machines': () => <MachinesScreen meSub={v2Auth.getState().user?.sub ?? null} />,
  'adm-who': () => <WhoWhereScreen view="people" meSub={v2Auth.getState().user?.sub ?? null} />,
  // S7B-28: «Проекты» — отдельный раздел; та же сборка участия, ось — проекты.
  'adm-projects': () => <WhoWhereScreen view="projects" meSub={v2Auth.getState().user?.sub ?? null} />,
  'adm-roles': () => <RolesScreen />,
  'adm-dicts': () => <DictsScreen />,
  'adm-rules': () => <RulesScreen />,
  'adm-flags': () => <FlagsScreen />,
  'adm-mcp': () => <McpScreen />,
  'adm-log': () => <ActionsScreen />,
};

export default function AdminSectionView({ id }: { id: AdminSection }) {
  const { navigate } = useKitShell();
  const nav = useMemo<AdminNav>(() => ({
    go: (tab, params = {}) => {
      // Сначала раздел (оболочка снимает параметры прежнего, B-07), затем —
      // параметры нового: экран прочитает их уже при монтировании.
      navigate({ item: `adm-${tab}`, view: null });
      if (Object.keys(params).length) setUrlParams(params, { replace: true });
    },
  }), [navigate]);
  const Screen = SCREENS[id];
  return <AdminNavProvider value={nav}><Screen /></AdminNavProvider>;
}
