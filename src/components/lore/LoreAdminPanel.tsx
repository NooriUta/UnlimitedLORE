import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
type Tab = 'dicts' | 'projects' | 'roles' | 'tags' | 'settings';

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
};

export default function LoreAdminPanel({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const role = useRole();
  const [tab, setTab] = useState<Tab>('dicts');
  return (
    <div style={S.root}>
      <div style={S.tabs}>
        {([['dicts', 'Словари'], ['projects', 'Проекты'], ['roles', 'Роли'], ['tags', 'Теги'], ['settings', 'Настройки']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} style={S.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
          {t('lore.admin.roleBadge', 'роль: {{role}} · auth: {{auth}}', { role, auth: AUTH_ENABLED ? 'on' : 'off (dev)' })}
        </span>
      </div>
      {tab === 'dicts' && <DictsTab onError={onError} />}
      {tab === 'projects' && <ProjectsTab onError={onError} />}
      {tab === 'roles' && <RolesTab onError={onError} />}
      {tab === 'tags' && <TagsTab onError={onError} />}
      {tab === 'settings' && <SettingsTab />}
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

function RolesTab({ onError }: { onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<DictRow[]>([]);
  useEffect(() => { fetchLoreSlice<DictRow>('dictionary', { dict_type: 'agent_role' }).then(setRoles).catch(onError); }, [onError]);
  return (
    <div>
      <div style={S.card}>{t('lore.admin.rolesNote', 'Read-only (ADR-LORE-025 D6): RBAC-скоуп правится в mcp-server/agent-profiles/*.json, роли-значения — в словаре agent_role.')}</div>
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

function SettingsTab() {
  const { t } = useTranslation();
  const role = useRole();
  return (
    <div>
      <div style={S.card}><b>{t('lore.admin.setAuth', 'Auth')}:</b> {AUTH_ENABLED ? 'включён (JWT, роль из seer_roles)' : 'выключен — dev-режим, роль из конфига (VITE_LORE_ROLE, по умолчанию admin)'} · {t('lore.admin.roleNow', 'текущая роль')}: <b>{role}</b></div>
      <div style={S.card}><b>{t('lore.admin.setTheme', 'Тема/палитра')}:</b> {t('lore.admin.setThemeNote', 'переключается в шапке приложения (◐/☀); app-level хранение настроек — по ОВ №3 ADR-LORE-025 (предложение: KnowDictEntry dict_type=app_setting)')}</div>
      <div style={S.card}><b>LORE_ACTIVE_PROJECT:</b> {t('lore.admin.setProj', 'сессионный дефолт проекта MCP-процесса (env, ADR-LORE-017) — задаётся в .mcp.json/OpenCode-конфиге, из UI не читается')}</div>
      <div style={S.card}><b>{t('lore.admin.setEnable', 'Включение auth')}:</b> {t('lore.admin.setEnableNote', 'AL-12 — только после проверки администрирования (порядок пользователя); все флаги вместе по RUNBOOK-AUTH-OMILORE')}</div>
    </div>
  );
}
