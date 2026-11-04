import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, loreMutate } from '../../../api/lore';
import { type KcState } from '../kc-state';
import { authHeaders } from '../../../auth/session';
import type { DictRow, KcUser, KcAgent, Preflight } from './types';
import { S } from './adminStyles';
import { KcStateView, NotEnforcedNotice, Toolbar } from './adminWidgets';

// ── Агенты ───────────────────────────────────────────────────────────────────
/**
 * AL-104: агент в графе — единица прав. Профиль берётся из поля `agent_role` (имя поля вершины прежнее, справочник — agent_profile с V48)
 * (миграция V21), а НЕ выводится из имени учётки: раньше роль и учётка были
 * неразличимы, и двух агентов одной роли завести было некуда
 * ([[D-AGENT-IDENTITY-PROFILE-VS-INSTANCE]]).
 */
interface AgentRow {
  actor_id: string;
  name: string | null;
  client_id: string | null;
  agent_role: string | null;
  owner_kc_sub: (string | null)[] | string | null;
  owner_display_name: (string | null)[] | string | null;
}

/** Траверс отдаёт скаляр или список — берём первое непустое. */
const firstOf = (v: unknown): string | null => {
  if (Array.isArray(v)) return (v.find(x => x) as string | undefined) ?? null;
  return (v as string | null) ?? null;
};

export function AgentsTab({ st, people, preflight, onError }: {
  st: KcState<KcAgent>; people: KcState<KcUser>;
  preflight: Preflight | null; onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [secret, setSecret] = useState<{ client: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [roles, setRoles] = useState<DictRow[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [projRoles, setProjRoles] = useState<Record<string, { projects: string[]; roles: string[] }>>({});
  const [reload, setReload] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', role: '', owner: '', client: '' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<AgentRow>('agent_owners', {}, ctrl.signal).then(setAgents).catch(() => setAgents([]));
    fetchLoreSlice<DictRow>('dictionary', { dict_type: 'agent_profile' }, ctrl.signal)
      .then(rs => setRoles(rs.filter(r => r.is_active !== false))).catch(() => setRoles([]));
    // Матрица D4 — с бэкенда, не константой на фронте: правило живёт в
    // ProjectRbacService, вторая копия разошлась бы с первой.
    fetch('/lore/rbac/agent-matrix', { signal: ctrl.signal, headers: { ...authHeaders() } })
      .then(r => r.ok ? r.json() : { matrix: {} })
      .then(b => setMatrix(b?.matrix ?? {})).catch(() => setMatrix({}));
    return () => ctrl.abort();
  }, [reload]);

  // Проектные роли владельцев — по одному запросу на владельца, только для тех,
  // кто реально владеет агентом.
  useEffect(() => {
    const subs = [...new Set(agents.map(a => firstOf(a.owner_kc_sub)).filter((s): s is string => !!s))];
    if (!subs.length) return;
    const ctrl = new AbortController();
    Promise.allSettled(subs.map(sub =>
      fetchLoreSlice<{ projects: (string | null)[] | null; roles: (string | null)[] | null }>(
        'user_project_roles', { kc_sub: sub }, ctrl.signal)
        .then(rs => [sub, rs[0]] as const)))
      .then(res => {
        const m: Record<string, { projects: string[]; roles: string[] }> = {};
        for (const r of res) {
          if (r.status !== 'fulfilled') continue;
          const [sub, row] = r.value;
          m[sub] = {
            projects: (row?.projects ?? []).filter((p): p is string => !!p),
            roles: (row?.roles ?? []).filter((x): x is string => !!x),
          };
        }
        setProjRoles(m);
      });
    return () => ctrl.abort();
  }, [agents]);

  /** Видит — все проекты владельца, роль НЕ сужает (D-AL-94-AGENT-SCOPE-ORDER). */
  const seesCount = (sub: string | null) => sub ? (projRoles[sub]?.projects.length ?? 0) : 0;
  /** Пишет — только там, где роль владельца делегирует роль агента (D4). */
  const writesIn = (sub: string | null, agentRole: string | null): string[] => {
    if (!sub || !agentRole) return [];
    const pr = projRoles[sub];
    if (!pr) return [];
    // Слайс отдаёт две параллельные колонки-массива — проект и роль сшиваются
    // по индексу, как их вернул траверс.
    return pr.projects.filter((_, i) => (matrix[pr.roles[i]] ?? []).includes(agentRole));
  };

  async function saveAgent() {
    if (!draft.name.trim() || !draft.role || !draft.owner || !draft.client) {
      setErr(t('lore.admin.agentFormIncomplete', 'Заполните имя, роль, владельца и учётку.')); return;
    }
    const busyClient = agents.find(a => a.client_id === draft.client);
    if (busyClient) {
      setErr(t('lore.admin.clientBusy', 'Учётка {{c}} уже занята агентом «{{n}}». Одна учётка — один агент: владелец ищется по client_id, и двух бэкенд не различит.', { c: draft.client, n: busyClient.name ?? busyClient.actor_id }));
      return;
    }
    setBusy(true); setErr(null);
    try {
      const actorId = 'AGENT-' + draft.client.replace(/^lore-mcp-?/, '').toUpperCase() + '-' + Date.now().toString(36);
      await loreMutate('/actor', { actor_id: actorId, name: draft.name.trim(), kind: 'agent' });
      await loreMutate('/actor/owner', {
        actor_id: actorId, client_id: draft.client, kc_sub: draft.owner, agent_role: draft.role,
      });
      setDraft({ name: '', role: '', owner: '', client: '' });
      setReload(r => r + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      onError(e);
    } finally { setBusy(false); }
  }

  async function rotate(a: KcAgent) {
    setBusy(true);
    try {
      const res = await loreMutate<{ value?: string }>(`/kc/agent/${a.id}/rotate`, {});
      setSecret({ client: a.clientId, value: res?.value ?? '(секрет не возвращён)' });
      setConfirm(null);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  // Текст правился вместе с разделением сущностей: раньше он утверждал, что
  // агенты «не заводятся руками», и это перестало быть правдой ровно на этом
  // экране. Учётка и агент — разные вещи с разным способом появления.
  const note = <div style={S.card}>{t('lore.admin.agentsNote', 'Агент — это пара «владелец × роль», и заводится он здесь. Учётные записи Keycloak под них провижинятся скриптом: ротация показывает секрет ОДИН раз, LORE его не хранит. Права агент берёт у владельца — своих не имеет.')}</div>;
  if (st.k !== 'ok') return <div>{note}<KcStateView s={st} empty={null} /></div>;

  const rows = st.rows;

  // Роль, которая есть в Keycloak, но отсутствует в справочнике agent_profile (до V48 — agent_role):
  // агента с ней здесь не завести — селект ролей берётся из справочника.
  // Показать обязательно: молча пропущенная роль выглядит как «такой роли
  // нет вовсе», хотя учётка под неё уже выпущена и клейм работает.
  const orphanScopes = Array.from(new Set(rows.flatMap(c => c.agent_scope ?? [])))
    .map(s => s.replace(/^agent-/, ''))
    .filter(code => !roles.some(r => r.code === code))
    .sort();
  const shown = rows.filter(a => !q || a.clientId.includes(q) || a.agent_scope.some(s => s.includes(q)));
  return (
    <div>
      {note}
      <NotEnforcedNotice pf={preflight} />
      {secret && (
        <div style={{ ...S.warn, color: 'var(--suc)', borderColor: 'color-mix(in srgb, var(--suc) 40%, transparent)', background: 'color-mix(in srgb, var(--suc) 8%, transparent)' }}>
          <div>{t('lore.admin.newSecret', 'Новый секрет {{c}} — скопируйте сейчас, больше не покажем:', { c: secret.client })}</div>
          <code style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-all' }}>{secret.value}</code>
          <div><button style={S.btn} onClick={() => setSecret(null)}>{t('lore.admin.hide', 'скрыть')}</button></div>
        </div>
      )}
      {/* ── Агенты: единицы прав (имя + роль + владелец) ──────────────── */}
      <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', margin: '14px 0 4px' }}>
        {t('lore.admin.agentsSection', 'Агенты')}
      </div>
      {agents.length === 0 && (
        <div style={S.warn}>
          {t('lore.admin.noAgents', 'Агентов нет ни одного. Роли и учётки заведены, но кто ими пользуется — не записано: права агента берутся у владельца, а владельца нет. При включённом проектном скоупе такой агент увидит пустой LORE.')}
        </div>
      )}
      {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>{err}</div>}
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['агент', 'профиль', 'владелец', 'учётка', 'видит', 'пишет', 'куда пишет'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {agents.map(a => {
              const sub = firstOf(a.owner_kc_sub);
              const w = writesIn(sub, a.agent_role);
              return (
                <tr key={a.actor_id}>
                  <td style={S.td}>{a.name ?? a.actor_id}</td>
                  <td style={S.td}>{a.agent_role
                    ? <span style={S.pill('var(--inf)')}>{a.agent_role}</span>
                    : <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noRole', '⚠ профиль не задан')}</span>}</td>
                  <td style={S.td}>{firstOf(a.owner_display_name)
                    ?? <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noOwner', '⚠ нет владельца')}</span>}</td>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{a.client_id ?? '—'}</td>
                  <td style={{ ...S.td, ...S.num }}>{seesCount(sub)}</td>
                  <td style={{ ...S.td, ...S.num, color: w.length ? 'var(--t2)' : 'var(--wrn)' }}>{w.length}</td>
                  <td style={{ ...S.td, fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{w.slice(0, 3).join(', ')}{w.length > 3 ? ' …' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center', marginTop: 8 }}>
        <input style={{ ...S.input, width: 170 }} placeholder={t('lore.admin.agentName', 'имя агента')}
               value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        <select style={S.select} value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}>
          <option value="">{t('lore.admin.pickRole', '— профиль —')}</option>
          {roles.map(r => <option key={r.code} value={r.code}>{r.code}</option>)}
        </select>
        <select style={S.select} value={draft.owner} onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}>
          <option value="">{t('lore.admin.pickOwner', '— владелец —')}</option>
          {(people.k === 'ok' ? people.rows : []).map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <select style={S.select} value={draft.client} onChange={e => setDraft(d => ({ ...d, client: e.target.value }))}>
          <option value="">{t('lore.admin.pickClient', '— учётка —')}</option>
          {(st.k === 'ok' ? st.rows : [])
            .filter(c => (c.agent_scope ?? []).length && !agents.some(a => a.client_id === c.clientId))
            .map(c => <option key={c.id} value={c.clientId}>{c.clientId}</option>)}
        </select>
        <button style={S.primary} disabled={busy} onClick={saveAgent}>{busy ? '…' : t('lore.admin.addAgent', '+ агент')}</button>
      </div>

      {/* ── Профили агентов: справочник agent_profile + кто вправе делегировать ─ */}
      <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', margin: '20px 0 4px' }}>
        {t('lore.admin.agentRolesSection', 'Профили агентов')}
      </div>
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['код', 'название', 'кто вправе делегировать (D4)', 'учётка в KC', 'агентов'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {roles.map(r => {
              const by = Object.entries(matrix).filter(([, list]) => list.includes(r.code)).map(([role]) => role);
              const hasClient = (st.k === 'ok' ? st.rows : []).some(c => (c.agent_scope ?? []).includes('agent-' + r.code));
              return (
                <tr key={r.code}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.code}</td>
                  <td style={S.td}>{r.label_ru ?? r.code}</td>
                  <td style={S.td}>{by.length
                    ? by.map(x => <span key={x} style={{ ...S.pill('var(--t3)'), marginRight: 4 }}>{x}</span>)
                    : <span style={{ color: 'var(--t3)' }}>—</span>}</td>
                  <td style={S.td}>{hasClient
                    ? '✓'
                    : <span style={{ color: 'var(--dng)' }}>{t('lore.admin.noClientForRole', 'нет учётки')}</span>}</td>
                  <td style={{ ...S.td, ...S.num }}>{agents.filter(a => a.agent_role === r.code).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {orphanScopes.length > 0 && (
        <div style={S.warn}>
          {t('lore.admin.scopeNotInDict',
             'В Keycloak выпущены учётки под профили, которых нет в справочнике agent_profile: {{list}}. Агента с таким профилем здесь не завести — список берётся из справочника. Добавить запись может только человек: справочники агентам не отдаются.',
             { list: orphanScopes.join(', ') })}
        </div>
      )}

      {/* ── Учётные записи KC ─────────────────────────────────────────── */}
      <div style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--t3)', margin: '20px 0 4px' }}>
        {t('lore.admin.kcClientsSection', 'Учётные записи Keycloak')}
      </div>
      <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} />
      <div style={S.tw}>
        <table style={S.table}>
          <thead><tr>{['клиент', 'agent_scope', 'вкл', 'агент', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
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
                  {(a.agent_scope ?? []).length === 0
                    ? <span style={{ color: 'var(--t3)' }}>{t('lore.admin.legacyNoBind', 'привязка запрещена')}</span>
                    : (() => {
                        const bound = agents.find(x => x.client_id === a.clientId);
                        return bound
                          ? <span style={{ color: 'var(--suc)' }}>{bound.name ?? bound.actor_id}</span>
                          : <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noAgentForClient', 'агента нет')}</span>;
                      })()}
                </td>
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
