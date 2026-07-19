import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { iconLoaded } from '@iconify/react';
import gameIconsData from '@iconify-json/game-icons/icons.json';
import { fetchLoreSlice, loreMutate } from '../../api/lore';
import { loadKc, loadKcObj, type KcState } from './kc-state';
import { GameIcon } from './GameIcon';
import { AUTH_ENABLED } from '../../auth/session';
import { useRole } from '../../auth/useRole';

// ⚙ Admin LORE (ADR-LORE-025, SPEC-ADMIN-LORE-UC): администрирование доступа и
// единого языка графа. Структура — ОДОБРЕННЫЙ прототип AL-44: навигация по РИСКУ
// (Доступ / Справочники / Система), а не по таблицам БД; выдача admin-роли и правка
// подписи справочника не равны по весу и не стоят рядом.
// Write path = те же эндпоинты, что у MCP (D4) — параллельного admin-API нет.

interface DictRow { dict_type: string; code: string; label_ru: string | null; label_en: string | null; color: string | null; icon: string | null; sort_order: number | null; is_active: boolean; is_extensible: boolean }
interface ProjRow { slug: string; name: string | null; default_branch: string | null; is_private: boolean | null; hosts: string | null }
interface TagRow { tag_id: string; uses: number }
interface HostRow { remote: string; role: string; base_url: string; file_url_template: string; pr_url_template: string; default_branch?: string }
interface KcUser { id: string; username: string; email: string | null; enabled: boolean; roles: string[] }
interface KcAgent { clientId: string; id: string; enabled: boolean; agent_scope: string[] }
interface Preflight { auth_enabled: boolean; kc_configured: boolean; kc_reachable: boolean; kc_error: string; admin_count: number; agent_scope_enforced: boolean; can_enable_auth: boolean; hint: string }
interface Denial { ts: string; method: string; path: string; status: number; error: string; role: string }

const CANON_TYPES = new Set(['adr_status', 'sprint_status', 'task_status', 'priority']);
type Tab = 'users' | 'agents' | 'roles' | 'dicts' | 'projects' | 'tags' | 'settings';

// RBAC scope per ADR-LORE-014 §3 (agent-profiles — файлы; read-only отображение).
const PROFILE_SCOPE: [string, string][] = [
  ['full', '"*": allow (primary — Claude/backfill)'],
  ['architect', 'adr_* · component_* · tech_* · spec_* · runbook_* · doc_* · decision_* · question_* · feature_* · uc_* · project_new · status_set'],
  ['developer', 'task_* · release_* · tech_* · spec_* · runbook_* · doc_* · adr_new · status_set'],
  ['tester', 'qg_* · task_* · status_set · status_set_batch'],
  ['pm', 'sprint_* · task_* · milestone_* · question_* · feature_* · uc_* · project_new · status_set · status_set_batch'],
  ['analyst', 'metric_* · insight_* · rec_* · question_* · task_set · status_set'],
  ['marketer', 'bragi_* · task_* · insight_* · rec_* · doc_* · status_set'],
];

// Обратная матрица (AL-32/36, SPEC-RBAC-OMILORE-AGENTS §4): «кто имеет доступ к X» —
// вопрос, который задают на ревью доступа. humanOnly-строки = запрет §4.
const REVERSE_MATRIX: { what: string; api: string; humanOnly: boolean; agents: string[] }[] = [
  { what: 'Словари', api: '/lore/dict/entry', humanOnly: true, agents: [] },
  { what: 'Учётные записи', api: '/lore/kc/*', humanOnly: true, agents: [] },
  { what: 'Включение auth', api: 'LORE_AUTH_ENABLED', humanOnly: true, agents: [] },
  { what: 'ADR', api: '/lore/adr*', humanOnly: false, agents: ['full', 'architect', 'developer'] },
  { what: 'Решения', api: '/lore/decision*', humanOnly: false, agents: ['full', 'architect'] },
  { what: 'Спеки/ранбуки/доки', api: '/lore/spec*, runbook*, doc*', humanOnly: false, agents: ['full', 'architect', 'developer', 'marketer'] },
  { what: 'Спринты и вехи', api: '/lore/sprint*, milestone*', humanOnly: false, agents: ['full', 'pm'] },
  { what: 'Задачи', api: '/lore/task*', humanOnly: false, agents: ['full', 'pm', 'developer', 'tester', 'marketer', 'analyst'] },
  { what: 'Релизы', api: '/lore/release*', humanOnly: false, agents: ['full', 'developer'] },
  { what: 'Quality gates', api: '/lore/qg*', humanOnly: false, agents: ['full', 'tester'] },
  { what: 'Вопросы', api: '/lore/question*', humanOnly: false, agents: ['full', 'architect', 'analyst', 'pm', 'product-analyst'] },
  { what: 'Метрики', api: '/lore/metric*', humanOnly: false, agents: ['full', 'analyst', 'product-analyst'] },
  { what: 'Инсайты', api: '/lore/insight*', humanOnly: false, agents: ['full', 'analyst', 'marketer', 'product-analyst'] },
  { what: 'Рекомендации', api: '/lore/rec*', humanOnly: false, agents: ['full', 'analyst', 'marketer', 'product-analyst'] },
  // Продуктовый слой (ADR-LORE-022/030/032). Владелец — product-analyst, восьмой
  // профиль: он курирует VP-канву. До AL-17 эти строки в матрице отсутствовали, и
  // писать в них мог любой профиль — проверять было нечему.
  { what: 'Фичи', api: '/lore/feature*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'US (сценарии)', api: '/lore/uc*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Боли', api: '/lore/pain*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Ожидания', api: '/lore/gain*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Работы', api: '/lore/job*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'VP-связи', api: '/lore/vp*', humanOnly: false, agents: ['full', 'architect', 'pm', 'product-analyst'] },
  { what: 'Акторы', api: '/lore/actor*', humanOnly: false, agents: ['full', 'architect', 'pm'] },
  { what: 'Компоненты', api: '/lore/component*', humanOnly: false, agents: ['full', 'architect'] },
  { what: 'Тех-реестр', api: '/lore/tech*', humanOnly: false, agents: ['full', 'architect', 'developer'] },
  { what: 'Проекты', api: '/lore/project*', humanOnly: false, agents: ['full', 'architect', 'pm'] },
  { what: 'Публикации BRAGI', api: '/lore/bragi*', humanOnly: false, agents: ['full', 'marketer'] },
  // AL-62: три семейства имели живой POST, но в матрице отсутствовали и попадали
  // в ветку «неизвестное — пропускаю». Держать синхронно с FAMILY_AGENTS в
  // AgentScopeFilter: расхождение = экран показывает не те права, что применяются.
  { what: 'Forgejo (PR, мерж)', api: '/lore/forgejo*', humanOnly: false, agents: ['full'] },
  { what: 'Файлы-ассеты', api: '/lore/asset*', humanOnly: false, agents: ['full'] },
  { what: 'Гейты качества', api: '/lore/quality-gate*, qg*', humanOnly: false, agents: ['full', 'tester'] },
  { what: 'Чтение (слайсы)', api: '/lore/slice/*', humanOnly: false, agents: ['все агенты'] },
];

// AL-38: реестр известных app_setting-ключей. Сейчас приложение НЕ читает ни одного —
// реестр пуст, и это честно: всё, что лежит в dict_type=app_setting, попадает в
// «неопознанные». Появится реальный ключ → строка здесь + чтение в коде одним PR.
const KNOWN_SETTINGS: { key: string; type: string; def: string; descr: string }[] = [];

// AL-31: разбор исходов KC-моста — в kc-state.ts (чистая логика, покрыта vitest).

// Узкий экран: группы навигации схлопываются в горизонтальные ряды (mobile-проверка фазы UI).
const narrowQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 760px)') : null;
function useIsNarrow(): boolean {
  return useSyncExternalStore(
    cb => { narrowQuery?.addEventListener('change', cb); return () => narrowQuery?.removeEventListener('change', cb); },
    () => narrowQuery?.matches ?? false,
  );
}

const S = {
  shell: (narrow: boolean) => ({
    display: narrow ? 'block' : 'grid',
    gridTemplateColumns: '212px 1fr',
    gap: 0, flex: 1, minHeight: 0, overflow: 'hidden' as const,
  }),
  side: (narrow: boolean) => ({
    background: 'var(--bg1)', padding: narrow ? '8px 10px' : '12px 8px',
    borderRight: narrow ? 'none' : '1px solid var(--bd)',
    borderBottom: narrow ? '1px solid var(--bd)' : 'none',
    display: 'flex', flexDirection: (narrow ? 'row' : 'column') as 'row' | 'column',
    gap: narrow ? 14 : 16, overflowX: 'auto' as const, flexWrap: (narrow ? 'wrap' : 'nowrap') as 'wrap' | 'nowrap',
  }),
  grpLabel: { fontSize: 'var(--fs-2xs)', letterSpacing: '.12em', textTransform: 'uppercase' as const, color: 'var(--t3)', padding: '0 8px 5px', display: 'flex', alignItems: 'center', gap: 6 },
  dot: (c: string) => ({ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }),
  nav: (on: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left' as const,
    background: on ? 'var(--bg2)' : 'transparent', font: 'inherit',
    border: `1px solid ${on ? 'var(--bdh)' : 'transparent'}`, borderRadius: 6,
    padding: '6px 8px', color: on ? 'var(--t1)' : 'var(--t2)', cursor: 'pointer',
    fontSize: 'var(--fs-sm)', fontWeight: on ? 600 : 400, whiteSpace: 'nowrap' as const,
  }),
  rail: (c: string | null) => ({ width: 3, height: 14, borderRadius: 2, background: c ?? 'transparent', flexShrink: 0 }),
  navN: { marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)' },
  main: { padding: '12px 16px', minWidth: 0, overflowY: 'auto' as const },
  crumb: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 8 },
  crumbB: { color: 'var(--t1)', fontWeight: 600 },
  toolbar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' as const },
  search: { fontSize: 'var(--fs-sm)', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'inherit', flex: 1, minWidth: 150, maxWidth: 280 },
  count: { fontSize: 'var(--fs-xs)', color: 'var(--t2)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const },
  seg: { display: 'inline-flex', border: '1px solid var(--b3)', borderRadius: 5, overflow: 'hidden' },
  segBtn: (on: boolean) => ({
    font: 'inherit', fontSize: 'var(--fs-xs)', padding: '3px 10px', cursor: 'pointer', border: 'none',
    background: on ? 'var(--bg3)' : 'var(--bg1)', color: on ? 'var(--t1)' : 'var(--t3)', fontWeight: on ? 600 : 400,
  }),
  tw: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--fs-sm)' },
  th: { textAlign: 'left' as const, padding: '4px 8px', color: 'var(--t3)', fontSize: 'var(--fs-2xs)', textTransform: 'uppercase' as const, letterSpacing: '.05em', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' as const, cursor: 'pointer', userSelect: 'none' as const },
  td: { padding: '4px 8px', borderBottom: '1px solid var(--bd)', color: 'var(--t2)' },
  num: { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontFamily: 'var(--mono)' },
  input: { fontSize: 'var(--fs-sm)', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'inherit' },
  select: { fontSize: 'var(--fs-sm)', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'var(--mono)' },
  btn: { fontSize: 'var(--fs-sm)', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t2)' },
  primary: { fontSize: 'var(--fs-sm)', padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, border: '1px solid var(--acc)', background: 'var(--acc)', color: 'var(--on-accent)' },
  danger: { fontSize: 'var(--fs-sm)', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid color-mix(in srgb, var(--dng) 55%, var(--bd))', background: 'transparent', color: 'var(--dng)' },
  warn: { fontSize: 'var(--fs-sm)', color: 'var(--wrn)', border: '1px solid color-mix(in srgb, var(--wrn) 40%, transparent)', background: 'color-mix(in srgb, var(--wrn) 8%, transparent)', borderRadius: 5, padding: '6px 10px', margin: '6px 0' },
  card: { border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 'var(--fs-sm)', color: 'var(--t2)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 6, padding: 10, margin: '8px 0', border: '1px solid var(--b3)', borderRadius: 6, background: 'var(--bg2)' },
  chip: (on: boolean) => ({
    font: 'inherit', fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    color: on ? 'var(--acc)' : 'var(--t3)',
  }),
  pill: (c: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '1px 8px',
    fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', border: `1px solid color-mix(in srgb, ${c} 45%, var(--bd))`,
    color: c, background: `color-mix(in srgb, ${c} 10%, transparent)`,
  }),
  live: (c: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '2px 10px',
    fontSize: 'var(--fs-sm)', border: `1px solid ${c}`, color: c,
    background: `color-mix(in srgb, ${c} 12%, transparent)`,
  }),
  banner: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 10,
    borderRadius: 5, fontSize: 'var(--fs-sm)', color: 'var(--t1)',
    background: 'color-mix(in srgb, var(--wrn) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--wrn) 45%, var(--bd))',
  },
  state: (tone: 'neutral' | 'bad') => ({
    border: `1px ${tone === 'bad' ? 'solid' : 'dashed'} ${tone === 'bad' ? 'color-mix(in srgb, var(--dng) 50%, var(--bd))' : 'var(--bd)'}`,
    borderRadius: 6, padding: '18px 14px', textAlign: 'center' as const, color: 'var(--t2)', fontSize: 'var(--fs-sm)',
  }),
  stateH: (tone: 'neutral' | 'bad') => ({ fontWeight: 600, marginBottom: 4, color: tone === 'bad' ? 'var(--dng)' : 'var(--t1)' }),
  stateCode: { display: 'block', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' },
  check: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)', fontSize: 'var(--fs-sm)' },
  mark: (ok: boolean) => ({
    width: 16, height: 16, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
    fontSize: 10, marginTop: 1, color: ok ? 'var(--suc)' : 'var(--dng)',
    border: `1px solid ${ok ? 'var(--suc)' : 'var(--dng)'}`,
    background: `color-mix(in srgb, ${ok ? 'var(--suc)' : 'var(--dng)'} 18%, transparent)`,
  }),
  kv: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', fontSize: 'var(--fs-sm)' },
};

/** AL-31: один разбор исходов для всех KC-вкладок. */
function KcStateView({ s, empty }: { s: KcState<unknown>; empty: ReactNode }) {
  const { t } = useTranslation();
  if (s.k === 'loading') return <div style={S.state('neutral')}>{t('lore.admin.kcLoading', 'Спрашиваем Keycloak…')}</div>;
  if (s.k === 'forbidden') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcForbiddenH', 'Нет прав смотреть этот список')}</div>
      <div>{t('lore.admin.kcForbiddenB', 'Управление доступом открыто только роли admin. Это НЕ пустой список: записи могут существовать, но они вам не видны.')}</div>
      <code style={S.stateCode}>403 · admin role required</code>
    </div>
  );
  if (s.k === 'off') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcOffH', 'Keycloak не подключён')}</div>
      <div>{t('lore.admin.kcOffB', 'Мост в KC не настроен, получить список неоткуда. Это не значит, что записей нет — их состояние сейчас неизвестно. Настройка: KC_ADMIN_CLIENT_SECRET в .env, см. RUNBOOK-ADMIN-LORE. Остальной LORE работает как обычно.')}</div>
      <code style={S.stateCode}>503 · {s.detail}</code>
    </div>
  );
  if (s.k === 'error') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcErrH', 'Keycloak не ответил')}</div>
      <div>{t('lore.admin.kcErrB', 'Запрос не дошёл или сорвался. Состояние записей неизвестно — это не пустой список.')}</div>
      <code style={S.stateCode}>{s.detail}</code>
    </div>
  );
  return s.rows.length ? null : <>{empty}</>;
}

// AL-33: экран не имеет права утверждать наличие защиты, которой нет. Снять вместе с AL-17 (R2).
function NotEnforcedNotice() {
  const { t } = useTranslation();
  return (
    <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
      <b>{t('lore.admin.notEnforcedH', 'Права из этой таблицы пока не проверяются.')}</b>{' '}
      {t('lore.admin.notEnforcedB', 'Клейм agent_scope бэкенд ещё не читает: сейчас это фильтр видимости инструментов, не защита. Включится в R2 — задача AL-17.')}
    </div>
  );
}

/** AL-40: единый тулбар таблиц — поиск + «показано N из M» + опциональный сегмент-фильтр. */
function Toolbar({ q, setQ, shown, total, seg }: {
  q: string; setQ: (v: string) => void; shown: number; total: number;
  seg?: { options: [string, string][]; value: string; set: (v: string) => void };
}) {
  const { t } = useTranslation();
  return (
    <div style={S.toolbar}>
      <input style={S.search} placeholder={t('lore.admin.search', 'Поиск…')} value={q} onChange={e => setQ(e.target.value)} />
      <span style={S.count}>{t('lore.admin.shownOf', 'показано {{n}} из {{m}}', { n: shown, m: total })}</span>
      {seg && (
        <span style={S.seg}>
          {seg.options.map(([v, l]) => (
            <button key={v} style={S.segBtn(seg.value === v)} onClick={() => seg.set(v)}>{l}</button>
          ))}
        </span>
      )}
    </div>
  );
}

const NAV_GROUPS: { label: string; rail: string; tabs: [Tab, string][] }[] = [
  { label: 'Доступ', rail: 'var(--dng)', tabs: [['users', 'Люди'], ['agents', 'Агенты'], ['roles', 'Роли и права']] },
  { label: 'Справочники', rail: 'var(--acc)', tabs: [['dicts', 'Словари'], ['projects', 'Проекты'], ['tags', 'Теги']] },
  { label: 'Система', rail: 'var(--inf)', tabs: [['settings', 'Настройки']] },
];
const TAB_TITLES: Record<Tab, string> = {
  users: 'Люди', agents: 'Агенты', roles: 'Роли и права',
  dicts: 'Словари', projects: 'Проекты', tags: 'Теги', settings: 'Настройки',
};
const ALL_TABS = NAV_GROUPS.flatMap(g => g.tabs.map(([k]) => k));

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
  const [loreTags, setLoreTags] = useState<TagRow[]>([]);
  const [sprintsByProject, setSprintsByProject] = useState<Record<string, number>>({});
  const [areaUsage, setAreaUsage] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<KcState<KcUser>>({ k: 'loading' });
  const [agents, setAgents] = useState<KcState<KcAgent>>({ k: 'loading' });
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [reload, setReload] = useState(0);
  const bump = () => setReload(x => x + 1);

  useEffect(() => {
    fetchLoreSlice<DictRow>('dictionary', {}).then(setDicts).catch(onError);
    fetchLoreSlice<ProjRow>('git_projects', {}).then(setProjects).catch(onError);
    fetchLoreSlice<TagRow>('tags_usage', {}).then(setKnowTags).catch(onError);
    fetchLoreSlice<TagRow>('lore_tags_usage', {}).then(setLoreTags).catch(() => { /* optional */ });
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
  }, [onError, reload]);

  const dictTypes = useMemo(() => [...new Set(dicts.map(r => r.dict_type))].sort(), [dicts]);
  const counters: Partial<Record<Tab, number>> = {
    users: users.k === 'ok' ? users.rows.length : undefined,
    agents: agents.k === 'ok' ? agents.rows.length : undefined,
    dicts: dictTypes.length || undefined,
    projects: projects.length || undefined,
    tags: (knowTags.length + loreTags.length) || undefined,
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
          {tab === 'users' && <UsersTab st={users} preflight={preflight} onError={onError} reload={bump} />}
          {tab === 'agents' && <AgentsTab st={agents} onError={onError} />}
          {tab === 'roles' && <RolesTab dicts={dicts} users={users} agents={agents} />}
          {tab === 'dicts' && <DictsTab rows={dicts} areaUsage={areaUsage} onError={onError} reload={bump} />}
          {tab === 'projects' && <ProjectsTab rows={projects} sprints={sprintsByProject} onError={onError} reload={bump} />}
          {tab === 'tags' && <TagsTab know={knowTags} lore={loreTags} />}
          {tab === 'settings' && <SettingsTab dicts={dicts} preflight={preflight} onError={onError} reload={bump} />}
        </main>
      </div>
    </div>
  );
}

// ── Люди: список + карточка (AL-36) ─────────────────────────────────────────
function UsersTab({ st, preflight, onError, reload }: {
  st: KcState<KcUser>; preflight: Preflight | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState<{ username: string; email: string } | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const rows = st.k === 'ok' ? st.rows : [];
  const selectedId = params.get('user');
  const selected = rows.find(u => u.id === selectedId) ?? null;
  const openCard = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('user', id); else p.delete('user');
    setParams(p, { replace: true });
  };

  async function setRole(id: string, role: string, action: 'add' | 'remove') {
    setBusy(true); setOpError(null);
    try {
      await loreMutate(`/kc/user/${id}/role`, { role, action });
      reload(); setConfirmAdmin(null);
    } catch (e) {
      // 409 LAST_ADMIN (AL-35) — не страничная ошибка, а ответ по существу: показать на месте.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('LAST_ADMIN') || msg.includes('409')) setOpError(msg);
      else onError(e);
    } finally { setBusy(false); }
  }
  async function create() {
    if (!nu?.username.trim()) return;
    setBusy(true);
    try { await loreMutate('/kc/user', { username: nu.username.trim(), email: nu.email.trim() || null }); setNu(null); reload(); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }

  const note = <div style={S.card}>{t('lore.admin.usersNote', 'Люди — realm-роли Keycloak (ось «люди»). Паролей LORE не хранит: пользователь задаёт его в KC. Роль super-admin назначается только в KC-консоли (вне моста, D11).')}</div>;
  if (st.k !== 'ok') return <div>{note}<KcStateView s={st} empty={null} /></div>;

  // Карточка человека (AL-36): всё про одного субъекта на одном экране, deep-link через ?user=.
  if (selected) {
    const adminCount = preflight?.admin_count ?? -1;
    const isAdminHolder = selected.roles?.some(r => r === 'admin' || r === 'super-admin');
    const lastAdmin = isAdminHolder && adminCount === 1;
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button style={S.btn} onClick={() => openCard(null)}>← {t('lore.admin.backToList', 'К списку')}</button>
        </div>
        <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--bdh)', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--t2)' }}>
              {selected.username.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{selected.username}</span>{' '}
              {(selected.roles ?? []).filter(r => ['admin', 'super-admin', 'viewer'].includes(r)).map(r => (
                <span key={r} style={{ ...S.pill(r === 'viewer' ? 'var(--t2)' : 'var(--dng)'), marginLeft: 4 }}>{r}</span>
              ))}
              <span style={{ ...S.pill(selected.enabled ? 'var(--suc)' : 'var(--t3)'), marginLeft: 4 }}>{selected.enabled ? t('lore.admin.enabled', 'включён') : t('lore.admin.disabled', 'отключён')}</span>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{selected.email ?? '—'}</div>
            </span>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 10 }}>
            {lastAdmin && (
              <div style={S.warn}>
                <b>{t('lore.admin.lastAdminH', 'Последняя администрирующая учётка.')}</b>{' '}
                {t('lore.admin.lastAdminB', 'Снятие роли оставит LORE без администратора — бэкенд отклонит операцию (AL-35), пока не появится второй admin.')}
              </div>
            )}
            {opError && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>{opError}</div>}
            <dl style={S.kv}>
              <dt style={{ color: 'var(--t3)' }}>{t('lore.admin.cardRoles', 'Роли (люди)')}</dt>
              <dd style={{ margin: 0 }}>
                {(selected.roles ?? []).filter(r => ['admin', 'super-admin', 'viewer'].includes(r)).map(r => (
                  <span key={r} style={{ ...S.pill(r === 'viewer' ? 'var(--t2)' : 'var(--dng)'), marginRight: 6 }}>
                    {r}
                    {r !== 'super-admin' && (
                      <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}
                        disabled={busy} title={t('lore.admin.removeRole', 'снять роль')}
                        onClick={() => setRole(selected.id, r, 'remove')}>✕</button>
                    )}
                  </span>
                ))}
                {!selected.roles?.includes('viewer') && <button style={S.btn} disabled={busy} onClick={() => setRole(selected.id, 'viewer', 'add')}>+viewer</button>}{' '}
                {!selected.roles?.includes('admin') && (confirmAdmin === selected.id
                  ? <button style={S.primary} disabled={busy} onClick={() => setRole(selected.id, 'admin', 'add')}>{t('lore.admin.confirmAdmin', 'точно admin?')}</button>
                  : <button style={S.btn} disabled={busy} onClick={() => setConfirmAdmin(selected.id)}>+admin</button>)}
              </dd>
              <dt style={{ color: 'var(--t3)' }}>{t('lore.admin.cardId', 'KC id')}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{selected.id}</dd>
            </dl>
            <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
              <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4 }}>
                {t('lore.admin.cardHistory', 'История доступа и действий')}
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
                {t('lore.admin.cardHistoryNone', 'Истории пока нет: аудит админ-операций появится с AL-20/AL-43 и ляжет сюда. Экран не показывает то, чего система ещё не пишет.')}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const shown = rows.filter(u => !q || u.username.toLowerCase().includes(q.toLowerCase()) || (u.email ?? '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {note}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} />
      {rows.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['логин', 'email', 'вкл', 'роли', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(u => (
                <tr key={u.id}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{u.username}</td>
                  <td style={S.td}>{u.email ?? '—'}</td>
                  <td style={S.td}>{u.enabled ? '✓' : '✗'}</td>
                  <td style={S.td}>
                    {(u.roles ?? []).filter(r => ['admin', 'super-admin', 'viewer'].includes(r)).map(r => (
                      <span key={r} style={{ ...S.pill(r === 'viewer' ? 'var(--t2)' : 'var(--dng)'), marginRight: 4 }}>{r}</span>
                    ))}
                  </td>
                  <td style={S.td}><button style={S.btn} onClick={() => openCard(u.id)}>{t('lore.admin.open', 'Открыть')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && (
        <div style={S.state('neutral')}>
          <div style={S.stateH('neutral')}>{t('lore.admin.noUsersH', 'Ни одного человека ещё не заведено')}</div>
          <div>{t('lore.admin.noUsersB', 'Keycloak отвечает нормально, в realm просто нет учётных записей. Заведите себя первой — ДО включения аутентификации: она отключит доступ по конфигу, и войти станет некому.')}</div>
          <code style={S.stateCode}>GET /lore/kc/users → 200 · []</code>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        {nu ? (
          <div style={S.form}>
            <input style={S.input} placeholder={t('lore.admin.phLogin', 'логин')} value={nu.username} onChange={e => setNu(v => v && ({ ...v, username: e.target.value }))} />
            <input style={S.input} placeholder={t('lore.admin.phEmail', 'email (опц.)')} value={nu.email} onChange={e => setNu(v => v && ({ ...v, email: e.target.value }))} />
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{t('lore.admin.noPassNote', 'Пароль задаётся в Keycloak (reset-link/консоль) — LORE его не принимает и не хранит.')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.primary} disabled={busy} onClick={create}>{busy ? '…' : t('lore.admin.create', 'Создать')}</button>
              <button style={S.btn} onClick={() => setNu(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
            </div>
          </div>
        ) : <button style={S.primary} onClick={() => setNu({ username: '', email: '' })}>{t('lore.admin.addUser', '+ Человек')}</button>}
      </div>
    </div>
  );
}

// ── Агенты ───────────────────────────────────────────────────────────────────
function AgentsTab({ st, onError }: { st: KcState<KcAgent>; onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [secret, setSecret] = useState<{ client: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rotate(a: KcAgent) {
    setBusy(true);
    try {
      const res = await loreMutate<{ value?: string }>(`/kc/agent/${a.id}/rotate`, {});
      setSecret({ client: a.clientId, value: res?.value ?? '(секрет не возвращён)' });
      setConfirm(null);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  const note = <div style={S.card}>{t('lore.admin.agentsNote', 'AI-агенты — client-роли сервис-аккаунтов (ось «агенты», клейм agent_scope). Провижинятся скриптом, не заводятся руками. Ротация показывает секрет ОДИН раз — LORE его не хранит.')}</div>;
  if (st.k !== 'ok') return <div>{note}<KcStateView s={st} empty={null} /></div>;

  const rows = st.rows;
  const shown = rows.filter(a => !q || a.clientId.includes(q) || a.agent_scope.some(s => s.includes(q)));
  return (
    <div>
      {note}
      <NotEnforcedNotice />
      {secret && (
        <div style={{ ...S.warn, color: 'var(--suc)', borderColor: 'color-mix(in srgb, var(--suc) 40%, transparent)', background: 'color-mix(in srgb, var(--suc) 8%, transparent)' }}>
          <div>{t('lore.admin.newSecret', 'Новый секрет {{c}} — скопируйте сейчас, больше не покажем:', { c: secret.client })}</div>
          <code style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-all' }}>{secret.value}</code>
          <div><button style={S.btn} onClick={() => setSecret(null)}>{t('lore.admin.hide', 'скрыть')}</button></div>
        </div>
      )}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} />
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['клиент', 'agent_scope', 'вкл', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(a => (
              <tr key={a.id}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{a.clientId}</td>
                <td style={S.td}>
                  {(a.agent_scope ?? []).length
                    ? a.agent_scope.map(s => <span key={s} style={{ ...S.pill('var(--inf)'), marginRight: 4 }}>{s}</span>)
                    : <span style={{ color: 'var(--t3)' }}>{t('lore.admin.noScope', '— (оси не несёт, легаси)')}</span>}
                </td>
                <td style={S.td}>{a.enabled ? '✓' : '✗'}</td>
                <td style={S.td}>
                  {confirm === a.id
                    ? <button style={S.primary} disabled={busy} onClick={() => rotate(a)}>{t('lore.admin.confirmRotate', 'точно ротировать?')}</button>
                    : <button style={S.btn} onClick={() => setConfirm(a.id)}>{t('lore.admin.rotate', 'ротировать секрет')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Роли и права: обе оси + обратная матрица (AL-32) ─────────────────────────
function RolesTab({ dicts, users, agents }: { dicts: DictRow[]; users: KcState<KcUser>; agents: KcState<KcAgent> }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'by-role' | 'by-object'>('by-role');
  const agentRoles = dicts.filter(r => r.dict_type === 'agent_role');
  const humanCounts = useMemo(() => {
    if (users.k !== 'ok') return null;
    const m: Record<string, string[]> = { 'super-admin': [], admin: [], viewer: [] };
    users.rows.filter(u => u.enabled).forEach(u => (u.roles ?? []).forEach(r => { if (m[r]) m[r].push(u.username); }));
    return m;
  }, [users]);
  const agentByScope = useMemo(() => {
    if (agents.k !== 'ok') return null;
    const m: Record<string, string> = {};
    agents.rows.forEach(a => a.agent_scope.forEach(s => { m[s.replace(/^agent-/, '')] = a.clientId; }));
    return m;
  }, [agents]);

  const holders = (r: string) => humanCounts
    ? (humanCounts[r].length ? `${humanCounts[r].length} · ${humanCounts[r].join(', ')}` : 'никому')
    : 'н/д (KC недоступен)';

  return (
    <div>
      <div style={S.card}>{t('lore.admin.rolesNote2', 'Две оси, которые не смешиваются: люди входят паролем и несут realm-роли (seer_roles), агенты — секретом и несут agent_scope. Скоуп агентов правится в mcp-server/agent-profiles/*.json (D6, read-only здесь).')}</div>
      <NotEnforcedNotice />
      <div style={{ marginBottom: 8 }}>
        <span style={S.seg}>
          <button style={S.segBtn(mode === 'by-role')} onClick={() => setMode('by-role')}>{t('lore.admin.byRole', 'Кто что может')}</button>
          <button style={S.segBtn(mode === 'by-object')} onClick={() => setMode('by-object')}>{t('lore.admin.byObject', 'Кто имеет доступ к…')}</button>
        </span>
      </div>

      {mode === 'by-role' && (
        <>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['люди · realm-роль', 'что даёт', 'где назначается', 'кому выдана'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--dng)')}>super-admin</span></td>
                  <td style={S.td}>{t('lore.admin.superAdminGives', 'Всё, включая выдачу admin')}</td>
                  <td style={S.td}>{t('lore.admin.kcConsoleOnly', 'Только консоль Keycloak (D11)')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('super-admin')}</td>
                </tr>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--dng)')}>admin</span></td>
                  <td style={S.td}>{t('lore.admin.adminGives', 'Администрирование: люди, словари, настройки, включение auth')}</td>
                  <td style={S.td}>{t('lore.admin.herePeople', 'Здесь → Люди')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('admin')}</td>
                </tr>
                <tr>
                  <td style={S.td}><span style={S.pill('var(--t2)')}>viewer</span></td>
                  <td style={S.td}>{t('lore.admin.viewerGives', 'Только чтение LORE. В администрирование не пускает')}</td>
                  <td style={S.td}>{t('lore.admin.herePeople', 'Здесь → Люди')}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{holders('viewer')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ height: 12 }} />
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['агенты · роль', 'label (словарь)', 'что может писать', 'клиент'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {PROFILE_SCOPE.map(([p, allow]) => (
                  <tr key={p}>
                    <td style={S.td}><span style={S.pill('var(--inf)')}>agent-{p}</span></td>
                    <td style={S.td}>{agentRoles.find(r => r.code === p)?.label_ru ?? '—'}</td>
                    <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{allow}</td>
                    <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{agentByScope ? (agentByScope[p] ?? '—') : 'н/д'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === 'by-object' && (
        <>
          <div style={S.card}>{t('lore.admin.byObjectNote', 'Обратный вопрос — тот, который задают на ревью доступа: кто может трогать вот это? Красным подсвечены операции, доступные только людям (§4 спеки RBAC).')}</div>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['что', 'люди', 'агенты'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {REVERSE_MATRIX.map(r => (
                  <tr key={r.what} style={r.humanOnly ? { background: 'color-mix(in srgb, var(--dng) 7%, transparent)' } : undefined}>
                    <td style={S.td}>
                      <b style={{ color: 'var(--t1)' }}>{r.what}</b>{' '}
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{r.api}</span>
                    </td>
                    <td style={S.td}>
                      <span style={S.pill('var(--dng)')}>admin</span>
                      {r.what === 'Чтение (слайсы)' && <span style={{ ...S.pill('var(--t2)'), marginLeft: 4 }}>viewer</span>}
                    </td>
                    <td style={S.td}>
                      {r.humanOnly
                        ? <span style={{ color: 'var(--t3)' }}>{t('lore.admin.noAgents', 'никто — запрещено всем агентам, включая agent-full')}</span>
                        : r.agents.map(a => <span key={a} style={{ ...S.pill('var(--inf)'), marginRight: 4 }}>{a}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Словари (AL-34/41/42) ────────────────────────────────────────────────────
const COLOR_TOKENS: [string, string][] = [
  ['var(--acc)', 'акцент · --acc'], ['var(--suc)', 'успех · --suc'], ['var(--inf)', 'инфо · --inf'],
  ['var(--wrn)', 'внимание · --wrn'], ['var(--dng)', 'опасность · --dng'], ['var(--t2)', 'приглушённый · --t2'],
];
const GAME_ICON_NAMES: string[] = Object.keys((gameIconsData as { icons: Record<string, unknown> }).icons);

function DictsTab({ rows, areaUsage, onError, reload }: {
  rows: DictRow[]; areaUsage: Record<string, number>; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const types = useMemo(() => [...new Set(rows.map(r => r.dict_type))].sort(), [rows]);
  const dt = params.get('dict') ?? 'area';
  const setDt = (v: string) => {
    const p = new URLSearchParams(params); p.set('dict', v); setParams(p, { replace: true });
  };
  const [q, setQ] = useState('');
  const [active, setActive] = useState<'active' | 'all'>('active');
  const [edit, setEdit] = useState<DictRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmCanon, setConfirmCanon] = useState(false);
  const [confirmDeact, setConfirmDeact] = useState(false);
  const [saving, setSaving] = useState(false);

  const all = rows.filter(r => r.dict_type === dt);
  const shown = all
    .filter(r => active === 'all' || r.is_active)
    .filter(r => !q || r.code.includes(q.toLowerCase()) || (r.label_ru ?? '').toLowerCase().includes(q.toLowerCase()));
  const canon = CANON_TYPES.has(dt);
  const usage = (code: string): number | null => (dt === 'area' ? (areaUsage[code] ?? 0) : null);

  async function save(activeOverride?: boolean) {
    if (!edit || !edit.code.trim()) { onError(new Error('code обязателен')); return; }
    if (canon && !confirmCanon) return;
    setSaving(true);
    try {
      await loreMutate('/dict/entry', {
        dict_type: dt, code: edit.code.trim(),
        label_ru: edit.label_ru ?? null, label_en: edit.label_en || null,
        color: edit.color || null, icon: edit.icon || null,
        sort_order: edit.sort_order ?? null,
        is_active: activeOverride ?? edit.is_active, is_extensible: null,
      });
      setEdit(null); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); reload();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  const iconOk = !edit?.icon || iconLoaded(`game-icons:${edit.icon}`);
  const iconSuggestions = edit?.icon && !iconOk
    ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 6)
    : [];
  const editUsage = edit ? usage(edit.code) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {types.map(x => <button key={x} style={S.chip(dt === x)} onClick={() => { setDt(x); setEdit(null); }}>{x}</button>)}
      </div>
      {canon && <div style={S.warn}>{t('lore.admin.canonWarn', '⚠ Канон-словарь (ADR-LORE-010): значения зашиты в статусы всего корпуса. Правка label/color/icon безопасна; коды здесь не правятся вовсе.')}</div>}
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={all.length}
        seg={{ options: [['active', t('lore.admin.fltActive', 'Активные')], ['all', t('lore.admin.fltAll', 'Все')]], value: active, set: v => setActive(v as 'active' | 'all') }} />
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['код', 'подпись', 'вид', 'использований', 'поряд.', 'акт.', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(r => {
              const u = usage(r.code);
              return (
                <tr key={r.code} style={r.is_active ? undefined : { opacity: 0.55 }}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td>
                  <td style={S.td}>{r.label_ru ?? '—'}</td>
                  <td style={S.td}>
                    {/* AL-34: готовый чип вместо «квадратик + сырой CSS-текст» */}
                    <span style={S.live(r.color ?? 'var(--t3)')}>
                      {r.icon ? <GameIcon slug={r.icon} size={13} style={{ color: 'inherit' }} /> : null}
                      {r.label_ru ?? r.code}
                    </span>
                  </td>
                  <td style={{ ...S.td, ...S.num }} title={u === null ? t('lore.admin.usageNA', 'подсчёт для этого словаря появится с AL-30/SV-10') : undefined}>
                    {u === null ? <span style={{ color: 'var(--t3)' }}>н/д</span> : <span style={{ color: u ? 'var(--t2)' : 'var(--t3)' }}>{u}</span>}
                  </td>
                  <td style={{ ...S.td, ...S.num }}>{r.sort_order ?? '—'}</td>
                  <td style={S.td}>{r.is_active ? '✓' : '✗'}</td>
                  <td style={S.td}><button style={S.btn} onClick={() => { setEdit({ ...r }); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); }}>{t('lore.admin.edit', 'Править')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <button style={S.btn} onClick={() => { setEdit({ dict_type: dt, code: '', label_ru: '', label_en: null, color: null, icon: null, sort_order: (all.length + 1) * 10, is_active: true, is_extensible: true }); setIsNew(true); }}>
          {t('lore.admin.addValue', '+ значение')}
        </button>
      </div>
      {edit && (
        <div style={S.form}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fCode', 'Код')}
              {/* AL-41: code — ключ, которым связаны данные; правится только при создании */}
              <input style={{ ...S.input, fontFamily: 'var(--mono)', ...(isNew ? {} : { background: 'var(--bg3)', color: 'var(--t2)', cursor: 'not-allowed' }) }}
                value={edit.code} readOnly={!isNew}
                title={isNew ? undefined : t('lore.admin.codeLocked', 'Ключ — правке не подлежит (OQ-ADMIN-DICT-CODE)')}
                onChange={e => isNew && setEdit(f => f && ({ ...f, code: e.target.value }))} />
              {!isNew && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{t('lore.admin.codeLockedHint', 'ключ — правке не подлежит')}</span>}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fLabel', 'Подпись')}
              <input style={S.input} value={edit.label_ru ?? ''} onChange={e => setEdit(f => f && ({ ...f, label_ru: e.target.value }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fColor', 'Цвет')}
              {/* AL-42: выбор токена темы; смесь/произвольный CSS — в «расширенном» поле */}
              <select style={S.select} value={COLOR_TOKENS.some(([v]) => v === edit.color) ? edit.color! : '_custom'}
                onChange={e => { if (e.target.value !== '_custom') setEdit(f => f && ({ ...f, color: e.target.value })); }}>
                {COLOR_TOKENS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                <option value="_custom">{t('lore.admin.colorCustom', 'расширенный (CSS)…')}</option>
              </select>
              <input style={{ ...S.input, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }} placeholder="color-mix(in srgb, var(--acc) 55%, var(--inf))"
                value={edit.color ?? ''} onChange={e => setEdit(f => f && ({ ...f, color: e.target.value || null }))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fIcon', 'Иконка (game-icons)')}
              <input style={{ ...S.input, fontFamily: 'var(--mono)' }} placeholder="tied-scroll" list="gi-suggest"
                value={edit.icon ?? ''} onChange={e => setEdit(f => f && ({ ...f, icon: e.target.value || null }))} />
              <datalist id="gi-suggest">
                {(edit.icon ? GAME_ICON_NAMES.filter(n => n.includes(edit.icon!.toLowerCase())).slice(0, 20) : []).map(n => <option key={n} value={n} />)}
              </datalist>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {t('lore.admin.fOrder', 'Порядок')}
              <input style={{ ...S.input, width: 70 }} type="number" value={edit.sort_order ?? 0} onChange={e => setEdit(f => f && ({ ...f, sort_order: Number(e.target.value) }))} />
            </label>
          </div>

          {/* AL-42: живое превью — цвет и иконка вместе, как они встанут в UI */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 5, background: 'var(--bg1)' }}>
            <span style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--t3)' }}>{t('lore.admin.preview', 'Так это будет выглядеть')}</span>
            <span style={S.live(edit.color ?? 'var(--t3)')}>
              {edit.icon && iconOk ? <GameIcon slug={edit.icon} size={14} style={{ color: 'inherit' }} /> : null}
              {edit.label_ru || edit.code || '—'}
            </span>
            {!iconOk && (
              <span style={{ color: 'var(--dng)', fontSize: 'var(--fs-xs)' }}>
                ✕ {t('lore.admin.iconBad', 'иконки с таким именем нет — будет пусто.')}{' '}
                {iconSuggestions.length > 0 && <>{t('lore.admin.iconMaybe', 'Похожие:')} {iconSuggestions.join(', ')}</>}
              </span>
            )}
          </div>

          {editUsage !== null && editUsage > 0 && (
            <div style={S.warn}>
              <b>{t('lore.admin.usageWarn', '{{n}} сущностей несут этот код.', { n: editUsage })}</b>{' '}
              {t('lore.admin.usageWarn2', 'Изменение цвета/иконки поменяет их вид во всём LORE; деактивация потребует подтверждения.')}
            </div>
          )}
          {canon && (
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--wrn)' }}>
              <input type="checkbox" checked={confirmCanon} onChange={e => setConfirmCanon(e.target.checked)} />{' '}
              {t('lore.admin.canonConfirm', 'Понимаю: это канон-словарь, изменение затрагивает весь корпус')}
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={S.primary} disabled={saving || (canon && !confirmCanon)} onClick={() => save()}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
            <button style={S.btn} onClick={() => { setEdit(null); setIsNew(false); setConfirmCanon(false); setConfirmDeact(false); }}>{t('lore.admin.cancel', 'Отмена')}</button>
            {!isNew && edit.is_active && (
              <span style={{ marginLeft: 'auto' }}>
                {confirmDeact
                  ? <button style={S.danger} disabled={saving || (canon && !confirmCanon)} onClick={() => save(false)}>
                      {t('lore.admin.deactConfirm', 'Точно деактивировать{{u}}?', { u: editUsage ? ` (${editUsage} использований)` : '' })}
                    </button>
                  : <button style={S.danger} onClick={() => setConfirmDeact(true)}>{t('lore.admin.deact', 'Деактивировать…')}</button>}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Проекты ──────────────────────────────────────────────────────────────────
function ProjectsTab({ rows, sprints, onError, reload }: {
  rows: ProjRow[]; sprints: Record<string, number>; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<ProjRow | null>(null);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit(p: ProjRow) {
    setEdit({ ...p });
    try { setHosts(p.hosts ? (JSON.parse(p.hosts) as HostRow[]) : []); } catch { setHosts([]); }
  }
  async function save() {
    if (!edit) return;
    setSaving(true);
    try {
      await loreMutate('/project', {
        slug: edit.slug, name: edit.name ?? null,
        hosts: hosts.length ? JSON.stringify(hosts) : null,
        default_branch: edit.default_branch || null,
      });
      setEdit(null); reload();
    } catch (e) { onError(e); } finally { setSaving(false); }
  }
  const setHost = (i: number, k: keyof HostRow, v: string) => setHosts(hs => hs.map((h, j) => j === i ? { ...h, [k]: v } : h));

  const shown = rows.filter(p => !q || p.slug.toLowerCase().includes(q.toLowerCase()) || (p.name ?? '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} />
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['slug', 'имя', 'branch', 'хосты', 'спринтов', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.slug}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{p.slug}</td>
                <td style={S.td}>{p.name ?? '—'}</td>
                <td style={S.td}>{p.default_branch ?? '—'}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
                  {p.hosts ? (() => { try { return (JSON.parse(p.hosts) as HostRow[]).map(h => h.remote).join(' · '); } catch { return '⚠ bad JSON'; } })() : '—'}
                </td>
                <td style={{ ...S.td, ...S.num }}><span style={{ color: sprints[p.slug] ? 'var(--t2)' : 'var(--t3)' }}>{sprints[p.slug] ?? 0}</span></td>
                <td style={S.td}><button style={S.btn} onClick={() => startEdit(p)}>{t('lore.admin.edit', 'Править')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div style={S.form}>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)' }}>{edit.slug}</div>
          <input style={S.input} placeholder="name" value={edit.name ?? ''} onChange={e => setEdit(f => f && ({ ...f, name: e.target.value }))} />
          <input style={S.input} placeholder="default_branch" value={edit.default_branch ?? ''} onChange={e => setEdit(f => f && ({ ...f, default_branch: e.target.value }))} />
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{t('lore.admin.hosts', 'Хостинги (origin + зеркала, ADR-018)')}</div>
          {hosts.map((h, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 80px 1fr 1fr 1fr auto', gap: 4 }}>
              <input style={S.input} placeholder="remote" value={h.remote} onChange={e => setHost(i, 'remote', e.target.value)} />
              <input style={S.input} placeholder="role" value={h.role} onChange={e => setHost(i, 'role', e.target.value)} />
              <input style={S.input} placeholder="base_url" value={h.base_url} onChange={e => setHost(i, 'base_url', e.target.value)} />
              <input style={S.input} placeholder="file_url_template" value={h.file_url_template} onChange={e => setHost(i, 'file_url_template', e.target.value)} />
              <input style={S.input} placeholder="pr_url_template" value={h.pr_url_template} onChange={e => setHost(i, 'pr_url_template', e.target.value)} />
              <button style={S.btn} onClick={() => setHosts(hs => hs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div>
            <button style={S.btn} onClick={() => setHosts(hs => [...hs, { remote: '', role: hs.length ? 'mirror' : 'primary', base_url: '', file_url_template: '{base}/src/branch/{branch}/{path}', pr_url_template: '{base}/pulls/{number}' }])}>
              {t('lore.admin.addHost', '+ хостинг')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={S.primary} disabled={saving} onClick={save}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
            <button style={S.btn} onClick={() => setEdit(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Теги (AL-40: поиск/сортировка по 93 строкам) ────────────────────────────
function TagsTab({ know, lore }: { know: TagRow[]; lore: TagRow[] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'uses' | 'alpha'>('uses');
  const list = (title: string, rows: TagRow[]) => {
    const shown = rows
      .filter(r => !q || r.tag_id.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => sort === 'uses' ? b.uses - a.uses : a.tag_id.localeCompare(b.tag_id));
    return (
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
          {title} · {shown.length}/{rows.length}
        </div>
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>тег</th><th style={S.th}>использований</th></tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.tag_id} style={r.uses === 0 ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.tag_id}</td>
                  <td style={{ ...S.td, ...S.num }}>
                    {r.uses}{r.uses === 0 && <span style={{ color: 'var(--t3)', fontFamily: 'inherit' }}> · {t('lore.admin.tagOrphan', 'кандидат на удаление')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <div>
      <div style={S.card}>{t('lore.admin.tagsNote', 'Read-only (D6): слияние/переименование — 2-я итерация (миграция рёбер TAGGED_WITH, AL-29 ждёт решения владельца).')}</div>
      <Toolbar q={q} setQ={setQ}
        shown={know.filter(r => !q || r.tag_id.includes(q.toLowerCase())).length + lore.filter(r => !q || r.tag_id.includes(q.toLowerCase())).length}
        total={know.length + lore.length}
        seg={{ options: [['uses', t('lore.admin.byUses', 'По использованию')], ['alpha', t('lore.admin.byAlpha', 'По алфавиту')]], value: sort, set: v => setSort(v as 'uses' | 'alpha') }} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {list('KnowTag (ADR/решения/задачи)', know)}
        {list('LoreTag (темы вопросов)', lore)}
      </div>
    </div>
  );
}

// ── Настройки (AL-38 + чеклист AL-35 + отказы AL-45) ────────────────────────
function SettingsTab({ dicts, preflight, onError, reload }: {
  dicts: DictRow[]; preflight: Preflight | null; onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const role = useRole();
  const [busy, setBusy] = useState(false);
  const [denials, setDenials] = useState<Denial[] | null>(null);

  useEffect(() => {
    loadKcObj<{ denials: Denial[] }>('/lore/kc/denials').then(r => setDenials(r?.denials ?? null));
  }, []);

  const settings = dicts.filter(r => r.dict_type === 'app_setting' && r.is_active);
  const known = settings.filter(s => KNOWN_SETTINGS.some(k => k.key === s.code));
  const unknown = settings.filter(s => !KNOWN_SETTINGS.some(k => k.key === s.code));

  async function removeUnknown(code: string) {
    setBusy(true);
    try {
      await loreMutate('/dict/entry', { dict_type: 'app_setting', code, is_active: false, label_ru: null, label_en: null, color: null, icon: null, sort_order: null, is_extensible: null });
      reload();
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  const pf = preflight;
  const checks: { ok: boolean; title: string; sub: string }[] = pf ? [
    {
      ok: pf.admin_count > 0,
      title: t('lore.admin.chkAdmins', 'Есть хотя бы один человек с ролью admin'),
      sub: pf.admin_count === -1
        ? t('lore.admin.chkAdminsUnknown', 'Число админов неизвестно: KC-мост не настроен или не ответил.')
        : t('lore.admin.chkAdminsN', 'Сейчас: {{n}}. Заведите себя на вкладке «Люди» и назначьте admin.', { n: pf.admin_count }),
    },
    {
      ok: pf.kc_configured && pf.kc_reachable,
      title: t('lore.admin.chkKc', 'Keycloak доступен'),
      sub: pf.kc_configured
        ? (pf.kc_reachable ? t('lore.admin.chkKcOk', 'Мост отвечает.') : `KC не ответил: ${pf.kc_error}`)
        : t('lore.admin.chkKcOff', 'KC_ADMIN_CLIENT_SECRET не задан.'),
    },
    {
      ok: pf.agent_scope_enforced,
      title: t('lore.admin.chkScope', 'Права агентов проверяются на бэкенде'),
      sub: t('lore.admin.chkScopeSub', 'AgentScopeFilter ещё не включён (AL-17): после включения auth агенты пройдут в любое семейство.'),
    },
  ] : [];

  return (
    <div>
      <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 6px' }}>{t('lore.admin.authBlockH', 'Включение аутентификации')}</h3>
      {pf ? (
        <>
          {!pf.can_enable_auth && (
            <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
              <b>{t('lore.admin.cantEnableH', 'Включать auth сейчас нельзя.')}</b> {pf.hint}
            </div>
          )}
          <div style={{ border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 12px', marginBottom: 8 }}>
            {checks.map(c => (
              <div key={c.title} style={S.check}>
                <span style={S.mark(c.ok)}>{c.ok ? '✓' : '✕'}</span>
                <span>
                  <b style={{ color: 'var(--t1)' }}>{c.title}</b>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{c.sub}</div>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
            <button style={{ ...S.primary, opacity: pf.can_enable_auth ? 1 : 0.45, cursor: pf.can_enable_auth ? 'pointer' : 'not-allowed' }} disabled>
              {t('lore.admin.enableAuth', 'Включить аутентификацию')}
            </button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>
              {t('lore.admin.enableAuthNote', 'Сам флип — env (LORE_AUTH_ENABLED=true) + рестарт по RUNBOOK-AUTH-OMILORE, все флаги вместе (AL-12 — владелец лично). Кнопка станет активной формой, когда появится рантайм-ручка.')}
            </span>
          </div>
        </>
      ) : (
        <div style={S.card}>{t('lore.admin.pfLoading', 'Проверки грузятся (или KC-мост недоступен — тогда чеклист покажет это явно после ответа).')}</div>
      )}

      <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 6px' }}>{t('lore.admin.paramsH', 'Параметры приложения')}</h3>
      {KNOWN_SETTINGS.length === 0 && (
        <div style={S.card}>
          {t('lore.admin.noKnownSettings', 'Приложение пока не читает ни одного ключа app_setting — реестр известных параметров пуст (AL-38). Появится реальный параметр → он получит здесь строку с типом, дефолтом и описанием; свободного ввода ключей больше нет: выдуманный ключ не прочитает никто.')}
        </div>
      )}
      {known.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['ключ', 'значение', 'описание'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{known.map(s => (
              <tr key={s.code}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.code}</td>
                <td style={S.td}>{s.label_ru}</td>
                <td style={S.td}>{KNOWN_SETTINGS.find(k => k.key === s.code)?.descr}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {unknown.length > 0 && (
        <div style={{ ...S.warn, marginTop: 10 }}>
          <b>{t('lore.admin.unknownH', 'Неопознанные значения · {{n}}', { n: unknown.length })}</b>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)', margin: '4px 0 8px' }}>
            {t('lore.admin.unknownB', 'Эти ключи лежат в базе (dict_type=app_setting), но приложение их не читает — скорее всего, остались от ручной правки. Удаление ни на что не повлияет (soft-delete: is_active=false).')}
          </div>
          <div style={S.tw}>
            <table style={S.table}>
              <thead><tr>{['ключ', 'значение', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{unknown.map(s => (
                <tr key={s.code}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.code}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{s.label_ru}</td>
                  <td style={S.td}><button style={S.danger} disabled={busy} onClick={() => removeUnknown(s.code)}>{t('lore.admin.remove', 'Удалить')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 'var(--fs-md)', margin: '18px 0 6px' }}>{t('lore.admin.denialsH', 'Последние отказы доступа')}</h3>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginBottom: 6 }}>
        {t('lore.admin.denialsSrc', 'Источник: память процесса с последнего рестарта (кольцевой буфер, AL-45). Долговременный аудит по осям — AL-20.')}
      </div>
      {denials === null && <div style={S.card}>{t('lore.admin.denialsNA', 'Недоступно (нужна роль admin или бэкенд старой версии).')}</div>}
      {denials !== null && denials.length === 0 && <div style={S.card}>{t('lore.admin.denialsEmpty', 'С последнего рестарта отказов не было.')}</div>}
      {denials !== null && denials.length > 0 && (
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr>{['когда', 'метод', 'путь', 'статус', 'ошибка', 'роль'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{denials.slice(0, 30).map((d, i) => (
              <tr key={i}>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', whiteSpace: 'nowrap' }}>{d.ts.replace('T', ' ').slice(0, 19)}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{d.method}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.path}</td>
                <td style={{ ...S.td, color: 'var(--dng)', fontFamily: 'var(--mono)' }}>{d.status}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.error || '—'}</td>
                <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>{d.role}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div style={{ height: 12 }} />
      <div style={{ ...S.card, opacity: 0.75 }}><b>Auth:</b> {AUTH_ENABLED ? 'включён (JWT, роль из seer_roles)' : 'выключен — dev-режим, роль из конфига (VITE_LORE_ROLE)'} · {t('lore.admin.roleNow', 'текущая роль')}: <b>{role}</b></div>
      <div style={{ ...S.card, opacity: 0.75 }}><b>LORE_ACTIVE_PROJECT:</b> {t('lore.admin.setProj', 'сессионный дефолт проекта MCP-процесса (env, ADR-LORE-017) — задаётся в .mcp.json/OpenCode-конфиге, из UI не читается')}</div>
    </div>
  );
}
