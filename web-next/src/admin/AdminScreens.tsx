// Экраны модуля «Админка» в оболочке v2 (SPRINT_UXR_S7B_ADMIN/S7B-01).
// Свой чанк (V2Shell грузит его лениво): админка нужна немногим, и оболочка
// за неё не платит. Экраны те же, что были на странице /admin, — здесь только
// выбор экрана по разделу и переход между разделами навигацией оболочки.
import { useMemo, useRef, type ComponentType } from 'react';
import { setUrlParams, useKitShell } from '@seidr/kit';
import { v2Auth } from '../auth/session';
import { ActionsScreen } from './ActionsScreen';
import { AppearanceScreen } from './AppearanceScreen';
import { AgentsScreen } from './AgentsScreen';
import { DictsScreen } from './DictsScreen';
import { FlagsScreen } from './FlagsScreen';
import { AdminHome } from './HomeScreen';
import { MachinesScreen } from './MachinesScreen';
import { McpScreen } from './McpScreen';
import { ModelScreen } from './ModelScreen';
import { MigrationScreen } from './MigrationScreen';
import { RolesScreen } from './RolesScreen';
import { RulesScreen } from './RulesScreen';
import { TidyScreen } from './TidyScreen';
import { WhoWhereScreen } from './WhoWhereScreen';
import { WizardsScreen } from './WizardsScreen';
import { ListScreen } from '../pages/ListScreen';
import { AdminForbidden, WhoamiBarView, adminDenied, useWhoami } from './WhoamiBar';
import { AdminNavProvider, type AdminNav } from './adminNav';
import { useTableCardLabels } from './tableCards';
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
  // Решение владелицы 19.11.2026: организации — список, создание и связи (проекты, продукты, люди) в паспорте.
  // Тот же экран, что в «Системе», но с правом управления; пишет только super-admin (can_create / can_edit сервера).
  'adm-orgs': () => <ListScreen screen="organizations" manage />,
  'adm-roles': () => <RolesScreen />,
  'adm-dicts': () => <DictsScreen />,
  // AP-APPEARANCE: наши стили обязательные, свои — загрузкой; умолчание и набор палитр и шрифтов установки.
  'adm-appearance': () => <AppearanceScreen />,
  // MC-06: модель LORE — типы, поля, меню и видимость; правка версией с dry_run и откатом.
  'adm-model': () => <ModelScreen />,
  'adm-rules': () => <RulesScreen />,
  // PU-20: ссылки в текстах — автопочинка пачкой и ручной список.
  'adm-tidy': () => <TidyScreen />,
  // MIG-02: «Перенос на новую модель» — правила переноса решением человека super-admin.
  'adm-migration': () => <MigrationScreen />,
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
  // AO-WHOAMI: «Вы: …» над каждым разделом — кем LORE видит смотрящего.
  // AP-08: тот же ответ решает, пускать ли: не admin/superadmin — честное «нет прав», а не карточки с нулями.
  const who = useWhoami();
  const denied = adminDenied(who.data ?? null);
  // Телефон: таблицы разделов — карточками (Admin.css); клеткам — подписи колонок (tableCards.ts).
  const box = useRef<HTMLDivElement>(null);
  useTableCardLabels(box);
  return (
    <AdminNavProvider value={nav}>
      <div ref={box} className="adm-root">
        <WhoamiBarView res={who} />
        {denied ? <AdminForbidden role={who.data?.seer_role} /> : <Screen />}
      </div>
    </AdminNavProvider>
  );
}
