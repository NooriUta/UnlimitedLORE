import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreSlice, loreMutate } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { AUTH_ENABLED } from '../../auth/session';
import { useRole } from '../../auth/useRole';

// ⚙ Admin LORE (ADR-LORE-025): reference-data management behind the admin gate.
// Write path = the SAME endpoints MCP uses (dict_set → /lore/dict, project_new
// → /lore/project) — no parallel admin API (D4). Canon dictionaries get a
// two-step confirm before write (D5, MVP: confirm + area-usage reconcile line).

interface DictRow { dict_type: string; code: string; label_ru: string | null; label_en: string | null; color: string | null; icon: string | null; sort_order: number | null; is_active: boolean; is_extensible: boolean }
interface ProjRow { slug: string; name: string | null; default_branch: string | null; is_private: boolean | null; hosts: string | null }
interface TagRow { tag_id: string; uses: number }
interface HostRow { remote: string; role: string; base_url: string; file_url_template: string; pr_url_template: string; default_branch?: string }

const CANON_TYPES = new Set(['adr_status', 'sprint_status', 'task_status', 'priority']);
type Tab = 'dicts' | 'projects' | 'users' | 'agents' | 'roles' | 'tags' | 'settings';

// KC-мост (ADR-LORE-025 D11/D12): люди — realm-роли, агенты — client-роли.
interface KcUser { id: string; username: string; email: string | null; enabled: boolean; roles: string[] }
interface KcAgent { clientId: string; id: string; enabled: boolean; agent_scope: string[] }

// RBAC scope per ADR-LORE-014 §3 (agent-profiles are files; read-only view).
const PROFILE_SCOPE: [string, string][] = [
  ['full', '"*": allow (primary — Claude/backfill)'],
  ['architect', 'adr_* · component_* · tech_* · spec_* · runbook_* · doc_* · decision_* · question_* · project_new · status_set'],
  ['developer', 'task_* · release_* · tech_* · spec_* · runbook_* · doc_* · adr_new · status_set'],
  ['tester', 'qg_* · task_* · status_set · status_set_batch'],
  ['pm', 'sprint_* · task_* · milestone_* · question_* · project_new · status_set · status_set_batch'],
  ['analyst', 'metric_* · insight_* · rec_* · question_* · task_set · status_set'],
  ['marketer', 'bragi_* · task_* · insight_* · rec_* · doc_* · status_set'],
];

// AL-31: у KC-моста ЧЕТЫРЕ разных исхода, и «пусто» — только один из них.
// Раньше 403/5xx уходили в onError (страничная ошибка) или молча давали пустой
// список, и экран одинаково бодро предлагал «завести первого» — при том что
// отказ в доступе и неподнятый KC требуют противоположных действий.
type KcState<T> =
  | { k: 'loading' }
  | { k: 'ok'; rows: T[] }
  | { k: 'forbidden' }              // 403 — роль не пускает; люди могут быть
  | { k: 'off'; detail: string }    // 503 — моста нет, состояние неизвестно
  | { k: 'error'; detail: string }; // сеть/5xx — то же, но без внятной причины

async function loadKc<T>(path: string): Promise<KcState<T>> {
  try {
    const r = await fetch(path, { headers: { 'X-Seer-Role': 'admin' } });
    if (r.status === 403) return { k: 'forbidden' };
    if (r.status === 503) return { k: 'off', detail: (await r.json().catch(() => ({}))).detail ?? 'not configured' };
    if (!r.ok) return { k: 'error', detail: `HTTP ${r.status}` };
    return { k: 'ok', rows: (await r.json()) as T[] };
  } catch (e) { return { k: 'error', detail: e instanceof Error ? e.message : String(e) }; }
}

const S = {
  root: { flex: 1, overflowY: 'auto' as const, padding: '10px 16px' },
  tabs: { display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' as const },
  tab: (on: boolean) => ({
    font: 'inherit', fontSize: 'var(--fs-sm)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${on ? 'color-mix(in srgb, var(--acc) 55%, var(--bd))' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 12%, transparent)' : 'transparent',
    color: on ? 'var(--acc)' : 'var(--t3)', fontWeight: on ? 600 : 400,
  }),
  chip: (on: boolean) => ({
    font: 'inherit', fontSize: 'var(--fs-xs)', padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    color: on ? 'var(--acc)' : 'var(--t3)',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--fs-sm)' },
  th: { textAlign: 'left' as const, padding: '4px 8px', color: 'var(--t3)', fontSize: 'var(--fs-2xs)', textTransform: 'uppercase' as const, letterSpacing: '.05em', borderBottom: '1px solid var(--bd)' },
  td: { padding: '4px 8px', borderBottom: '1px solid var(--bd)', color: 'var(--t2)' },
  input: { fontSize: 'var(--fs-sm)', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--bg1)', color: 'var(--t1)', fontFamily: 'inherit' },
  btn: { fontSize: 'var(--fs-sm)', padding: '3px 10px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t2)' },
  primary: { fontSize: 'var(--fs-sm)', padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, border: '1px solid var(--acc)', background: 'var(--acc)', color: 'var(--bg1)' },
  warn: { fontSize: 'var(--fs-sm)', color: 'var(--wrn)', border: '1px solid color-mix(in srgb, var(--wrn) 40%, transparent)', background: 'color-mix(in srgb, var(--wrn) 8%, transparent)', borderRadius: 5, padding: '6px 10px', margin: '6px 0' },
  card: { border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 'var(--fs-sm)', color: 'var(--t2)' },
  form: { display: 'flex', flexDirection: 'column' as const, gap: 6, padding: 10, margin: '8px 0', border: '1px solid var(--b3)', borderRadius: 6, background: 'var(--bg2)' },
  sw: (c: string | null) => ({ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: c ?? 'transparent', border: '1px solid var(--b3)', verticalAlign: 'middle' }),
  // AL-37: небезопасное состояние — во всю ширину. Было — серым шёпотом в углу,
  // тише декоративной плашки палитры, хотя означает «админ — любой, кто открыл адрес».
  banner: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 10,
    borderRadius: 5, fontSize: 'var(--fs-sm)', color: 'var(--t1)',
    background: 'color-mix(in srgb, var(--wrn) 16%, transparent)',
    border: '1px solid color-mix(in srgb, var(--wrn) 45%, var(--bd))',
  },
  // AL-31: пустое / отказ / мост недоступен — разные экраны, а не один текст.
  state: (tone: 'neutral' | 'bad') => ({
    border: `1px ${tone === 'bad' ? 'solid' : 'dashed'} ${tone === 'bad' ? 'color-mix(in srgb, var(--dng) 50%, var(--bd))' : 'var(--bd)'}`,
    borderRadius: 6, padding: '18px 14px', textAlign: 'center' as const, color: 'var(--t2)', fontSize: 'var(--fs-sm)',
  }),
  stateH: (tone: 'neutral' | 'bad') => ({ fontWeight: 600, marginBottom: 4, color: tone === 'bad' ? 'var(--dng)' : 'var(--t1)' }),
  stateCode: { display: 'block', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--t3)' },
};

/** AL-31: один и тот же разбор исходов для «Людей» и «Агентов». */
function KcStateView({ s, empty }: { s: KcState<unknown>; empty: React.ReactNode }) {
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

const TABS: [Tab, string][] = [
  ['dicts', 'Словари'], ['projects', 'Проекты'], ['users', 'Пользователи'],
  ['agents', 'Агенты'], ['roles', 'Роли'], ['tags', 'Теги'], ['settings', 'Настройки'],
];

export default function LoreAdminPanel({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const role = useRole();
  // AL-39: вкладка живёт в URL (?section=admin&tab=agents) — как паспорт сущности.
  // Было: состояние только в useState → F5 ронял на «Словари», ссылку на вкладку
  // дать было нельзя, «назад» уводил из панели целиком.
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'dicts') as Tab;
  const setTab = (k: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', k);
    setParams(p, { replace: true }); // replace: вкладки не копят историю, «назад» уходит из панели
  };
  return (
    <div style={S.root}>
      {!AUTH_ENABLED && (
        <div style={S.banner}>
          <span aria-hidden>⚠</span>
          <span>
            <b>{t('lore.admin.devBannerH', 'Аутентификация выключена.')}</b>{' '}
            {t('lore.admin.devBannerB', 'Администрировать LORE может любой, кто открыл этот адрес: роль берётся из конфига, а не из токена. Режим разработки.')}
          </span>
        </div>
      )}
      <div style={S.tabs}>
        {TABS.map(([k, l]) => (
          <button key={k} style={S.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
          {t('lore.admin.roleBadge', 'роль: {{role}} · auth: {{auth}}', { role, auth: AUTH_ENABLED ? 'on' : 'off (dev)' })}
        </span>
      </div>
      {tab === 'dicts' && <DictsTab onError={onError} />}
      {tab === 'projects' && <ProjectsTab onError={onError} />}
      {tab === 'users' && <UsersTab onError={onError} />}
      {tab === 'agents' && <AgentsTab onError={onError} />}
      {tab === 'roles' && <RolesTab onError={onError} />}
      {tab === 'tags' && <TagsTab onError={onError} />}
      {tab === 'settings' && <SettingsTab onError={onError} />}
    </div>
  );
}

function DictsTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DictRow[]>([]);
  const [dt, setDt] = useState<string>('area');
  const [edit, setEdit] = useState<DictRow | null>(null); // code '' = new
  const [confirmCanon, setConfirmCanon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [reconcile, setReconcile] = useState<string | null>(null);

  useEffect(() => {
    fetchLoreSlice<DictRow>('dictionary', {}).then(setRows).catch(onError);
  }, [onError, reload]);

  const types = useMemo(() => [...new Set(rows.map(r => r.dict_type))].sort(), [rows]);
  const shown = rows.filter(r => r.dict_type === dt);
  const canon = CANON_TYPES.has(dt);

  async function save() {
    if (!edit || !edit.code.trim()) { onError(new Error('code обязателен')); return; }
    if (canon && !confirmCanon) return;
    setSaving(true);
    try {
      await loreMutate('/dict/entry', {
        dict_type: dt, code: edit.code.trim(),
        label_ru: edit.label_ru ?? null, label_en: edit.label_en || null,
        color: edit.color || null, icon: edit.icon || null,
        sort_order: edit.sort_order ?? null, is_active: edit.is_active, is_extensible: null,
      });
      // D5 reconcile (MVP): для area — сколько компонентов ссылаются на код.
      if (dt === 'area') {
        const comps = await fetchLoreSlice<{ component_id: string; area: string | null }>('components', {});
        const n = comps.filter(c => c.area === edit.code.trim()).length;
        setReconcile(t('lore.admin.reconcileArea', 'reconcile: {{n}} компонентов ссылаются на area «{{code}}»', { n, code: edit.code.trim() }));
      } else setReconcile(null);
      setEdit(null); setConfirmCanon(false); setReload(x => x + 1);
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {types.map(x => <button key={x} style={S.chip(dt === x)} onClick={() => { setDt(x); setEdit(null); }}>{x}</button>)}
      </div>
      {canon && <div style={S.warn}>{t('lore.admin.canonWarn', '⚠ Канон-словарь (ADR-LORE-010): смена code ломает денормализацию и группировки. Правка label/color/icon — безопасна.')}</div>}
      {reconcile && <div style={{ ...S.card, color: 'var(--inf)' }}>{reconcile}</div>}
      <table style={S.table}>
        <thead><tr>{['code', 'label', 'цвет', 'иконка', 'поряд.', 'акт.', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {shown.map(r => (
            <tr key={r.code}>
              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td>
              <td style={S.td}>{r.label_ru ?? '—'}</td>
              <td style={S.td}><span style={S.sw(r.color)} /> <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{r.color ?? ''}</span></td>
              <td style={S.td}>{r.icon ? <GameIcon slug={r.icon} size={13} /> : '—'}</td>
              <td style={S.td}>{r.sort_order ?? '—'}</td>
              <td style={S.td}>{r.is_active ? '✓' : '✗'}</td>
              <td style={S.td}><button style={S.btn} onClick={() => { setEdit({ ...r }); setConfirmCanon(false); }}>✎</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button style={S.btn} onClick={() => setEdit({ dict_type: dt, code: '', label_ru: '', label_en: null, color: null, icon: null, sort_order: (shown.length + 1) * 10, is_active: true, is_extensible: true })}>
          {t('lore.admin.addValue', '+ значение')}
        </button>
      </div>
      {edit && (
        <div style={S.form}>
          <input style={S.input} placeholder="code" value={edit.code} disabled={shown.some(r => r.code === edit.code) && edit.code !== ''}
            onChange={e => setEdit(f => f && ({ ...f, code: e.target.value }))} />
          <input style={S.input} placeholder="label_ru" value={edit.label_ru ?? ''} onChange={e => setEdit(f => f && ({ ...f, label_ru: e.target.value }))} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ ...S.input, flex: 1 }} placeholder="color (var(--suc))" value={edit.color ?? ''} onChange={e => setEdit(f => f && ({ ...f, color: e.target.value }))} />
            <input style={{ ...S.input, flex: 1 }} placeholder="icon (game-icons slug)" value={edit.icon ?? ''} onChange={e => setEdit(f => f && ({ ...f, icon: e.target.value }))} />
            <input style={{ ...S.input, width: 80 }} type="number" placeholder="order" value={edit.sort_order ?? 0} onChange={e => setEdit(f => f && ({ ...f, sort_order: Number(e.target.value) }))} />
          </div>
          <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)' }}>
            <input type="checkbox" checked={edit.is_active} onChange={e => setEdit(f => f && ({ ...f, is_active: e.target.checked }))} /> is_active (soft-delete при снятии)
          </label>
          {canon && (
            <label style={{ fontSize: 'var(--fs-sm)', color: 'var(--wrn)' }}>
              <input type="checkbox" checked={confirmCanon} onChange={e => setConfirmCanon(e.target.checked)} /> {t('lore.admin.canonConfirm', 'Понимаю: это канон-словарь, изменение затрагивает весь корпус')}
            </label>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={S.primary} disabled={saving || (canon && !confirmCanon)} onClick={save}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
            <button style={S.btn} onClick={() => { setEdit(null); setConfirmCanon(false); }}>{t('lore.admin.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectsTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProjRow[]>([]);
  const [edit, setEdit] = useState<ProjRow | null>(null);
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => { fetchLoreSlice<ProjRow>('git_projects', {}).then(setRows).catch(onError); }, [onError, reload]);

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
      setEdit(null); setReload(x => x + 1);
    } catch (e) { onError(e); } finally { setSaving(false); }
  }
  const setHost = (i: number, k: keyof HostRow, v: string) => setHosts(hs => hs.map((h, j) => j === i ? { ...h, [k]: v } : h));

  return (
    <div>
      <table style={S.table}>
        <thead><tr>{['slug', 'name', 'branch', 'private', 'hosts', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.slug}>
              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{p.slug}</td>
              <td style={S.td}>{p.name ?? '—'}</td>
              <td style={S.td}>{p.default_branch ?? '—'}</td>
              <td style={S.td}>{p.is_private ? '🔒' : '—'}</td>
              <td style={S.td}>{p.hosts ? (() => { try { return (JSON.parse(p.hosts) as HostRow[]).map(h => h.remote).join(', '); } catch { return '⚠ bad JSON'; } })() : '—'}</td>
              <td style={S.td}><button style={S.btn} onClick={() => startEdit(p)}>✎</button></td>
            </tr>
          ))}
        </tbody>
      </table>
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

// ── Пользователи (люди: realm-роли, KC-мост) ────────────────────────────────
// D11: паролей здесь нет — создание отдаёт пользователя в KC (reset-link).
// D12: только человеческий admin; эскалация до super-admin — вне моста.
function UsersTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [st, setSt] = useState<KcState<KcUser>>({ k: 'loading' });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [nu, setNu] = useState<{ username: string; email: string } | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState<string | null>(null); // userId, кому даём admin

  useEffect(() => { loadKc<KcUser>('/lore/kc/users').then(setSt); }, [reload]);
  const rows = st.k === 'ok' ? st.rows : [];

  async function setRole(id: string, role: string, action: 'add' | 'remove') {
    setBusy(true);
    try { await loreMutate(`/kc/user/${id}/role`, { role, action }); setReload(x => x + 1); setConfirmAdmin(null); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }
  async function create() {
    if (!nu?.username.trim()) return;
    setBusy(true);
    try { await loreMutate('/kc/user', { username: nu.username.trim(), email: nu.email.trim() || null }); setNu(null); setReload(x => x + 1); }
    catch (e) { onError(e); } finally { setBusy(false); }
  }

  // AL-31: не-ok исходы (403/503/сеть) заменяют таблицу целиком — иначе экран
  // предлагает «завести первого» там, где на самом деле отказ или мёртвый мост.
  if (st.k !== 'ok') return (
    <div>
      <div style={S.card}>{t('lore.admin.usersNote', 'Люди — realm-роли Keycloak (ось «люди»). Паролей LORE не хранит: пользователь задаёт его в KC. Роль super-admin назначается только в KC-консоли (вне моста, D11).')}</div>
      <KcStateView s={st} empty={null} />
    </div>
  );
  return (
    <div>
      <div style={S.card}>{t('lore.admin.usersNote', 'Люди — realm-роли Keycloak (ось «люди»). Паролей LORE не хранит: пользователь задаёт его в KC. Роль super-admin назначается только в KC-консоли (вне моста, D11).')}</div>
      <table style={S.table}>
        <thead><tr>{['логин', 'email', 'вкл', 'роли', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {(rows ?? []).map(u => (
            <tr key={u.id}>
              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{u.username}</td>
              <td style={S.td}>{u.email ?? '—'}</td>
              <td style={S.td}>{u.enabled ? '✓' : '✗'}</td>
              <td style={S.td}>
                {(u.roles ?? []).filter(r => ['admin', 'super-admin', 'viewer'].includes(r)).map(r => (
                  <span key={r} style={{ ...S.chip(true), marginRight: 4 }}>
                    {r}{r !== 'super-admin' && <button style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
                      disabled={busy} onClick={() => setRole(u.id, r, 'remove')}> ✕</button>}
                  </span>
                ))}
              </td>
              <td style={S.td}>
                {!u.roles?.includes('viewer') && <button style={S.btn} disabled={busy} onClick={() => setRole(u.id, 'viewer', 'add')}>+viewer</button>}{' '}
                {!u.roles?.includes('admin') && (confirmAdmin === u.id
                  ? <button style={S.primary} disabled={busy} onClick={() => setRole(u.id, 'admin', 'add')}>{t('lore.admin.confirmAdmin', 'точно admin?')}</button>
                  : <button style={S.btn} disabled={busy} onClick={() => setConfirmAdmin(u.id)}>+admin</button>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
            <input style={S.input} placeholder="логин" value={nu.username} onChange={e => setNu(v => v && ({ ...v, username: e.target.value }))} />
            <input style={S.input} placeholder="email (опц.)" value={nu.email} onChange={e => setNu(v => v && ({ ...v, email: e.target.value }))} />
            <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{t('lore.admin.noPassNote', 'Пароль задаётся в Keycloak (reset-link/консоль) — LORE его не принимает и не хранит.')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.primary} disabled={busy} onClick={create}>{busy ? '…' : t('lore.admin.create', 'Создать')}</button>
              <button style={S.btn} onClick={() => setNu(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
            </div>
          </div>
        ) : <button style={S.btn} onClick={() => setNu({ username: '', email: '' })}>{t('lore.admin.addUser', '+ пользователь')}</button>}
      </div>
    </div>
  );
}

// ── Агенты (client-роли: ось агентов) — read + ротация секрета ──────────────
function AgentsTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [st, setSt] = useState<KcState<KcAgent>>({ k: 'loading' });
  const [secret, setSecret] = useState<{ client: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadKc<KcAgent>('/lore/kc/agents').then(setSt); }, []);
  const rows = st.k === 'ok' ? st.rows : [];

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
  return (
    <div>
      {note}
      <NotEnforcedNotice />
      {secret && (
        <div style={{ ...S.warn, color: 'var(--suc)', borderColor: 'color-mix(in srgb, var(--suc) 40%, transparent)' }}>
          <div>{t('lore.admin.newSecret', 'Новый секрет {{c}} — скопируйте сейчас, больше не покажем:', { c: secret.client })}</div>
          <code style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-all' }}>{secret.value}</code>
          <div><button style={S.btn} onClick={() => setSecret(null)}>{t('lore.admin.hide', 'скрыть')}</button></div>
        </div>
      )}
      <table style={S.table}>
        <thead><tr>{['клиент', 'agent_scope', 'вкл', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {(rows ?? []).map(a => (
            <tr key={a.id}>
              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{a.clientId}</td>
              <td style={S.td}>
                {(a.agent_scope ?? []).length
                  ? a.agent_scope.map(s => <span key={s} style={{ ...S.chip(true), marginRight: 4 }}>{s}</span>)
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
  );
}

// AL-33: экран не имеет права утверждать наличие защиты, которой нет.
// Матрица ниже — клиентский JSON-вайтлист (SPEC-RBAC-OMILORE-AGENTS §1: «фильтр
// видимости, не безопасность»). AgentScopeFilter не написан (AL-17) → клейм
// agent_scope бэкендом не читается вообще. Плашка снимается вместе с R2.
function NotEnforcedNotice() {
  const { t } = useTranslation();
  return (
    <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
      <b>{t('lore.admin.notEnforcedH', 'Права из этой таблицы пока не проверяются.')}</b>{' '}
      {t('lore.admin.notEnforcedB', 'Клейм agent_scope бэкенд ещё не читает: сейчас это фильтр видимости инструментов, не защита. Включится в R2 — задача AL-17.')}
    </div>
  );
}

function RolesTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<DictRow[]>([]);
  useEffect(() => { fetchLoreSlice<DictRow>('dictionary', { dict_type: 'agent_role' }).then(setRoles).catch(onError); }, [onError]);
  return (
    <div>
      <div style={S.card}>{t('lore.admin.rolesNote', 'Read-only (ADR-LORE-025 D6): RBAC-скоуп правится в mcp-server/agent-profiles/*.json, роли-значения — в словаре agent_role.')}</div>
      <NotEnforcedNotice />
      <table style={S.table}>
        <thead><tr>{['роль (словарь)', 'label'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{roles.map(r => <tr key={r.code}><td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td><td style={S.td}>{r.label_ru ?? '—'}</td></tr>)}</tbody>
      </table>
      <div style={{ height: 10 }} />
      <table style={S.table}>
        <thead><tr>{['профиль', 'allow (write)'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{PROFILE_SCOPE.map(([p, a]) => <tr key={p}><td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{p}</td><td style={S.td}>{a}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function TagsTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [know, setKnow] = useState<TagRow[]>([]);
  const [lore, setLore] = useState<TagRow[]>([]);
  useEffect(() => {
    fetchLoreSlice<TagRow>('tags_usage', {}).then(setKnow).catch(onError);
    fetchLoreSlice<TagRow>('lore_tags_usage', {}).then(setLore).catch(() => { /* optional */ });
  }, [onError]);
  const list = (title: string, rows: TagRow[]) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{title}</div>
      <table style={S.table}>
        <thead><tr><th style={S.th}>тег</th><th style={S.th}>использований</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.tag_id}><td style={S.td}>{r.tag_id}</td><td style={S.td}>{r.uses}</td></tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <div>
      <div style={S.card}>{t('lore.admin.tagsNote', 'Read-only (D6): слияние/переименование — 2-я итерация (миграция рёбер TAGGED_WITH).')}</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {list('KnowTag (ADR/решения/задачи)', know)}
        {list('LoreTag (темы вопросов)', lore)}
      </div>
    </div>
  );
}

// AL-19: настройки app-level — редактируемые (dict_type=app_setting, механизм
// ADR-012, дефолт-предложение ОВ OQ-ADMIN-APPSETTING). Вкладка перестаёт быть
// витриной: code = ключ настройки, label_ru = значение, пишется тем же
// /lore/dict/entry, что и остальные словари (D4 — один контракт с MCP).
function SettingsTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const role = useRole();
  const [rows, setRows] = useState<DictRow[]>([]);
  const [edit, setEdit] = useState<{ code: string; value: string; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetchLoreSlice<DictRow>('dictionary', { dict_type: 'app_setting' })
      .then(setRows).catch(onError);
  }, [onError, reload]);

  async function save() {
    if (!edit?.code.trim()) return;
    setSaving(true);
    try {
      await loreMutate('/dict/entry', {
        dict_type: 'app_setting', code: edit.code.trim(), label_ru: edit.value,
        sort_order: null, is_active: true, is_extensible: true,
      });
      setEdit(null); setReload(x => x + 1);
    } catch (e) { onError(e); } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={S.card}>
        {t('lore.admin.setsNote', 'App-level настройки живут значениями словаря (dict_type=app_setting) — тот же путь записи, что у остальных словарей и MCP. Ниже — рабочая правка; серые карточки — состояние среды, оно задаётся не здесь.')}
      </div>
      <table style={S.table}>
        <thead><tr>{['ключ', 'значение', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.code}>
              <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td>
              <td style={S.td}>{r.label_ru ?? '—'}</td>
              <td style={S.td}><button style={S.btn} onClick={() => setEdit({ code: r.code, value: r.label_ru ?? '', isNew: false })}>✎</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td style={S.td} colSpan={3}>{t('lore.admin.noSets', 'Настроек пока нет — добавьте первую')}</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button style={S.btn} onClick={() => setEdit({ code: '', value: '', isNew: true })}>{t('lore.admin.addSet', '+ настройка')}</button>
      </div>
      {edit && (
        <div style={S.form}>
          <input style={S.input} placeholder="ключ, напр. default_palette" value={edit.code}
            disabled={!edit.isNew} onChange={e => setEdit(v => v && ({ ...v, code: e.target.value }))} />
          <input style={S.input} placeholder="значение, напр. amber" value={edit.value}
            onChange={e => setEdit(v => v && ({ ...v, value: e.target.value }))} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={S.primary} disabled={saving || !edit.code.trim()} onClick={save}>{saving ? '…' : t('lore.admin.save', 'Сохранить')}</button>
            <button style={S.btn} onClick={() => setEdit(null)}>{t('lore.admin.cancel', 'Отмена')}</button>
          </div>
        </div>
      )}

      <div style={{ height: 12 }} />
      <div style={{ ...S.card, opacity: 0.75 }}><b>{t('lore.admin.setAuth', 'Auth')}:</b> {AUTH_ENABLED ? 'включён (JWT, роль из seer_roles)' : 'выключен — dev-режим, роль из конфига (VITE_LORE_ROLE)'} · {t('lore.admin.roleNow', 'текущая роль')}: <b>{role}</b></div>
      <div style={{ ...S.card, opacity: 0.75 }}><b>LORE_ACTIVE_PROJECT:</b> {t('lore.admin.setProj', 'сессионный дефолт проекта MCP-процесса (env, ADR-LORE-017) — задаётся в .mcp.json/OpenCode-конфиге, из UI не читается')}</div>
      <div style={{ ...S.card, opacity: 0.75 }}><b>{t('lore.admin.setEnable', 'Включение auth')}:</b> {t('lore.admin.setEnableNote', 'AL-12 — только после проверки администрирования; все флаги вместе по RUNBOOK-AUTH-OMILORE')}</div>
    </div>
  );
}
