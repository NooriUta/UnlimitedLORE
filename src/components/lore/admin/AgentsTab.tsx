import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, loreMutate, describeLoreError, LoreHttpError } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { type KcState } from '../kc-state';
import { authHeaders } from '../../../auth/session';
import { GameIcon } from '../GameIcon';
import type { DictRow, KcUser, KcAgent, Preflight, AgentRow } from './types';
import { S } from './adminStyles';
import { KcStateView, NotEnforcedNotice, RespTable, Sec, Toolbar, rowBtn } from './adminWidgets';
import { useIsNarrow } from './useIsNarrow';
import type { Col } from './adminCards';

// ── Агенты ───────────────────────────────────────────────────────────────────
// AL-104: агент графа (AgentRow) — тип в types.ts; слайс agent_owners грузит оболочка (SH-05).

/** Текст сбоя загрузки; отмена (abort) сбоем не считается. */
const failText = (e: unknown): string | null => {
  const d = describeLoreError(e);
  return d.kind === 'aborted' ? null : d.text;
};

/** Траверс отдаёт скаляр или список — берём первое непустое. */
const firstOf = (v: unknown): string | null => {
  if (Array.isArray(v)) return (v.find(x => x) as string | undefined) ?? null;
  return (v as string | null) ?? null;
};

export function AgentsTab({ st, people, preflight, graph, graphErr, onError, reload: reloadAll }: {
  st: KcState<KcAgent>; people: KcState<KcUser>;
  preflight: Preflight | null;
  /** Агенты графа (agent_owners) — от KC не зависят: видны и при 403/503 KC (A-02). */
  graph: AgentRow[]; graphErr: string | null;
  onError: (e: unknown) => void; reload: () => void;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const agents = graph;
  const agentsErr = graphErr;
  const [q, setQ] = useState('');
  const [secret, setSecret] = useState<{ client: string; value: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<DictRow[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [projRoles, setProjRoles] = useState<Record<string, { projects: string[]; roles: string[] }>>({});
  // AH-07 (A-05/A-06/A-07/A-11): сбой каждого источника раньше становился
  // пустым значением — «агентов нет», «видит 0», «пишет 0», пустые профили.
  // Это выглядело как реальный запрет или пустой граф, хотя данных просто не было.
  const [rolesErr, setRolesErr] = useState<string | null>(null);
  const [matrixErr, setMatrixErr] = useState<string | null>(null);
  const [projFailed, setProjFailed] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', role: '', owner: '', client: '' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<DictRow>('dictionary', { dict_type: 'agent_profile' }, ctrl.signal)
      .then(rs => { setRoles(rs.filter(r => r.is_active !== false)); setRolesErr(null); })
      .catch(e => { const m = failText(e); if (m) { setRoles([]); setRolesErr(m); } });
    // Матрица D4 — с бэкенда, не константой на фронте: правило живёт в
    // ProjectRbacService, вторая копия разошлась бы с первой.
    // Не-2xx раньше подменялся пустой матрицей — теперь это сбой.
    fetch('/lore/rbac/agent-matrix', { signal: ctrl.signal, headers: { ...authHeaders() } })
      .then(r => { if (!r.ok) throw new LoreHttpError(r.status, r.statusText || 'agent-matrix', ''); return r.json(); })
      .then(b => { setMatrix(b?.matrix ?? {}); setMatrixErr(null); })
      .catch(e => { const m = failText(e); if (m) { setMatrix({}); setMatrixErr(m); } });
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
        const failed = new Set<string>();
        res.forEach((r, i) => { if (r.status === 'rejected' && failText(r.reason)) failed.add(subs[i]); });
        setProjFailed(failed);
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
      setReload(r => r + 1); reloadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      onError(e);
    } finally { setBusy(false); }
  }

  async function rotate(a: KcAgent) {
    setBusy(true);
    try {
      const res = await loreMutate<{ value?: string }>(`/kc/agent/${a.id}/rotate`, {});
      setSecret({ client: a.clientId, value: res?.value ?? t('lore.admin.secretNotReturned', '(секрет не возвращён)') });
      setConfirm(null);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  // Текст правился вместе с разделением сущностей: раньше он утверждал, что
  // агенты «не заводятся руками», и это перестало быть правдой ровно на этом
  // экране. Учётка и агент — разные вещи с разным способом появления.
  const note = (
    <details style={S.note}>
      <summary style={{ cursor: 'pointer', color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}>{t('lore.admin.agentsNoteSummary', 'Как устроены агенты')}</summary>
      <div style={{ marginTop: 4 }}>{t('lore.admin.agentsNote', 'Агент — это пара «владелец × роль», и заводится он здесь. Учётные записи Keycloak под них провижинятся скриптом: ротация показывает секрет ОДИН раз, LORE его не хранит. Права агент берёт у владельца — своих не имеет.')}</div>
    </details>
  );

  // A-02: состояние KC — только в секции учёток. Граф агентов, профили и форма
  // от KC не зависят и рисуются всегда; там, где нужен KC, — «?» вместо выдумки.
  const kcOk = st.k === 'ok';
  const rows = kcOk ? st.rows : [];

  // Роль, которая есть в Keycloak, но отсутствует в справочнике agent_profile (до V48 — agent_role):
  // агента с ней здесь не завести — селект ролей берётся из справочника.
  // Показать обязательно: молча пропущенная роль выглядит как «такой роли
  // нет вовсе», хотя учётка под неё уже выпущена и клейм работает.
  // При сбое справочника сиротами стали бы ВСЕ скоупы (A-12) — тогда не считаем.
  const orphanScopes = kcOk && !rolesErr ? Array.from(new Set(rows.flatMap(c => c.agent_scope ?? [])))
    .map(s => s.replace(/^agent-/, ''))
    .filter(code => !roles.some(r => r.code === code))
    .sort() : [];
  // A-13: поиск по учёткам — без учёта регистра, как в остальных вкладках.
  const ql = q.toLowerCase();
  const shown = rows.filter(a => !ql || a.clientId.toLowerCase().includes(ql) || a.agent_scope.some(s => s.toLowerCase().includes(ql)));
  const unknownMark = (title: string) => <span style={{ color: 'var(--t3)' }} title={title}>?</span>;
  const failedT = t('lore.admin.unknownLoadFailed', 'не загрузилось');
  const kcNaT = t('lore.admin.kcNa', 'Keycloak не ответил');

  // ── Агенты графа (A-05…A-08) ──
  const agentCols: Col[] = [
    { key: 'name', label: t('lore.admin.thAgent', 'агент'), kind: 'title' },
    { key: 'role', label: t('lore.admin.thProfile', 'профиль') },
    { key: 'owner', label: t('lore.admin.thOwner', 'владелец') },
    { key: 'client', label: t('lore.admin.thClient', 'учётка') },
    { key: 'sees', label: t('lore.admin.thSees', 'видит'), num: true },
    { key: 'writes', label: t('lore.admin.thWrites', 'пишет'), num: true },
    { key: 'where', label: t('lore.admin.thWritesWhere', 'куда пишет') },
  ];
  const agentCell = (a: AgentRow, k: string) => {
    const sub = firstOf(a.owner_kc_sub);
    const ownerFailed = !!sub && projFailed.has(sub);
    const unknown = !!matrixErr || ownerFailed;
    const w = writesIn(sub, a.agent_role);
    switch (k) {
      case 'name': return a.name ?? a.actor_id;
      case 'role': return a.agent_role
        ? <span style={S.pill('var(--inf)')}>{a.agent_role}</span>
        : <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noRole', '⚠ профиль не задан')}</span>;
      case 'owner': return firstOf(a.owner_display_name)
        ?? <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noOwner', '⚠ нет владельца')}</span>;
      case 'client': return <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{a.client_id ?? '—'}</span>;
      case 'sees': return ownerFailed ? unknownMark(failedT) : seesCount(sub);
      case 'writes': return unknown ? unknownMark(failedT) : <span style={{ color: w.length ? 'var(--t2)' : 'var(--wrn)' }}>{w.length}</span>;
      case 'where': return unknown ? unknownMark(failedT)
        : <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{w.length ? <>{w.slice(0, 3).join(', ')}{w.length > 3 ? ' …' : ''}</> : '—'}</span>;
    }
    return null;
  };

  // ── Профили агентов (A-11) ──
  const profCols: Col[] = [
    { key: 'code', label: t('lore.admin.thCode', 'код'), kind: 'title' },
    { key: 'label', label: t('lore.admin.thName', 'название') },
    { key: 'by', label: t('lore.admin.thDelegators', 'кто вправе делегировать (D4)'), kind: 'full' },
    { key: 'kc', label: t('lore.admin.thKcClient', 'учётка в KC') },
    { key: 'n', label: t('lore.admin.thAgentsN', 'агентов'), num: true },
  ];
  const profCell = (r: DictRow, k: string) => {
    switch (k) {
      case 'code': return r.code;
      case 'label': return r.label_ru ?? r.code;
      case 'by': {
        if (matrixErr) return unknownMark(failedT);
        const by = Object.entries(matrix).filter(([, list]) => list.includes(r.code)).map(([role]) => role);
        return by.length
          ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>{by.map(x => <span key={x} style={S.pill('var(--t3)')}>{x}</span>)}</span>
          : <span style={{ color: 'var(--t3)' }}>—</span>;
      }
      case 'kc': {
        if (!kcOk) return unknownMark(kcNaT);
        return rows.some(c => (c.agent_scope ?? []).includes('agent-' + r.code))
          ? <GameIcon slug="tick" size={13} style={{ color: 'var(--suc)' }} />
          : <span style={{ color: 'var(--dng)' }}>{t('lore.admin.noClientForRole', 'нет учётки')}</span>;
      }
      case 'n': return agentsErr ? unknownMark(failedT) : agents.filter(a => a.agent_role === r.code).length;
    }
    return null;
  };

  // ── Учётки KC (A-14, A-15) ──
  const kcCols: Col[] = [
    { key: 'client', label: t('lore.admin.thKcClientId', 'клиент'), kind: 'title' },
    { key: 'scope', label: t('lore.admin.thAgentScope', 'agent_scope'), kind: 'full' },
    { key: 'on', label: t('lore.admin.thEnabled', 'вкл') },
    { key: 'agent', label: t('lore.admin.thAgent', 'агент') },
    { key: 'act', label: '', kind: 'act' },
  ];
  const kcCell = (a: KcAgent, k: string) => {
    switch (k) {
      case 'client': return a.clientId;
      case 'scope': return (a.agent_scope ?? []).length
        ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>{a.agent_scope.map(s => <span key={s} style={S.pill('var(--inf)')}>{s}</span>)}</span>
        : <span style={{ color: 'var(--t3)' }}>{t('lore.admin.noScope', '— (оси не несёт, легаси)')}</span>;
      case 'on': return a.enabled
        ? <GameIcon slug="tick" size={13} style={{ color: 'var(--suc)' }} />
        : <GameIcon slug="cross-mark" size={12} style={{ color: 'var(--t3)' }} />;
      case 'agent': {
        if ((a.agent_scope ?? []).length === 0) return <span style={{ color: 'var(--t3)' }}>{t('lore.admin.legacyNoBind', 'привязка запрещена')}</span>;
        if (agentsErr) return unknownMark(failedT);
        const bound = agents.find(x => x.client_id === a.clientId);
        return bound
          ? <span style={{ color: 'var(--suc)' }}>{bound.name ?? bound.actor_id}</span>
          : <span style={{ color: 'var(--wrn)' }}>{t('lore.admin.noAgentForClient', 'агента нет')}</span>;
      }
      case 'act': return confirm === a.id
        ? <button style={rowBtn(narrow, S.primary)} disabled={busy} onClick={() => rotate(a)}>{t('lore.admin.confirmRotate', 'точно ротировать?')}</button>
        : <button style={rowBtn(narrow)} onClick={() => setConfirm(a.id)}><GameIcon slug="cycle" size={12} style={{ color: 'inherit' }} />{t('lore.admin.rotate', 'ротировать секрет')}</button>;
    }
    return null;
  };

  // A-09: поля формы с подписями; на телефоне — столбиком во всю ширину, 40px.
  const fld = { ...S.input, minHeight: S.tap(narrow).minHeight, width: narrow ? '100%' : undefined };
  const lbl = { display: 'flex', flexDirection: 'column' as const, gap: 3, fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', flex: narrow ? '1 1 100%' : undefined };
  const ownerOptions = people.k === 'ok' ? people.rows : [];
  const clientOptions = rows.filter(c => (c.agent_scope ?? []).length && !agents.some(a => a.client_id === c.clientId));

  return (
    <div>
      {note}
      <NotEnforcedNotice pf={preflight} />
      {secret && (
        <div style={{ ...S.warn, color: 'var(--suc)', borderColor: 'color-mix(in srgb, var(--suc) 40%, transparent)', background: 'color-mix(in srgb, var(--suc) 8%, transparent)' }}>
          <div>{t('lore.admin.newSecret', 'Новый секрет {{c}} — скопируйте сейчас, больше не покажем:', { c: secret.client })}</div>
          <code style={{ fontSize: 'var(--fs-sm)', wordBreak: 'break-all' }}>{secret.value}</code>
          <div><button style={rowBtn(narrow)} onClick={() => setSecret(null)}>{t('lore.admin.hide', 'скрыть')}</button></div>
        </div>
      )}

      {/* ── Агенты: единицы прав (имя + роль + владелец) ──────────────── */}
      <Sec first n={agentsErr ? '?' : agents.length} hint={t('lore.admin.agentsGraphHint', 'от Keycloak не зависят — видны и при сбое KC')}>
        {t('lore.admin.agentsGraphSection', 'Агенты графа')}
      </Sec>
      {agentsErr && <LoadError text={t('lore.admin.agentsLoadError', 'Агенты графа не загрузились: {{reason}}', { reason: agentsErr })} onRetry={reloadAll} retryLabel={t('lore.admin.retry', 'повторить')} />}
      {matrixErr && !agentsErr && (
        <div style={S.warn}>{t('lore.admin.matrixLoadError', 'Матрица делегирования не загрузилась — «пишет» неизвестно (?), а не 0: {{reason}}', { reason: matrixErr })}</div>
      )}
      {!agentsErr && agents.length === 0 && (
        <div style={S.warn}>
          {t('lore.admin.noGraphAgents', 'Агентов нет ни одного. Роли и учётки заведены, но кто ими пользуется — не записано: права агента берутся у владельца, а владельца нет. При включённом проектном скоупе такой агент увидит пустой LORE.')}
        </div>
      )}
      {err && <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>{err}</div>}
      {agents.length > 0 && (
        <RespTable cols={agentCols} rows={agents} rowKey={a => a.actor_id} cell={agentCell} narrow={narrow} ariaLabel={t('lore.admin.agentsGraphSection', 'Агенты графа')} />
      )}
      <div style={{ ...S.form, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lbl}>{t('lore.admin.agentName', 'имя агента')}
          <input style={{ ...fld, width: narrow ? '100%' : 170 }} placeholder={t('lore.admin.agentName', 'имя агента')}
                 value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        </label>
        <label style={lbl}>{t('lore.admin.thProfile', 'профиль')}
          <select style={{ ...fld, fontFamily: 'var(--mono)' }} value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}>
            <option value="">{t('lore.admin.pickRole', '— профиль —')}</option>
            {roles.map(r => <option key={r.code} value={r.code}>{r.code}</option>)}
          </select>
        </label>
        <label style={lbl}>{t('lore.admin.thOwner', 'владелец')}
          <select style={{ ...fld, fontFamily: 'var(--mono)' }} value={draft.owner} disabled={people.k !== 'ok'} onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}>
            <option value="">{people.k === 'ok' ? t('lore.admin.pickOwner', '— владелец —') : t('lore.admin.pickKcNa', '— Keycloak не ответил —')}</option>
            {ownerOptions.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </label>
        <label style={lbl}>{t('lore.admin.thClient', 'учётка')}
          <select style={{ ...fld, fontFamily: 'var(--mono)' }} value={draft.client} disabled={!kcOk} onChange={e => setDraft(d => ({ ...d, client: e.target.value }))}>
            <option value="">{kcOk ? t('lore.admin.pickClient', '— учётка —') : t('lore.admin.pickKcNa', '— Keycloak не ответил —')}</option>
            {clientOptions.map(c => <option key={c.id} value={c.clientId}>{c.clientId}</option>)}
          </select>
        </label>
        <button style={{ ...rowBtn(narrow, S.primary), flex: narrow ? '1 1 100%' : undefined }} disabled={busy} onClick={saveAgent}>{busy ? '…' : t('lore.admin.addAgent', '+ агент')}</button>
      </div>

      {/* ── Профили агентов: справочник agent_profile + кто вправе делегировать ─ */}
      <Sec n={rolesErr ? '?' : roles.length}>{t('lore.admin.agentRolesSection', 'Профили агентов')}</Sec>
      {rolesErr && <LoadError text={t('lore.admin.profilesLoadError', 'Справочник профилей агентов не загрузился — выбрать профиль сейчас не из чего: {{reason}}', { reason: rolesErr })} />}
      {roles.length > 0 && <RespTable cols={profCols} rows={roles} rowKey={r => r.code} cell={profCell} narrow={narrow} ariaLabel={t('lore.admin.agentRolesSection', 'Профили агентов')} />}
      {orphanScopes.length > 0 && (
        <div style={S.warn}>
          {t('lore.admin.scopeNotInDict',
             'В Keycloak выпущены учётки под профили, которых нет в справочнике agent_profile: {{list}}. Агента с таким профилем здесь не завести — список берётся из справочника. Добавить запись может только человек: справочники агентам не отдаются.',
             { list: orphanScopes.join(', ') })}
        </div>
      )}

      {/* ── Учётные записи KC: единственное место, где видно состояние KC ── */}
      <Sec n={kcOk ? rows.length : '?'}>{t('lore.admin.kcClientsSection', 'Учётные записи Keycloak')}</Sec>
      {kcOk ? (
        <>
          <Toolbar q={q} setQ={setQ} shown={shown.length} total={rows.length} placeholder={t('lore.admin.kcClientSearch', 'клиент или agent_scope…')} />
          <RespTable cols={kcCols} rows={shown} rowKey={a => a.id} cell={kcCell} narrow={narrow} ariaLabel={t('lore.admin.kcClientsSection', 'Учётные записи Keycloak')} />
        </>
      ) : <KcStateView s={st} empty={null} />}
    </div>
  );
}
