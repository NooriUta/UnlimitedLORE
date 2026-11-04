import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, type LoreKnowDocRow } from '../../../api/lore';
import { loadKc, loadKcObj, type KcState } from '../kc-state';
import { type RealmRole } from '../adminRealmRoles';
import { AUTH_ENABLED } from '../../../auth/session';
import { useRole } from '../../../auth/useRole';
import type { DictRow, ProjRow, TagRow, KcUser, KcAgent, Preflight, Tab } from './types';
import { S } from './adminStyles';
import { NAV_GROUPS, TAB_TITLES, ALL_TABS } from './adminTabs';
import { UsersTab } from './UsersTab';
import { AgentsTab } from './AgentsTab';
import { RolesTab } from './RolesTab';
import { DictsTab } from './DictsTab';
import { ProjectsTab } from './ProjectsTab';
import { TagsTab } from './TagsTab';
import { ClaudeRulesTab } from './ClaudeRulesTab';
import { SettingsTab } from './SettingsTab';
import { QuickCommandsTab } from './QuickCommandsTab';

// ⚙ Admin LORE (ADR-LORE-025, SPEC-ADMIN-LORE-UC): администрирование доступа и
// единого языка графа. Структура — ОДОБРЕННЫЙ прототип AL-44: навигация по РИСКУ
// (Доступ / Справочники / Система), а не по таблицам БД; выдача admin-роли и правка
// подписи справочника не равны по весу и не стоят рядом.
// Write path = те же эндпоинты, что у MCP (D4) — параллельного admin-API нет.

// Узкий экран: группы навигации схлопываются в горизонтальные ряды (mobile-проверка фазы UI).
const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 760px)') : null;
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    cb => { narrowQuery?.addEventListener('change', cb); return () => narrowQuery?.removeEventListener('change', cb); },
    () => narrowQuery?.matches ?? false,
  );
}

export default function LoreAdminPanel({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const role = useRole();
  const narrow = useIsNarrow();
  const [params, setParams] = useSearchParams();
  const tab = (ALL_TABS.find(k => k === params.get('tab')) ?? 'dicts') as Tab;
  const setTab = (k: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', k); p.delete('user');
    setParams(p, { replace: true });
  };

  // Все данные грузятся здесь один раз и раздаются вкладкам: счётчики в навигации
  // и вкладки видят ОДНО состояние (иначе «Люди» и счётчик могли бы противоречить).
  const [dicts, setDicts] = useState<DictRow[]>([]);
  const [projects, setProjects] = useState<ProjRow[]>([]);
  const [knowTags, setKnowTags] = useState<TagRow[]>([]);
  const [claudeRules, setClaudeRules] = useState<LoreKnowDocRow[]>([]);
  const [sprintsByProject, setSprintsByProject] = useState<Record<string, number>>({});
  const [areaUsage, setAreaUsage] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<KcState<KcUser>>({ k: 'loading' });
  const [agents, setAgents] = useState<KcState<KcAgent>>({ k: 'loading' });
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [realmRoles, setRealmRoles] = useState<KcState<RealmRole>>({ k: 'loading' });
  const [reload, setReload] = useState(0);
  const bump = () => setReload(x => x + 1);

  useEffect(() => {
    fetchLoreSlice<DictRow>('dictionary', {}).then(setDicts).catch(onError);
    fetchLoreSlice<ProjRow>('git_projects', {}).then(setProjects).catch(onError);
    fetchLoreSlice<TagRow>('tags_usage', {}).then(setKnowTags).catch(onError);
    // kind — серверный фильтр: общий корпус KnowDoc упирается в LIMIT 200 слайса.
    fetchLoreSlice<LoreKnowDocRow>('docs', { kind: 'claude-rules' }).then(setClaudeRules).catch(onError);
    fetchLoreSlice<{ sprint_id: string; git_projects: string[] | null }>('sprints', {})
      .then(rows => {
        const m: Record<string, number> = {};
        rows.forEach(r => (r.git_projects ?? []).forEach(p => { m[p] = (m[p] ?? 0) + 1; }));
        setSprintsByProject(m);
      }).catch(() => { /* счётчик спринтов — украшение, не блокер */ });
    fetchLoreSlice<{ component_id: string; area: string | null }>('components', {})
      .then(rows => {
        const m: Record<string, number> = {};
        rows.forEach(c => { if (c.area) m[c.area] = (m[c.area] ?? 0) + 1; });
        setAreaUsage(m);
      }).catch(() => { /* usage-колонка деградирует в «н/д» */ });
    loadKc<KcUser>('/lore/kc/users').then(setUsers);
    loadKc<KcAgent>('/lore/kc/agents').then(setAgents);
    loadKcObj<Preflight>('/lore/kc/auth-preflight').then(setPreflight);
    loadKc<RealmRole>('/lore/kc/realm-roles').then(setRealmRoles);
  }, [onError, reload]);

  const dictTypes = useMemo(() => [...new Set(dicts.map(r => r.dict_type))].sort(), [dicts]);
  const counters: Partial<Record<Tab, number>> = {
    users: users.k === 'ok' ? users.rows.length : undefined,
    agents: agents.k === 'ok' ? agents.rows.length : undefined,
    dicts: dictTypes.length || undefined,
    projects: projects.length || undefined,
    tags: knowTags.length || undefined,
    claudeRules: claudeRules.length || undefined,
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {!AUTH_ENABLED && (
        <div style={{ ...S.banner, margin: '8px 12px 0' }}>
          <span aria-hidden>⚠</span>
          <span>
            <b>{t('lore.admin.devBannerH', 'Аутентификация выключена.')}</b>{' '}
            {t('lore.admin.devBannerB', 'Администрировать LORE может любой, кто открыл этот адрес: роль берётся из конфига, а не из токена. Режим разработки.')}
          </span>
        </div>
      )}
      <div style={S.shell(narrow)}>
        <nav style={S.side(narrow)}>
          {NAV_GROUPS.map(g => (
            <div key={g.label} style={{ minWidth: narrow ? 'auto' : undefined }}>
              <div style={S.grpLabel}><span style={S.dot(g.rail)} />{g.label}</div>
              <div style={{ display: 'flex', flexDirection: narrow ? 'row' : 'column', gap: 2 }}>
                {g.tabs.map(([k, l]) => (
                  <button key={k} style={S.nav(tab === k)} onClick={() => setTab(k)} aria-current={tab === k}>
                    <span style={S.rail(tab === k ? g.rail : null)} />
                    {l}
                    {counters[k] !== undefined && <span style={S.navN}>{counters[k]}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!narrow && (
            <span style={{ marginTop: 'auto', padding: '0 8px', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>
              {t('lore.admin.roleBadge', 'роль: {{role}} · auth: {{auth}}', { role, auth: AUTH_ENABLED ? 'on' : 'off (dev)' })}
            </span>
          )}
        </nav>
        <main style={S.main}>
          <div style={S.crumb}>{t('lore.admin.crumb', 'Администрирование')} · <span style={S.crumbB}>{TAB_TITLES[tab]}</span></div>
          {tab === 'users' && <UsersTab st={users} preflight={preflight} realmRoles={realmRoles.k === 'ok' ? realmRoles.rows : null} onError={onError} reload={bump} />}
          {tab === 'agents' && <AgentsTab st={agents} people={users} preflight={preflight} onError={onError} />}
          {tab === 'roles' && <RolesTab dicts={dicts} users={users} agents={agents} preflight={preflight} />}
          {tab === 'dicts' && <DictsTab rows={dicts} areaUsage={areaUsage} onError={onError} reload={bump} />}
          {tab === 'projects' && <ProjectsTab rows={projects} sprints={sprintsByProject} people={users} onError={onError} reload={bump} />}
          {tab === 'tags' && <TagsTab know={knowTags} />}
          {tab === 'claudeRules' && <ClaudeRulesTab rows={claudeRules} />}
          {tab === 'settings' && <SettingsTab dicts={dicts} preflight={preflight} onError={onError} reload={bump} />}
          {tab === 'quick' && <QuickCommandsTab />}
        </main>
      </div>
    </div>
  );
}
