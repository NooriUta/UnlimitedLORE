// Блоки доступа админки v2 (SPRINT_UXR_S7B_ADMIN/S7B-10, S7B-12, S7B-14).
// Собраны из готовых элементов kit (состояния, Pill, useUrlParam) — своего
// универсального здесь нет, только проводка к серверу и подписи.
//   • MyProjectsChip — «Все мои (N своих)» смотрящего (S7B-14);
//   • EffectiveAccess — «почему видит / не видит» человек проект (S7B-10);
//   • WhoSeesBlock — «кто видит проект» (S7B-10, обратный вопрос);
//   • PersonAgentsLine — «агенты видят ваши N проектов» (S7B-12);
//   • AgentProjectsPanel — проекты агента «наследует от владельца» (S7B-12).
// Каждый блок грузится, только когда смонтирован (строка раскрыта), и рисует
// ошибку / 403 явно: «не смогли проверить» ≠ «не видит» ≠ «ноль».
import { useEffect, useState } from 'react';
import { Forbidden, LoadError, Pill, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { useAppT } from '../i18n';
import { myProjects } from '../api/me.projects';
import {
  fetchAgentProjects, fetchExplain, fetchPersonAgents, fetchWhoSees,
  type AccessExplain, type AgentProjects, type PersonAgents, type WhoSees,
} from './access';

/** Параметры адреса: выбранный проект и роль realm для вопроса «почему». */
export const ACCESS_PROJECT_PARAM = 'adm-acc-p';
export const ACCESS_REALM_PARAM = 'adm-acc-r';

type LoadRes = ReturnType<typeof useLoadState>;

/** Общий разбор «не готово / нет прав / сбой» для маленьких блоков. */
function StateOf({ res, label }: { res: LoadRes; label: string }) {
  if (res.state === 'forbidden') return <Forbidden reason={res.error instanceof Error ? res.error.message : undefined} />;
  if (res.state === 'error') return <LoadError error={res.error} onRetry={res.reload} />;
  return <Skeleton lines={2} label={label} />;
}

// ── S7B-14 ───────────────────────────────────────────────────────────────

export function MyProjectsChip({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState(signal => myProjects(signal, fetchImpl), [fetchImpl], { rows: d => d });
  let text: string;
  let state: 'loading' | 'ok' | 'error';
  if (res.data !== undefined && res.state !== 'error' && res.state !== 'forbidden') {
    state = 'ok';
    text = t('admin.who.mine', { n: res.data.length });
  } else if (res.state === 'error' || res.state === 'forbidden') {
    state = 'error';
    text = t('admin.who.mineUnknown');
  } else {
    state = 'loading';
    text = t('admin.who.mineLoading');
  }
  return (
    <span className="adm-count" data-testid="adm-my-projects" data-state={state}
      title={state === 'error' && res.error instanceof Error ? res.error.message : undefined}>
      {state === 'error' ? <span className="adm-missing">{text}</span> : text}
    </span>
  );
}

// ── S7B-10 ───────────────────────────────────────────────────────────────

export function EffectiveAccess({ kcSub, projects, fetchImpl }: { kcSub: string; projects: string[]; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const [project, setProject] = useUrlParam(ACCESS_PROJECT_PARAM);
  const [realm, setRealm] = useUrlParam(ACCESS_REALM_PARAM);
  const [draft, setDraft] = useState(realm ?? '');
  useEffect(() => { setDraft(realm ?? ''); }, [realm]);
  const options = project && !projects.includes(project) ? [project, ...projects] : projects;
  return (
    <div className="adm-access" data-testid="adm-access">
      <h3 className="adm-access__h">{t('admin.access.title')}</h3>
      <form className="adm-filters" onSubmit={e => { e.preventDefault(); setRealm(draft.trim() || null); }}>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.access.project')}</span>
          <select className="adm-select" value={project ?? ''} onChange={e => setProject(e.target.value || null)}
            data-testid="adm-acc-project">
            <option value="">{t('admin.access.pickProject')}</option>
            {options.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.access.realm')}</span>
          <input className="adm-input" value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={t('admin.access.realmNone')} data-testid="adm-acc-realm" />
        </label>
        <div className="adm-field adm-field--btns">
          <button type="submit" className="adm-btn">{t('admin.access.check')}</button>
        </div>
        <p className="adm-hint">{t('admin.access.realmHint')}</p>
      </form>
      {project
        ? <ExplainResult kcSub={kcSub} project={project} realm={realm} fetchImpl={fetchImpl} />
        : <p className="adm-dim">{t('admin.access.pickHint')}</p>}
    </div>
  );
}

function ExplainResult({ kcSub, project, realm, fetchImpl }: { kcSub: string; project: string; realm: string | null; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState<AccessExplain>(
    signal => fetchExplain({ kc_sub: kcSub, project, realm_role: realm }, { signal, fetchImpl }),
    [kcSub, project, realm, fetchImpl],
  );
  const d = res.data;
  if (!d || res.state === 'error' || res.state === 'forbidden') return <StateOf res={res} label={t('admin.access.loading')} />;
  const verdict = d.sees
    ? t(d.can_write ? 'admin.access.seesWrite' : 'admin.access.seesRead', { project: d.project || project })
    : t('admin.access.notSees', { project: d.project || project });
  return (
    <>
      <p className="adm-verdict" data-testid="adm-acc-verdict" data-sees={String(d.sees)} data-write={String(d.can_write)}>
        {verdict}
        {d.project_role && <Pill>{d.project_role}</Pill>}
      </p>
      <ol className="adm-chain" data-testid="adm-acc-chain">
        {d.chain.map((c, i) => <li key={i}>{c}</li>)}
      </ol>
      {!d.scope_enforced && <p className="adm-note" data-tone="inf" role="status">{t('admin.access.scopeOff')}</p>}
      {d.agent_profiles.length > 0 && (
        <p className="adm-sub">{t('admin.access.agentProfiles')} {d.agent_profiles.map(p => <Pill key={p} variant="id">{p}</Pill>)}</p>
      )}
    </>
  );
}

export function WhoSeesBlock({ project, fetchImpl }: { project: string; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState<WhoSees>(signal => fetchWhoSees(project, { signal, fetchImpl }), [project, fetchImpl]);
  const d = res.data;
  let body;
  if (!d || res.state === 'error' || res.state === 'forbidden') body = <StateOf res={res} label={t('admin.access.loading')} />;
  else {
    body = (
      <>
        {d.people.length === 0
          ? <p className="adm-dim">{t('admin.access.nobody')}</p>
          : (
            <table className="adm-table">
              <tbody>
                {d.people.map(p => (
                  <tr key={p.kc_sub}>
                    <th scope="row">{p.name}</th>
                    <td><Pill>{p.role || '—'}</Pill></td>
                    <td>{p.can_write ? t('admin.access.writes') : t('admin.access.readOnly')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        <p className="adm-sub">
          {t('admin.access.bypass')} {d.bypass_realm_roles.map(r => <Pill key={r} variant="id">{r}</Pill>)}
        </p>
        {d.note && <p className="adm-note" data-tone={d.scope_enforced ? 'inf' : 'wrn'} role="status">{d.note}</p>}
      </>
    );
  }
  return (
    <div className="adm-access" data-testid="adm-who-sees">
      <h3 className="adm-access__h">{t('admin.access.whoSees', { project })}</h3>
      {body}
    </div>
  );
}

// ── S7B-12 ───────────────────────────────────────────────────────────────

export function PersonAgentsLine({ kcSub, isMe, fetchImpl }: { kcSub: string; isMe: boolean; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const res = useLoadState<PersonAgents>(signal => fetchPersonAgents(kcSub, { signal, fetchImpl }), [kcSub, fetchImpl]);
  const d = res.data;
  let text;
  if (res.state === 'forbidden') text = <span className="adm-missing">{t('admin.access.agentsSeeForbidden')}</span>;
  else if (res.state === 'error') text = <span className="adm-err">{t('admin.access.agentsSeeError', { reason: res.error instanceof Error ? res.error.message : String(res.error) })}</span>;
  else if (!d) text = <span className="adm-dim">{t('admin.access.loading')}</span>;
  else if (d.agents.length === 0) text = t('admin.access.noAgentsSee');
  else text = t(isMe ? 'admin.access.agentsSeeYour' : 'admin.access.agentsSeeHis', { a: d.agents.length, n: d.visible_projects });
  return <p className="adm-sub" data-testid="adm-agents-see">{text}</p>;
}

export function AgentProjectsPanel({ clientId, agentScope, ownerName, fetchImpl }: {
  clientId: string | null; agentScope: string | null; ownerName: string | null; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  return (
    <div className="adm-access" data-testid="adm-agent-projects">
      {clientId
        ? <AgentProjectsBody clientId={clientId} agentScope={agentScope} ownerName={ownerName} fetchImpl={fetchImpl} />
        : <p className="adm-note" data-tone="wrn" role="status">{t('admin.access.noClient')}</p>}
    </div>
  );
}

function AgentProjectsBody({ clientId, agentScope, ownerName, fetchImpl }: {
  clientId: string; agentScope: string | null; ownerName: string | null; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  const res = useLoadState<AgentProjects>(
    signal => fetchAgentProjects(clientId, agentScope, { signal, fetchImpl }), [clientId, agentScope, fetchImpl],
  );
  const d = res.data;
  if (!d || res.state === 'error' || res.state === 'forbidden') return <StateOf res={res} label={t('admin.access.loading')} />;
  if (!d.owner_kc_sub) {
    return <p className="adm-note" data-tone="wrn" role="status">{t('admin.access.noOwner', { reason: d.reason ?? '—' })}</p>;
  }
  const from = ownerName ?? d.inherited_from ?? d.owner_kc_sub;
  return (
    <>
      <h3 className="adm-access__h">{t('admin.access.agentProjects', { n: d.visible.length, owner: from })}</h3>
      {d.visible.length === 0
        ? <p className="adm-dim">{t('admin.access.ownerNoProjects')}</p>
        : (
          <ul className="adm-plist">
            {d.visible.map(p => (
              <li key={p} data-testid={`adm-agent-proj-${p}`}>
                <span className="adm-mono">{p}</span>{' '}
                <span className={d.writable.includes(p) ? 'adm-outcome' : 'adm-dim'} data-outcome={d.writable.includes(p) ? 'ok' : undefined}>
                  {d.writable.includes(p) ? t('admin.access.writes') : t('admin.access.reads')}
                </span>
              </li>
            ))}
          </ul>
        )}
      {!agentScope && <p className="adm-note" data-tone="wrn" role="status">{t('admin.access.noScope')}</p>}
    </>
  );
}
