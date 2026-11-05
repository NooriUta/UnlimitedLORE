import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, describeLoreError, type LoreKnowDocRow } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { GameIcon } from '../GameIcon';
import { loadKc, loadKcObj, type KcState } from '../kc-state';
import { type RealmRole } from '../adminRealmRoles';
import { AUTH_ENABLED } from '../../../auth/session';
import { useRole } from '../../../auth/useRole';
import type { DictRow, ProjRow, TagRow, KcUser, KcAgent, Preflight, Tab, AgentRow } from './types';
import { S } from './adminStyles';
import { NAV_GROUPS, TAB_TITLES, ALL_TABS, TAB_I18N, GROUP_I18N } from './adminTabs';
import { agentsCounter, kcCounter, readinessCounter, sliceCounter, systemChips, whereAmI, type NavCounter, type SysChip } from './adminShellModel';
import { useIsNarrow } from './useIsNarrow';
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
//
// AH-05 — оболочка по прототипу admin-v2 (одобрен 04.11.2026, мобильная навигация —
// вариант A): полоса состояния системы на всех вкладках (вместо dev-баннера и плашки
// роли), честные счётчики («?» с причиной, красный — проблемы), подпись риска у
// группы; на телефоне — строка «где я» и лента вкладок с подписями групп.

/**
 * AH-07 (SH-06): источники данных панели. Сбой источника раньше уходил только
 * в тост, а стейт оставался `[]` — вкладка рисовала пустую таблицу, тост
 * исчезал, «пусто» оставалось. Теперь сбой запоминается и показывается на
 * каждой вкладке, которая из этого источника читает.
 */
type Src = 'dicts' | 'projects' | 'tags' | 'claudeRules' | 'sprints' | 'components' | 'agents';
const TAB_SOURCES: Partial<Record<Tab, Src[]>> = {
  dicts: ['dicts', 'components'], roles: ['dicts'], settings: ['dicts'],
  projects: ['projects', 'sprints'], tags: ['tags'], claudeRules: ['claudeRules'],
};

/** Пояснение к счётчику: «?» обязан сказать, ЧТО не удалось проверить. */
function useCounterTitle() {
  const { t } = useTranslation();
  return (c: NavCounter, tab: Tab): string | undefined => {
    if (c.kind === 'unk') {
      switch (c.why) {
        case 'kc403': return t('lore.admin.cntKc403', 'не смогли проверить: 403 — нет прав');
        case 'kc503': return t('lore.admin.cntKc503', 'не смогли проверить: 503 — Keycloak не настроен ({{detail}})', { detail: c.detail ?? '' });
        case 'kcErr': return t('lore.admin.cntKcErr', 'не смогли проверить: Keycloak не ответил ({{detail}})', { detail: c.detail ?? '' });
        case 'srcErr': return t('lore.admin.cntSrcErr', 'не смогли проверить: {{detail}}', { detail: c.detail ?? '' });
        case 'preflight': return t('lore.admin.cntPreflight', 'не смогли проверить: auth-preflight не ответил');
      }
    }
    if (c.kind === 'bad') return t('lore.admin.cntBad', 'проверок готовности к включению auth не пройдено: {{n}}', { n: c.n });
    // SH-05: «Агенты» — агенты графа (как первая таблица вкладки), учётки KC — в подписи.
    if (c.kind === 'n' && tab === 'agents') return t('lore.admin.cntAgentsGraph', 'агентов в графе: {{n}} · учёток Keycloak: {{kc}}', { n: c.n, kc: c.kcAccounts ?? '?' });
    return undefined;
  };
}

function NavCount({ c, title }: { c: NavCounter; title?: string }) {
  if (c.kind === 'none') return null;
  if (c.kind === 'n') return <span style={S.navN} title={title}>{c.n}</span>;
  if (c.kind === 'unk') return <span style={S.navCnt('wrn')} title={title} aria-label={title}>?</span>;
  return <span style={S.navCnt('dng')} title={title} aria-label={title}>{c.n}</span>;
}

/** Полоса состояния системы (SH-08/SH-09): видна на всех вкладках, и на телефоне. */
function SystemBar({ chips, narrow }: { chips: SysChip[]; narrow: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<SysChip['id'] | null>(null);
  const label = (c: SysChip): string => {
    switch (c.id) {
      case 'auth': return c.state === 'on' ? t('lore.admin.sysAuthOn', 'auth: on') : t('lore.admin.sysAuthOff', 'auth: off · dev');
      case 'kc': return ({
        ok: t('lore.admin.sysKcOk', 'KC: ok'), off: t('lore.admin.sysKcOff', 'KC: не настроен'),
        down: t('lore.admin.sysKcDown', 'KC: недоступен'), '403': t('lore.admin.sysKc403', 'KC: 403'),
      } as Record<string, string>)[c.state] ?? t('lore.admin.sysKcUnknown', 'KC: ?');
      case 'scope': return c.state === 'on' ? t('lore.admin.sysScopeOn', 'права агентов: проверяются')
        : c.state === 'off' ? t('lore.admin.sysScopeOff', 'права агентов: не проверяются')
        : t('lore.admin.sysScopeUnknown', 'права агентов: ?');
      case 'role': return t('lore.admin.sysRole', 'роль: {{role}}', { role: c.state });
    }
  };
  // Пояснение раскрывается по нажатию — у телефона нет наведения, title там не виден.
  const detail = (c: SysChip): ReactNode => {
    switch (c.id) {
      case 'auth': return c.state === 'on'
        ? t('lore.admin.sysAuthOnD', 'Аутентификация включена: роль берётся из токена Keycloak.')
        : <><b>{t('lore.admin.devBannerH', 'Аутентификация выключена.')}</b>{' '}
            {t('lore.admin.devBannerB', 'Администрировать LORE может любой, кто открыл этот адрес: роль берётся из конфига, а не из токена. Режим разработки.')}</>;
      case 'kc': return ({
        ok: t('lore.admin.sysKcOkD', 'Мост в Keycloak отвечает.'),
        off: t('lore.admin.sysKcOffD', 'Мост в Keycloak не настроен (KC_ADMIN_CLIENT_SECRET). Списки людей и учёток сейчас неизвестны — это не «пусто». Остальной LORE работает.'),
        down: t('lore.admin.sysKcDownD', 'Keycloak не ответил: {{detail}}. Состояние людей и учёток неизвестно.', { detail: c.detail ?? '' }),
        '403': t('lore.admin.sysKc403D', 'Keycloak отказал: управление доступом открыто только роли admin.'),
      } as Record<string, string>)[c.state] ?? t('lore.admin.sysKcUnknownD', 'auth-preflight не ответил — состояние Keycloak не подтверждено.');
      case 'scope': return c.state === 'on'
        ? t('lore.admin.sysScopeOnD', 'Клейм agent_scope проверяется бэкендом.')
        : c.state === 'off'
          ? t('lore.admin.notEnforcedB', 'Клейм agent_scope бэкенд не читает: сейчас это фильтр видимости инструментов, не защита. Включается флагом LORE_AUTH_ENABLED — состояние видно в «Настройках».')
          : t('lore.admin.notEnforcedUnkB', 'Бэкенд не ответил на auth-preflight, поэтому состояние защиты не подтверждено. Считайте таблицу описанием намерения, пока не восстановится связь.');
      case 'role': return t('lore.admin.sysRoleD', 'Роль текущей сессии: {{role}}. При выключенной аутентификации она берётся из конфига.', { role: c.state });
    }
  };
  const cur = chips.find(c => c.id === open);
  return (
    <div style={{ flexShrink: 0, background: 'var(--bg1)', borderBottom: '1px solid var(--bd)' }}>
      <div style={S.sysBar}>
        {!narrow && <span style={S.sysBrand}>{t('lore.admin.crumb', 'Администрирование')}</span>}
        <div style={S.sysChips}>
          {chips.map(c => (
            <button key={c.id} type="button" style={S.sysChip(c.tone, open === c.id, narrow)}
              aria-expanded={open === c.id} onClick={() => setOpen(o => (o === c.id ? null : c.id))}>
              {c.id === 'auth' && c.state === 'off' && <GameIcon slug="hazard-sign" size={12} style={{ color: 'inherit' }} />}
              {label(c)}
            </button>
          ))}
        </div>
      </div>
      {cur && <div style={S.sysDetail(cur.tone)}>{detail(cur)}</div>}
    </div>
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
  // SH-05/A-02: агенты графа грузятся здесь — их считает навигация, и от KC они не зависят.
  const [graphAgents, setGraphAgents] = useState<AgentRow[]>([]);
  const [reload, setReload] = useState(0);
  const bump = () => setReload(x => x + 1);
  const [srcErr, setSrcErr] = useState<Partial<Record<Src, string>>>({});
  // AH-05: «загружено» отдельно от «пусто» — счётчик не рисует число до ответа.
  const [loaded, setLoaded] = useState<Partial<Record<Src, boolean>>>({});

  useEffect(() => {
    setSrcErr({}); setLoaded({});
    const done = (src: Src) => setLoaded(m => ({ ...m, [src]: true }));
    const failed = (src: Src, toast = true) => (e: unknown) => {
      if (toast) onError(e);
      const d = describeLoreError(e);
      if (d.kind !== 'aborted') setSrcErr(m => ({ ...m, [src]: d.text }));
    };
    fetchLoreSlice<DictRow>('dictionary', {}).then(r => { setDicts(r); done('dicts'); }).catch(failed('dicts'));
    fetchLoreSlice<ProjRow>('git_projects', {}).then(r => { setProjects(r); done('projects'); }).catch(failed('projects'));
    fetchLoreSlice<TagRow>('tags_usage', {}).then(r => { setKnowTags(r); done('tags'); }).catch(failed('tags'));
    // kind — серверный фильтр: общий корпус KnowDoc упирается в LIMIT 200 слайса.
    fetchLoreSlice<LoreKnowDocRow>('docs', { kind: 'claude-rules' }).then(r => { setClaudeRules(r); done('claudeRules'); }).catch(failed('claudeRules'));
    fetchLoreSlice<{ sprint_id: string; git_projects: string[] | null }>('sprints', {})
      .then(rows => {
        const m: Record<string, number> = {};
        rows.forEach(r => (r.git_projects ?? []).forEach(p => { m[p] = (m[p] ?? 0) + 1; }));
        setSprintsByProject(m);
      // Счётчик спринтов — не блокер (без тоста), но и не «0»: столбец станет «?».
      }).catch(failed('sprints', false));
    fetchLoreSlice<{ component_id: string; area: string | null }>('components', {})
      .then(rows => {
        const m: Record<string, number> = {};
        rows.forEach(c => { if (c.area) m[c.area] = (m[c.area] ?? 0) + 1; });
        setAreaUsage(m);
      // usage-колонка деградирует в «н/д» (без тоста), а не в «0 использований».
      }).catch(failed('components', false));
    // Без тоста: вкладка «Агенты» показывает сбой на месте, в своей секции.
    fetchLoreSlice<AgentRow>('agent_owners', {}).then(r => { setGraphAgents(r); done('agents'); }).catch(failed('agents', false));
    loadKc<KcUser>('/lore/kc/users').then(setUsers);
    loadKc<KcAgent>('/lore/kc/agents').then(setAgents);
    loadKcObj<Preflight>('/lore/kc/auth-preflight').then(setPreflight);
    loadKc<RealmRole>('/lore/kc/realm-roles').then(setRealmRoles);
  }, [onError, reload]);

  const dictTypes = useMemo(() => [...new Set(dicts.map(r => r.dict_type))].sort(), [dicts]);
  // SH-04: число · «?» (не смогли проверить) · красный (проблемы) · пусто — только честный 0.
  const counters: Partial<Record<Tab, NavCounter>> = {
    users: kcCounter(users),
    agents: agentsCounter(graphAgents.length, srcErr.agents, !!loaded.agents, agents),
    dicts: sliceCounter(dictTypes.length, srcErr.dicts, !!loaded.dicts),
    projects: sliceCounter(projects.length, srcErr.projects, !!loaded.projects),
    tags: sliceCounter(knowTags.length, srcErr.tags, !!loaded.tags),
    claudeRules: sliceCounter(claudeRules.length, srcErr.claudeRules, !!loaded.claudeRules),
    settings: readinessCounter(preflight),
  };
  const none: NavCounter = { kind: 'none' };
  const cntOf = (k: Tab) => counters[k] ?? none;
  const cntTitle = useCounterTitle();
  const chips = systemChips({ authEnabled: AUTH_ENABLED, preflight, users, role });
  const where = whereAmI(tab);
  // SH-16: подписи групп/вкладок — через t() (ключи — adminTabs, наличие держит тест).
  const tabL = (k: Tab) => t(TAB_I18N[k], TAB_TITLES[k]);
  const grpL = (g: (typeof NAV_GROUPS)[number]) => t(GROUP_I18N[g.key].label, g.label);
  const riskL = (g: (typeof NAV_GROUPS)[number]) => t(GROUP_I18N[g.key].risk, g.risk);
  const whereG = grpL(NAV_GROUPS.find(g => g.key === where.groupKey) ?? NAV_GROUPS[0]);
  const curCnt = cntOf(tab);

  // Вариант A: активная вкладка ленты всегда в видимой зоне (SH-01).
  const activeStrip = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (narrow) activeStrip.current?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [narrow, tab]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <SystemBar chips={chips} narrow={narrow} />
      {narrow && (
        // «Где я» на телефоне (SH-10): группа › вкладка · N/9 в цвете группы;
        // причина «?»/красного счётчика текущей вкладки — текстом (наведения нет).
        <div style={S.where} aria-label={t('lore.admin.whereAmI', 'Где я')}>
          <span style={S.whereRail(where.color)} />
          <span style={{ minWidth: 0 }}>
            <span style={S.whereG(where.color)}>{whereG}</span>
            <span style={{ color: 'var(--t3)' }}> › </span>
            <span style={S.whereT}>{tabL(tab)}</span>
          </span>
          <span style={S.wherePos}>· {where.pos}/{where.total}</span>
          {(curCnt.kind === 'unk' || curCnt.kind === 'bad') && (
            <span style={S.whereWhy(curCnt.kind === 'unk' ? 'wrn' : 'dng')}>{cntTitle(curCnt, tab)}</span>
          )}
        </div>
      )}
      <div style={S.shell(narrow)}>
        {narrow ? (
          // Лента вкладок с подписями групп (вариант A); края затухают — видно, что листается.
          <nav style={{ position: 'relative', flexShrink: 0, background: 'var(--bg1)', borderBottom: '1px solid var(--bd)' }}>
            <div style={S.strip}>
              {NAV_GROUPS.map(g => (
                <span key={g.key} style={{ display: 'contents' }}>
                  <span style={S.stripGrp(g.rail)}><span style={S.dot(g.rail)} />{grpL(g)}</span>
                  {g.tabs.map(([k]) => (
                    <button key={k} ref={tab === k ? activeStrip : undefined}
                      style={S.stripTab(tab === k, g.rail)} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
                      {tabL(k)}
                      <NavCount c={cntOf(k)} title={cntTitle(cntOf(k), k)} />
                    </button>
                  ))}
                </span>
              ))}
            </div>
            <span style={S.stripFade('left')} />
            <span style={S.stripFade('right')} />
          </nav>
        ) : (
          <nav style={S.side(narrow)}>
            {NAV_GROUPS.map(g => (
              <div key={g.key}>
                <div style={S.grpLabel}><span style={S.dot(g.rail)} />{grpL(g)}<span style={S.grpRisk}>{riskL(g)}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {g.tabs.map(([k, , icon]) => (
                    <button key={k} style={S.nav(tab === k)} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
                      <span style={S.rail(tab === k ? g.rail : null)} />
                      <GameIcon slug={icon} size={13} style={{ color: tab === k ? g.rail : 'var(--t3)' }} />
                      {tabL(k)}
                      <NavCount c={cntOf(k)} title={cntTitle(cntOf(k), k)} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        )}
        <main style={S.main}>
          {!narrow && (
            <div style={S.crumb}>
              {t('lore.admin.crumb', 'Администрирование')} › <span style={S.crumbG(where.color)}>{whereG}</span> › <span style={S.crumbB}>{tabL(tab)}</span>
            </div>
          )}
          {(TAB_SOURCES[tab] ?? []).filter(s => srcErr[s]).map(s => (
            <LoadError key={s}
              text={t('lore.admin.sourceLoadError', 'Не загрузилось ({{src}}): {{reason}} — пустая таблица ниже не значит «данных нет»', { src: s, reason: srcErr[s] })}
              onRetry={bump} retryLabel={t('lore.admin.retry', 'повторить')} />
          ))}
          {tab === 'users' && <UsersTab st={users} preflight={preflight} realmRoles={realmRoles.k === 'ok' ? realmRoles.rows : null} onError={onError} reload={bump} />}
          {tab === 'agents' && <AgentsTab st={agents} people={users} preflight={preflight} graph={graphAgents} graphErr={srcErr.agents ?? null} onError={onError} reload={bump} />}
          {tab === 'roles' && <RolesTab dicts={dicts} users={users} agents={agents} preflight={preflight} />}
          {tab === 'dicts' && <DictsTab rows={dicts} areaUsage={areaUsage} usageUnknown={!!srcErr.components} onError={onError} reload={bump} />}
          {tab === 'projects' && <ProjectsTab rows={projects} sprints={sprintsByProject} sprintsUnknown={!!srcErr.sprints} people={users} onError={onError} reload={bump} />}
          {tab === 'tags' && <TagsTab know={knowTags} />}
          {tab === 'claudeRules' && <ClaudeRulesTab rows={claudeRules} loadFailed={!!srcErr.claudeRules} />}
          {tab === 'settings' && <SettingsTab dicts={dicts} preflight={preflight} onError={onError} reload={bump} />}
          {tab === 'quick' && <QuickCommandsTab />}
        </main>
      </div>
    </div>
  );
}
