// Страница админки v2 (SPRINT_UXR_S7B_ADMIN). Разделы:
//   • «Агенты» — harness и машина (S7B-15/S7B-16; владелица 09.11: «данные по
//     harness нужны уже вчера»);
//   • «Кто где» — UC-8: человек → проекты и его агенты, проект → люди, роли,
//     их агенты и «это вы».
// Раздел — в URL (?adm=…), как вкладки остального v2. Мастера UC-1/UC-2/UC-7
// ждут серверной части (KC-клиент по эталону, Infisical, Forgejo —
// D-2026-ADMIN-ONE-INTERFACE) и идут следующими PR.
import { useUrlParam } from '@seidr/kit';
import { v2Auth } from '../auth/session';
import { useAppT } from '../i18n';
import { ActionsScreen } from './ActionsScreen';
import { AgentsScreen } from './AgentsScreen';
import { FlagsScreen } from './FlagsScreen';
import { RulesScreen } from './RulesScreen';
import { RolesScreen } from './RolesScreen';
import { WhoWhereScreen } from './WhoWhereScreen';

export default function AdminPage() {
  const t = useAppT();
  const [tab, setTab] = useUrlParam('adm');
  const current = tab === 'who' ? 'who' : tab === 'log' ? 'log' : tab === 'roles' ? 'roles'
    : tab === 'rules' ? 'rules' : tab === 'flags' ? 'flags' : 'agents';
  return (
    <main data-lore-app="v2" className="shell" aria-label={t('admin.title')}>
      <nav className="adm-tabs" aria-label={t('admin.title')}>
        <button type="button" className="adm-tab" aria-current={current === 'agents' ? 'page' : undefined}
          data-testid="adm-tab-agents" onClick={() => setTab(null)}>{t('admin.agents.title')}</button>
        <button type="button" className="adm-tab" aria-current={current === 'who' ? 'page' : undefined}
          data-testid="adm-tab-who" onClick={() => setTab('who')}>{t('admin.who.title')}</button>
        <button type="button" className="adm-tab" aria-current={current === 'roles' ? 'page' : undefined}
          data-testid="adm-tab-roles" onClick={() => setTab('roles')}>{t('admin.roles.title')}</button>
        <button type="button" className="adm-tab" aria-current={current === 'log' ? 'page' : undefined}
          data-testid="adm-tab-log" onClick={() => setTab('log')}>{t('admin.log.title')}</button>
        <button type="button" className="adm-tab" aria-current={current === 'rules' ? 'page' : undefined}
          data-testid="adm-tab-rules" onClick={() => setTab('rules')}>{t('admin.rules.title')}</button>
        <button type="button" className="adm-tab" aria-current={current === 'flags' ? 'page' : undefined}
          data-testid="adm-tab-flags" onClick={() => setTab('flags')}>{t('admin.flags.title')}</button>
      </nav>
      {current === 'agents' && <AgentsScreen />}
      {current === 'who' && <WhoWhereScreen meSub={v2Auth.getState().user?.sub ?? null} />}
      {current === 'log' && <ActionsScreen />}
      {current === 'roles' && <RolesScreen />}
      {current === 'rules' && <RulesScreen />}
      {current === 'flags' && <FlagsScreen />}
    </main>
  );
}
