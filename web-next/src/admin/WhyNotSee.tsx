// «Почему не видит / 403» для АГЕНТА и ИНСТРУМЕНТА MCP (SPRINT_UXR_S7B_ADMIN/S7B-21, UC-3).
//
// Блок отдельным файлом: экран «Кто где» подключает его одной строкой. Вопрос
// задаётся в адресе (?adm-why=agent|tool, adm-why-a=actor_id, adm-why-p=проект,
// adm-why-t=инструмент) — ссылка открывает тот же вопрос, Главная ведёт сюда из
// детектора 403.
//
// Цепочку рисует kit ChainExplain (решающий шаг назван, оборванная цепочка
// сказана словами). Модель — whyAccess.agentChain, исходы шагов — ответы
// сервера. «Исправить» — прямо из цепочки:
//   • нет владельца у агента → привязка POST /lore/actor/owner, с диффом и
//     подтверждением словом (kit DiffPreview); отката у сервера нет — сказано;
//   • у владельца нет нужной роли в проекте → DangerBatch на владельца
//     (POST /lore/user/role/batch: dry_run → дифф → применить → отмена);
//   • профиль агента не пишет в инструмент (решение сервера AgentScopeFilter
//     через /lore/admin/access/tool) → мастер «агент человеку» с владельцем и
//     открытым профилем: профиль — роль клиента KC, меняется выпуском учётки,
//     а мастер сам показывает план и требует подтверждения;
//   • человеческое семейство — агентом не исправить, сказано словами.
import { useState } from 'react';
import {
  ChainExplain, DiffPreview, Forbidden, LoadError, Skeleton, useKitLang, useLoadState, useUrlParam, type DiffRow,
} from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { useAdminNav } from './adminNav';
import { LoreHttpError } from '../api/loreSlice';
import { fetchAgents, type AgentRow, type AgentsData } from './agents';
import { fetchAgentProjects, fetchExplain } from './access';
import { DangerBatch } from './DangerBatch';
import { fetchRoleMatrix, PROJECT_ROLES, type RolesData } from './roles';
import {
  agentChain, bindAgentOwner, fetch403Rows, fetchToolExplain, toolQuery,
  type Got, type OwnerBindAnswer, type ToolExplain, type WhyFix, type WhyResult,
} from './whyAccess';

export const WHY_MODE = 'adm-why';
export const WHY_AGENT = 'adm-why-a';
export const WHY_PROJECT = 'adm-why-p';
export const WHY_TOOL = 'adm-why-t';

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

async function got<T>(p: Promise<T>): Promise<Got<T>> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    return { ok: false, forbidden: e instanceof LoreHttpError && (e.status === 401 || e.status === 403), reason: reasonOf(e) };
  }
}

function useTr() {
  const t = useAppT();
  return (k: string, v?: Record<string, string | number>) => t(k as AppKey, v);
}

export function WhyNotSee({ projects, fetchImpl }: { projects: readonly string[]; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lang = useKitLang();
  const [modeRaw, setMode] = useUrlParam(WHY_MODE);
  const mode = modeRaw === 'tool' ? 'tool' : 'agent';
  const [agentId, setAgentId] = useUrlParam(WHY_AGENT);
  const [project, setProject] = useUrlParam(WHY_PROJECT);
  const [tool, setTool] = useUrlParam(WHY_TOOL);
  const agents = useLoadState<AgentsData>(s => fetchAgents(s, fetchImpl, lang), [fetchImpl, lang], { rows: d => d.rows });
  const rows = agents.data?.rows ?? [];
  const agent = rows.find(a => a.actor_id === agentId) ?? null;

  let agentField;
  if (agents.state === 'forbidden') agentField = <Forbidden reason={reasonOf(agents.error)} />;
  else if (agents.state === 'error') agentField = <LoadError error={agents.error} onRetry={agents.reload} />;
  else {
    agentField = (
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.why.agent')}</span>
        <select className="adm-select" value={agentId ?? ''} data-testid="adm-why-agent"
          onChange={e => setAgentId(e.target.value || null)}>
          <option value="">{t('admin.why.pickAgent')}</option>
          {rows.map(a => (
            <option key={a.actor_id} value={a.actor_id}>
              {`${a.name ?? a.actor_id} · ${a.client_id ?? t('admin.why.noClientShort')} · ${a.agent_role ?? '—'}`}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const ready = !!agent && !!project && (mode === 'agent' || !!(tool ?? '').trim());
  return (
    <section className="adm-access" data-testid="adm-why" aria-labelledby="adm-why-h">
      <h3 id="adm-why-h" className="adm-access__h">{t('admin.why.title')}</h3>
      <p className="adm-hint">{t('admin.why.lead')}</p>
      <div className="adm-chips" role="radiogroup" aria-label={t('admin.why.mode')}>
        <button type="button" role="radio" className="adm-chip" aria-checked={mode === 'agent'} aria-pressed={mode === 'agent'}
          data-testid="adm-why-mode-agent" onClick={() => setMode('agent')}>{t('admin.why.modeAgent')}</button>
        <button type="button" role="radio" className="adm-chip" aria-checked={mode === 'tool'} aria-pressed={mode === 'tool'}
          data-testid="adm-why-mode-tool" onClick={() => setMode('tool')}>{t('admin.why.modeTool')}</button>
      </div>
      <div className="adm-filters">
        {agents.data === undefined && agents.state === 'loading' ? <Skeleton lines={1} label={t('admin.access.loading')} /> : agentField}
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.access.project')}</span>
          <input className="adm-input" list="adm-why-projects" value={project ?? ''} data-testid="adm-why-project"
            placeholder={t('admin.access.pickProject')} spellCheck={false}
            onChange={e => setProject(e.target.value.trim() || null, { replace: true })} />
          <datalist id="adm-why-projects">{projects.map(p => <option key={p} value={p} />)}</datalist>
        </label>
        {mode === 'tool' && (
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.why.tool')}</span>
            <input className="adm-input" value={tool ?? ''} data-testid="adm-why-tool" spellCheck={false}
              placeholder={t('admin.why.toolHint')}
              onChange={e => setTool(e.target.value.trim() || null, { replace: true })} />
          </label>
        )}
      </div>
      {ready
        ? <WhyAnswer agent={agent!} project={project!} tool={mode === 'tool' ? (tool ?? '').trim() : null} fetchImpl={fetchImpl} />
        : <p className="adm-dim">{t(mode === 'tool' ? 'admin.why.pickTool' : 'admin.why.pick')}</p>}
      {mode === 'tool' && <Recent403 fetchImpl={fetchImpl} onPick={fam => setTool(fam)} />}
    </section>
  );
}

function WhyAnswer({ agent, project, tool, fetchImpl }: {
  agent: AgentRow; project: string; tool: string | null; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  const tr = useTr();
  const lang = useKitLang();
  const [fixOpen, setFixOpen] = useState(false);
  const res = useLoadState<WhyResult>(async signal => {
    const access = agent.client_id
      ? await got(fetchAgentProjects(agent.client_id, agent.agent_role, { signal, fetchImpl }))
      : { ok: false as const, forbidden: false, reason: '' };
    const ownerSub = access.ok ? access.data.owner_kc_sub : null;
    const owner = ownerSub ? await got(fetchExplain({ kc_sub: ownerSub, project }, { signal, fetchImpl })) : null;
    const toolExplain = !tool ? null
      : agent.agent_role
        ? await got(fetchToolExplain({ agent_scope: agent.agent_role, ...toolQuery(tool) }, { signal, fetchImpl }))
        : { ok: false as const, forbidden: false, reason: tr('admin.why.noProfile') };
    return agentChain({ agent, project, tool, access, owner, toolExplain }, tr);
  }, [agent.actor_id, agent.client_id, agent.agent_role, project, tool, fetchImpl, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = res.data;
  if (!r) {
    if (res.state === 'error') return <LoadError error={res.error} onRetry={res.reload} />;
    return <Skeleton lines={3} label={t('admin.access.loading')} />;
  }
  const tone = r.verdict === 'writes' ? 'suc' : r.verdict === 'reads' ? 'inf' : r.verdict === 'none' ? 'dng' : 'wrn';
  return (
    <div data-testid="adm-why-answer" data-verdict={r.verdict}>
      <ChainExplain verdict={tr(`admin.why.verdict.${r.verdict}`, { agent: agent.name ?? agent.actor_id, project })}
        tone={tone} steps={r.steps} decidedBy={r.decidedBy} stopped={r.stopped} lang={lang} label={t('admin.why.chain')} />
      {r.scopeOff && <p className="adm-note" data-tone="inf" role="status">{t('admin.access.scopeOff')}</p>}
      {r.fix && !fixOpen && (
        <button type="button" className="adm-btn" data-testid="adm-why-fix" onClick={() => setFixOpen(true)}>
          {t(r.fix.kind === 'owner' ? 'admin.why.fixOwner' : r.fix.kind === 'profile' ? 'admin.why.fixProfile'
            : r.fix.kind === 'human' ? 'admin.why.fixHuman' : 'admin.why.fixRole')}
        </button>
      )}
      {r.fix && fixOpen && (
        <FixPanel fix={r.fix} fetchImpl={fetchImpl} onClose={() => setFixOpen(false)} onChanged={res.reload} />
      )}
    </div>
  );
}

function FixPanel({ fix, fetchImpl, onClose, onChanged }: {
  fix: WhyFix; fetchImpl?: typeof fetch; onClose: () => void; onChanged: () => void;
}) {
  if (fix.kind === 'profile') return <ProfileFix fix={fix} onClose={onClose} />;
  if (fix.kind === 'human') return <HumanFix fix={fix} onClose={onClose} />;
  return <PeopleFix fix={fix} fetchImpl={fetchImpl} onClose={onClose} onChanged={onChanged} />;
}

/** Сменить профиль: мастер «агент человеку» — тот же путь записи, что в «Мастерах» (план → подтверждение). */
function ProfileFix({ fix, onClose }: { fix: Extract<WhyFix, { kind: 'profile' }>; onClose: () => void }) {
  const t = useAppT();
  const nav = useAdminNav();
  return (
    <div className="adm-access" data-testid="adm-why-profilefix">
      <p className="adm-sub">{t('admin.why.profileNeed', { tool: fix.tool, current: fix.current ?? '—', profiles: fix.profiles.join(', ') })}</p>
      <p className="adm-hint">{t('admin.why.profileHint')}</p>
      <div className="adm-chips">
        {fix.profiles.map(p => (
          <button key={p} type="button" className="adm-btn" data-testid={`adm-why-profile-${p}`}
            onClick={() => nav.go('wiz', { 'adm-wiz': 'agent', 'adm-owner': fix.owner_kc_sub, 'adm-profile': p })}>
            {t('admin.why.profileGo', { profile: p })}
          </button>
        ))}
        <button type="button" className="adm-btn" onClick={onClose}>{t('admin.roles.danger.cancel')}</button>
      </div>
    </div>
  );
}

function HumanFix({ fix, onClose }: { fix: Extract<WhyFix, { kind: 'human' }>; onClose: () => void }) {
  const t = useAppT();
  return (
    <div className="adm-access" data-testid="adm-why-humanfix">
      <p className="adm-note" data-tone="wrn" role="status">{t('admin.why.humanOnly', { tool: fix.tool })}</p>
      <button type="button" className="adm-btn" onClick={onClose}>{t('admin.roles.danger.done')}</button>
    </div>
  );
}

function PeopleFix({ fix, fetchImpl, onClose, onChanged }: {
  fix: Extract<WhyFix, { kind: 'owner' | 'role' }>; fetchImpl?: typeof fetch; onClose: () => void; onChanged: () => void;
}) {
  const t = useAppT();
  const people = useLoadState<RolesData>(s => fetchRoleMatrix(s, fetchImpl), [fetchImpl], { rows: d => d.people });
  if (!people.data) {
    if (people.state === 'forbidden') return <Forbidden reason={reasonOf(people.error)} />;
    if (people.state === 'error') return <LoadError error={people.error} onRetry={people.reload} />;
    return <Skeleton lines={2} label={t('admin.access.loading')} />;
  }
  return fix.kind === 'owner'
    ? <OwnerFix fix={fix} people={people.data} fetchImpl={fetchImpl} onClose={onClose} onChanged={onChanged} />
    : <RoleFix fix={fix} people={people.data} fetchImpl={fetchImpl} onClose={onClose} onChanged={onChanged} />;
}

function RoleFix({ fix, people, fetchImpl, onClose, onChanged }: {
  fix: Extract<WhyFix, { kind: 'role' }>; people: RolesData; fetchImpl?: typeof fetch; onClose: () => void; onChanged: () => void;
}) {
  const t = useAppT();
  const [role, setRole] = useState('');
  const [go, setGo] = useState(false);
  const name = people.people.find(p => p.kc_sub === fix.owner_kc_sub)?.name ?? fix.owner_kc_sub;
  if (go && role) {
    return (
      <DangerBatch person={{ kc_sub: fix.owner_kc_sub, name }} changes={[{ project: fix.project, role }]}
        fetchImpl={fetchImpl} onClose={onClose} onChanged={onChanged} />
    );
  }
  return (
    <div className="adm-access" data-testid="adm-why-rolefix">
      <p className="adm-sub">
        {t(fix.need === 'see' ? 'admin.why.roleNeedSee' : 'admin.why.roleNeedDelegate',
          { owner: name, project: fix.project, role: fix.current ?? '—' })}
      </p>
      <p className="adm-hint">{t('admin.why.roleNoServerHint')}</p>
      <div className="adm-filters">
        <label className="adm-field">
          <span className="adm-field__l">{t('admin.why.role')}</span>
          <select className="adm-select" value={role} data-testid="adm-why-role-pick" onChange={e => setRole(e.target.value)}>
            <option value="">{t('admin.why.pickRole')}</option>
            {PROJECT_ROLES.filter(r => r !== fix.current).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="adm-field adm-field--btns">
          <button type="button" className="adm-btn" data-testid="adm-why-role-go" disabled={!role} onClick={() => setGo(true)}>
            {t('admin.why.roleGo')}
          </button>
          <button type="button" className="adm-btn" onClick={onClose}>{t('admin.roles.danger.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function OwnerFix({ fix, people, fetchImpl, onClose, onChanged }: {
  fix: Extract<WhyFix, { kind: 'owner' }>; people: RolesData; fetchImpl?: typeof fetch; onClose: () => void; onChanged: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [sub, setSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<OwnerBindAnswer | null>(null);
  const person = people.people.find(p => p.kc_sub === sub) ?? null;
  const rows: DiffRow[] = person
    ? [{ id: 'owner', kind: 'add', text: t('admin.why.ownerDiff', { agent: fix.agent, owner: person.name }), detail: t('admin.why.ownerDiffWas'), check: { state: 'checked' } }]
    : [];
  const apply = () => {
    if (!person || busy) return;
    setBusy(true);
    setError(null);
    bindAgentOwner({ actor_id: fix.actor_id, client_id: fix.client_id, kc_sub: person.kc_sub }, fetchImpl).then(
      a => { setAnswer(a); setBusy(false); if (a.linked) onChanged(); },
      (e: unknown) => { setError(reasonOf(e)); setBusy(false); },
    );
  };
  return (
    <section className="adm-danger" data-testid="adm-why-ownerfix" aria-labelledby="adm-why-own-h">
      <h3 id="adm-why-own-h" className="adm-danger__h">{t('admin.why.ownerTitle', { agent: fix.agent })}</h3>
      {!answer && (
        <>
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.why.owner')}</span>
            <select className="adm-select" value={sub} data-testid="adm-why-owner-pick" onChange={e => setSub(e.target.value)}>
              <option value="">{t('admin.why.pickOwner')}</option>
              {people.people.map(p => <option key={p.kc_sub} value={p.kc_sub}>{p.name}</option>)}
            </select>
          </label>
          {person && (
            <DiffPreview key={sub} rows={rows} onApply={apply} busy={busy} label={t('admin.roles.danger.diff')} lang={lang}
              confirm={{ word: fix.agent, label: t('admin.why.ownerConfirm', { agent: fix.agent }) }} />
          )}
          {error && <p className="adm-note" data-tone="dng" role="alert">{t('admin.roles.danger.applyError', { reason: error })}</p>}
        </>
      )}
      {answer && (
        answer.linked
          ? <p className="adm-note" data-tone="suc" role="status">{t('admin.why.ownerDone', { agent: fix.agent, owner: person?.name ?? sub })}</p>
          : <p className="adm-note" data-tone="dng" role="alert">{t('admin.why.ownerNotLinked', { hint: answer.hint ?? '—' })}</p>
      )}
      {answer && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-why-owner-noundo">{t('admin.why.ownerNoUndo')}</p>
      )}
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" onClick={onClose}>
          {answer ? t('admin.roles.danger.done') : t('admin.roles.danger.cancel')}
        </button>
      </div>
    </section>
  );
}

function Recent403({ fetchImpl, onPick }: { fetchImpl?: typeof fetch; onPick: (tool: string) => void }) {
  const t = useAppT();
  const [open, setOpen] = useState<number | null>(null);
  const res = useLoadState(s => fetch403Rows(Date.now(), s, fetchImpl), [fetchImpl], { rows: d => d });
  let body;
  if (res.state === 'forbidden') body = <Forbidden reason={reasonOf(res.error)} />;
  else if (res.state === 'error') body = <LoadError error={res.error} onRetry={res.reload} />;
  else if (!res.data) body = <Skeleton lines={2} label={t('admin.access.loading')} />;
  else if (res.data.length === 0) body = <p className="adm-dim">{t('admin.why.no403')}</p>;
  else {
    body = (
      <ul className="adm-plist" data-testid="adm-why-403">
        {res.data.map((r, i) => (
          <li key={i}>
            <button type="button" className="adm-link" data-testid={`adm-why-403-row-${i}`} disabled={!r.family}
              onClick={() => { const p = pathOf(r.entity_id); if (p) onPick(p); else if (r.family) onPick(r.family); }}>
              <span className="adm-mono">{r.caller ?? '—'}</span>{' → '}
              <span className="adm-mono">{r.family ?? '—'}</span>{' '}
              <span className="adm-dim">{r.entity_id ?? ''}</span>{' '}
              <span className="adm-dim">{r.ts ? new Date(r.ts).toISOString().slice(0, 16).replace('T', ' ') : ''}</span>
            </button>{' '}
            <button type="button" className="adm-btn" data-testid={`adm-why-403-explain-${i}`} disabled={!r.caller || !r.family}
              aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{t('admin.why.explain')}</button>
            {open === i && r.caller && <RowExplain i={i} profile={r.caller} family={r.family} entity={r.entity_id} fetchImpl={fetchImpl} />}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="adm-access">
      <h3 className="adm-access__h">{t('admin.why.recent403')}</h3>
      <p className="adm-hint">{t('admin.why.recent403Hint')}</p>
      {body}
    </div>
  );
}

const pathOf = (entity: string | null): string | null => (entity && /^\/?lore\//.test(entity) ? entity : null);

/**
 * Разбор одной строки отказа: в журнале агент записан профилем (caller =
 * agent_scope), путь — entity_id (у отказа фильтра сущности нет). Ответ —
 * решение сервера (AgentScopeFilter.decide) словами.
 */
function RowExplain({ i, profile, family, entity, fetchImpl }: {
  i: number; profile: string; family: string | null; entity: string | null; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  const path = pathOf(entity);
  const res = useLoadState<ToolExplain>(
    s => fetchToolExplain({ agent_scope: profile, ...(path ? { path } : { family: family ?? '' }) }, { signal: s, fetchImpl }),
    [profile, family, entity, fetchImpl]);
  if (res.state === 'forbidden') return <Forbidden reason={reasonOf(res.error)} />;
  if (res.state === 'error') return <LoadError error={res.error} onRetry={res.reload} />;
  if (!res.data) return <Skeleton lines={1} label={t('admin.access.loading')} />;
  const d = res.data;
  const known = d.verdict === 'denied' || d.verdict === 'allowed' || d.verdict === 'unlisted' || d.verdict === 'no_profile';
  return (
    <p className="adm-note" data-testid={`adm-why-403-verdict-${i}`} data-verdict={d.verdict}
      data-tone={d.verdict === 'denied' ? 'dng' : 'inf'} role="status">
      {known ? t(`admin.why.row.${d.verdict}` as AppKey, { profile, what: d.what ?? d.family ?? '—' }) : d.verdict}
      {d.why ? ` — ${d.why}` : ''}
      {d.verdict === 'denied' && (d.allowed_profiles.length
        ? ` · ${t('admin.why.row.open', { profiles: d.allowed_profiles.join(', ') })}`
        : ` · ${t('admin.why.row.human')}`)}
    </p>
  );
}
