// Мастера админки (SPRINT_UXR_S7B_ADMIN/S7B-17): UC-1 «подключить человека»,
// UC-2 «дать человеку агента», UC-7 «новый ноутбук». Прототип —
// docs/prototypes/s7b-admin-v6.html, разделы UC-1/UC-2/UC-7.
//
// Мастер собран из готовых элементов kit и не рисует своего:
//   • Steps — полоса шагов, «вперёд нельзя» с причиной, блок «осталось руками»;
//   • DiffPreview + BatchUndo — через DangerBatch, тот же путь, что у «Ролей»;
//   • SecretOnce — секрет агента один раз, за предупреждением.
// Выбор мастера, шаг и введённое (логин, «как у», чей агент, машина) — в
// адресе; секрет — нигде, кроме ответа сервера и SecretOnce.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LoadError, SecretOnce, Skeleton, Steps, setUrlParams, useKitLang, useLoadState, useUrlParam, type StepDef, type StepsManualItem,
} from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { runtimeAuth } from '../auth/runtimeAuthConfig';
import { useAppT, type AppKey } from '../i18n';
import { useAdminNav } from './adminNav';
import { DangerBatch } from './DangerBatch';
import { RotatePanel } from './KcDanger';
import { TokenCheckNote } from './TokenCheckNote';
import { fetchAgents, type AgentsData } from './agents';
import { fetchRoleMatrix, type RolesData } from './roles';
import { fetchOwnerDelegation, type DelegationRow } from './access';
import { ProjectLikeWizard } from './ProjectLikeWizard';
import { PROJECT_WIZ_PARAMS } from './projectLike';
import { teaLoginHint, useGitHost } from './gitHost';
import {
  agentClientIdOf, backendOf, createKcUser, fetchFirstCall, fetchKcClients, fetchKcUsers, findKcUser,
  issueAgent, likeChanges, loginOf, machineProblem, machineTakenBy, mcpAddCommand, mcpJsonText, reasonOf,
  templateProfiles, verifyPersonRoles, type FirstCall, type IssuedAgent, type KcUser, type RoleVerify,
} from './wizards';
import type { RoleChange } from './roles';

export type WizardKind = 'person' | 'agent' | 'machine' | 'project' | 'secret';
// UC-5 «проект как у похожего» (S7B-18) — ProjectLikeWizard.tsx.
// PU-13: «Сменить секрет агента» (S7B-19, UC-6) — SecretWizard ниже.
const KINDS: readonly WizardKind[] = ['person', 'agent', 'machine', 'project', 'secret'];
const STEP_KEY = 'adm-step';
/**
 * Параметры адреса, которые принадлежат мастеру, а не экрану. Шаг общий у всех
 * трёх мастеров (S7B-29): без сброса при смене мастера новый открывался на
 * шаге прежнего — или с заметкой «шага нет», если такого ключа у него нет.
 */
const WIZ_PARAMS = [STEP_KEY, 'adm-login', 'adm-like', 'adm-owner', 'adm-machine', 'adm-profile', 'adm-secret-client', ...PROJECT_WIZ_PARAMS] as const;

export interface WizardsEnv { backend: string; issuer: string }

export interface WizardsScreenProps {
  fetchImpl?: typeof fetch;
  /** kc_sub смотрящего: он владелец агента новой машины (UC-7). */
  meSub: string | null;
  /** Адреса для конфига MCP; по умолчанию — этот хост и issuer из настроек запуска. */
  env?: WizardsEnv;
}

function defaultEnv(): WizardsEnv {
  // Адрес входа — настройка запуска (/config.json → бэкенд), не сборки (SELF-PROVISION-STANDALONE).
  const issuer = runtimeAuth()?.issuer ?? '';
  return { backend: backendOf(globalThis.location.origin), issuer: issuer || '<issuer Keycloak>' };
}

/** Загрузка с тремя честными состояниями: идёт / есть / не вышло (с причиной). */
type Load<T> = { kind: 'loading' } | { kind: 'ok'; data: T } | { kind: 'error'; error: unknown };

function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    load().then(
      data => { if (alive) setState({ kind: 'ok', data }); },
      (error: unknown) => { if (alive) setState({ kind: 'error', error }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return [state, () => setAttempt(a => a + 1)];
}

function Loaded<T>({ state, retry, children }: { state: Load<T>; retry: () => void; children: (d: T) => ReactNode }) {
  const t = useAppT();
  if (state.kind === 'loading') return <Skeleton lines={2} label={t('admin.wiz.loading')} />;
  if (state.kind === 'error') return <LoadError error={state.error} onRetry={retry} />;
  return <>{children(state.data)}</>;
}

export function WizardsScreen({ fetchImpl = loreFetch, meSub, env }: WizardsScreenProps) {
  const t = useAppT();
  const [wizRaw] = useUrlParam('adm-wiz');
  const wiz = KINDS.includes(wizRaw as WizardKind) ? (wizRaw as WizardKind) : null;
  const cfg = useMemo(() => env ?? defaultEnv(), [env]);
  // Чем закончился последний мастер: «Готово» снимает выбор, и без этой
  // строки экран молча вернулся бы к выбору — непонятно, сработало ли.
  const [finished, setFinished] = useState<WizardKind | null>(null);
  const pick = (k: WizardKind) => {
    setFinished(null);
    if (k === wiz) return;
    // Введённое прежним мастером не переезжает в новый: у «агента машины»
    // владелец — вы, и чужое имя машины из «агента человеку» там было бы враньём.
    setUrlParams({ 'adm-wiz': k, ...Object.fromEntries(WIZ_PARAMS.map(p => [p, null])) });
  };
  const finish = (k: WizardKind) => {
    setUrlParams({ 'adm-wiz': null, ...Object.fromEntries(WIZ_PARAMS.map(p => [p, null])) });
    setFinished(k);
  };
  return (
    <section className="adm" aria-labelledby="adm-wiz-h" data-testid="adm-wizards">
      <h2 id="adm-wiz-h" className="adm-h">{t('admin.wiz.title')}</h2>
      <p className="adm-lead">{t('admin.wiz.lead')}</p>
      <div className="adm-wiz-pick" role="group" aria-label={t('admin.wiz.title')}>
        {KINDS.map(k => (
          <button
            key={k}
            type="button"
            className="adm-wiz-card"
            aria-pressed={wiz === k}
            data-testid={`adm-wiz-pick-${k}`}
            onClick={() => pick(k)}
          >
            <b>{t(`admin.wiz.${k}.title` as AppKey)}</b>
            <span className="adm-dim">{t(`admin.wiz.${k}.lead` as AppKey)}</span>
          </button>
        ))}
      </div>
      {!wiz && finished && (
        <p className="adm-verdict" role="status" data-testid="adm-wiz-finished">
          {t('admin.wiz.finished', { title: t(`admin.wiz.${finished}.title` as AppKey) })}
        </p>
      )}
      {wiz === 'person' && <PersonWizard key="person" fetchImpl={fetchImpl} onDone={() => finish('person')} />}
      {wiz === 'agent' && <AgentWizard key="agent" mode="agent" fetchImpl={fetchImpl} meSub={meSub} env={cfg} onDone={() => finish('agent')} />}
      {wiz === 'machine' && <AgentWizard key="machine" mode="machine" fetchImpl={fetchImpl} meSub={meSub} env={cfg} onDone={() => finish('machine')} />}
      {wiz === 'project' && <ProjectLikeWizard key="project" fetchImpl={fetchImpl} onDone={() => finish('project')} />}
      {wiz === 'secret' && <SecretWizard key="secret" fetchImpl={fetchImpl} />}
    </section>
  );
}

// ── UC-6: сменить секрет агента без простоя (S7B-19, PU-13) ─────────────────

/**
 * Выбор агента → та же панель, что в карточке агента: ротация (дифф, ввод
 * client_id, секрет один раз) и прежний секрет — «перешёл?» и отзыв. Агент
 * без клиента KC не предлагается: ротировать нечего. Выбор — в адресе.
 */
export function SecretWizard({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const t = useAppT();
  const [client, setClient] = useUrlParam('adm-secret-client');
  const res = useLoadState<AgentsData>(signal => fetchAgents(signal, fetchImpl), [fetchImpl]);
  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of res.data?.rows ?? []) {
      if (r.client_id && !seen.has(r.client_id)) seen.set(r.client_id, r.name ?? r.actor_id);
    }
    return [...seen.entries()];
  }, [res.data]);
  if (!res.data && res.state === 'loading') return <Skeleton lines={2} label={t('admin.wiz.secret.loading')} />;
  if (!res.data) return <LoadError compact error={res.error} onRetry={res.reload} />;
  return (
    <div className="adm-wiz" data-testid="adm-wiz-secret">
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.wiz.secret.agent')}</span>
        <select className="adm-select" data-testid="adm-wiz-secret-agent" value={client ?? ''}
          onChange={e => setClient(e.target.value || null)}>
          <option value="">{t('admin.wiz.secret.pick')}</option>
          {clients.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}
        </select>
      </label>
      {clients.length === 0 && <p className="adm-note" role="status">{t('admin.wiz.secret.none')}</p>}
      {client && <RotatePanel key={client} clientId={client} fetchImpl={fetchImpl} />}
    </div>
  );
}

// ── UC-1: подключить человека ─────────────────────────────────────────────

export function PersonWizard({ fetchImpl, onDone }: { fetchImpl: typeof fetch; onDone: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const nav = useAdminNav();
  const [step, setStep] = useUrlParam(STEP_KEY);
  const [q, setQ] = useUrlParam('adm-login');
  const [likeSub, setLike] = useUrlParam('adm-like');
  const [users, retryUsers] = useLoad(() => fetchKcUsers(fetchImpl), [fetchImpl]);
  const [matrix, retryMatrix] = useLoad(() => fetchRoleMatrix(undefined, fetchImpl), [fetchImpl]);
  const gitHost = useGitHost(fetchImpl);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [override, setOverride] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Какая пачка применена (S7B-29). Флаг «применено» без пачки врал в двух
  // местах: после отмены пачки вперёд было можно, хотя ролей уже нет; после
  // смены проектов — тоже, хотя новая пачка не применялась.
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  // Шаг диффа, раз открытый, остаётся смонтированным (S7B-29): иначе уход на
  // «проверку» размонтировал DangerBatch — пропадали итог пачки и окно
  // отмены, а возврат заново считал дифф и предлагал применить ещё раз.
  const [diffReached, setDiffReached] = useState(false);
  if (!diffReached && step === 'diff') setDiffReached(true);

  const found: KcUser | null | undefined = users.kind === 'ok' ? findKcUser(users.data, q ?? '') : undefined;
  const changes = matrix.kind === 'ok' && likeSub ? likeChanges(matrix.data, likeSub, excluded, override) : [];
  const changesKey = JSON.stringify(changes);
  const applied = appliedKey !== null && appliedKey === changesKey;

  const create = async () => {
    const s = (q ?? '').trim();
    setCreating(true);
    setCreateError(null);
    try {
      await createKcUser(loginOf(s), s.includes('@') ? s : null, fetchImpl);
      retryUsers();
    } catch (e) {
      setCreateError(reasonOf(e));
    } finally {
      setCreating(false);
    }
  };

  const account = (
    <div className="adm-field">
      <label className="adm-field">
        <span>{t('admin.wiz.person.login')}</span>
        <input
          className="adm-input"
          data-testid="adm-wiz-login"
          value={q ?? ''}
          placeholder="anna@…"
          onChange={e => setQ(e.target.value || null)}
        />
      </label>
      <Loaded state={users} retry={retryUsers}>
        {() => found === undefined ? null : found
          ? (
            <p className="adm-sub" data-testid="adm-wiz-found" role="status">
              {t('admin.wiz.person.found', { login: found.username, sub: found.id })}
            </p>
          )
          : (
            <div className="adm-sub" data-testid="adm-wiz-notfound" role="status">
              <span>{t('admin.wiz.person.notFound')}</span>
              <button type="button" className="adm-btn" data-testid="adm-wiz-create" disabled={creating} onClick={() => { void create(); }}>
                {t('admin.wiz.person.create', { login: loginOf(q ?? '') })}
              </button>
              <span className="adm-hint">{t('admin.wiz.person.createHint')}</span>
              {createError && <span className="adm-err" role="alert" data-testid="adm-wiz-create-error">{createError}</span>}
            </div>
          )}
      </Loaded>
    </div>
  );

  const toggle = (project: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(project)) next.delete(project); else next.add(project);
    return next;
  });

  const projects = (
    <Loaded state={matrix} retry={retryMatrix}>
      {(data: RolesData) => {
        const like = data.people.find(p => p.kc_sub === likeSub);
        return (
          <div className="adm-field">
            <label className="adm-field">
              <span>{t('admin.wiz.person.like')}</span>
              <select className="adm-select" data-testid="adm-wiz-like" value={likeSub ?? ''} onChange={e => { setLike(e.target.value || null); setExcluded(new Set()); setOverride({}); }}>
                <option value="">{t('admin.wiz.pickOne')}</option>
                {data.people.filter(p => p.kc_sub !== found?.id).map(p => <option key={p.kc_sub} value={p.kc_sub}>{p.name}</option>)}
              </select>
            </label>
            {like && (
              <ul className="adm-plist" data-testid="adm-wiz-projects">
                {like.cells.filter(c => c.role).map(c => {
                  const checked = c.state === 'checked';
                  return (
                    <li key={c.project} className="adm-sub">
                      <label>
                        <input
                          type="checkbox"
                          data-testid={`adm-wiz-proj-${c.project}`}
                          disabled={!checked}
                          checked={checked && !excluded.has(c.project)}
                          onChange={() => toggle(c.project)}
                        />
                        {' '}{c.project}
                      </label>
                      <select
                        className="adm-select"
                        aria-label={t('admin.wiz.person.roleOf', { project: c.project })}
                        disabled={!checked}
                        value={override[c.project] ?? c.role ?? ''}
                        onChange={e => setOverride(o => ({ ...o, [c.project]: e.target.value }))}
                      >
                        {[...new Set([c.role as string, 'owner', 'architect', 'pm', 'developer', 'business-analyst', 'marketer', 'tester', 'reader'])]
                          .map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {!checked && <span className="adm-missing">{t('admin.wiz.person.unverified')}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="adm-hint">{t('admin.wiz.person.likeHint')}</p>
          </div>
        );
      }}
    </Loaded>
  );

  // «Отмена» до применения — назад к проектам; «Готово» после — дальше, к
  // проверке. Прежде обе кнопки сбрасывали «применено» и запирали мастер.
  const diff = found && diffReached && changes.length > 0
    ? (
      <DangerBatch
        person={{ kc_sub: found.id, name: found.username }}
        changes={changes}
        fetchImpl={fetchImpl}
        onClose={() => setStep(applied ? 'check' : 'projects')}
        onChanged={what => setAppliedKey(what === 'applied' ? changesKey : null)}
      />
    )
    : <p className="adm-dim">{t('admin.wiz.person.diffLead')}</p>;

  const check = (
    <div className="adm-field">
      {/* S7B-13: шаг сам сверяет роли с сервером, а не только ведёт в «Люди». */}
      {found && applied && <PersonVerify kcSub={found.id} login={found.username} changes={changes} fetchImpl={fetchImpl} />}
      <p className="adm-lead">{t('admin.wiz.person.checkLead')}</p>
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-wiz-open-who" onClick={() => nav.go('who', {})}>
          {t('admin.wiz.person.openWho')}
        </button>
      </div>
    </div>
  );

  const steps: StepDef[] = [
    { key: 'account', title: t('admin.wiz.person.s.account'), blocked: found ? null : t('admin.wiz.person.b.account'), render: () => account },
    { key: 'projects', title: t('admin.wiz.person.s.projects'), blocked: changes.length ? null : t('admin.wiz.person.b.projects'), render: () => projects },
    { key: 'diff', title: t('admin.wiz.person.s.diff'), blocked: applied ? null : t('admin.wiz.person.b.diff'), render: () => diff },
    { key: 'check', title: t('admin.wiz.person.s.check'), render: () => check },
  ];
  const manual: StepsManualItem[] = [
    { text: t('admin.wiz.manual.password'), hint: t('admin.wiz.manual.passwordHint') },
    // Адрес git-хоста — настройка установки (SELF-PROVISION-STANDALONE); нет — пункт без ссылки.
    { text: t('admin.wiz.manual.forgejo'), href: gitHost.data ?? undefined, hint: t('admin.wiz.manual.forgejoHint') },
  ];
  return <Steps steps={steps} urlKey={STEP_KEY} lang={lang} flow="adm-person" onDone={onDone} manual={{ title: t('admin.wiz.manual.title'), items: manual }} />;
}

/**
 * S7B-13: проверка после пачки — матрица ролей перечитывается С СЕРВЕРА и сверяется с тем,
 * что пачка назначала. Исходы названы разными словами: «совпало N из N» · «совпало N из M,
 * расхождения по проектам» · «не смогли проверить» (а не «всё в порядке»).
 */
function PersonVerify({ kcSub, login, changes, fetchImpl }: {
  kcSub: string; login: string; changes: readonly RoleChange[]; fetchImpl: typeof fetch;
}) {
  const t = useAppT();
  const key = JSON.stringify(changes);
  const res = useLoadState<RoleVerify>(
    async signal => verifyPersonRoles(await fetchRoleMatrix(signal, fetchImpl), kcSub, changes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changes сверяются по содержимому (key)
    [kcSub, key, fetchImpl],
  );
  const v = res.data;
  if (res.state === 'loading' && !v) {
    return (
      <div data-testid="adm-wiz-person-verify" data-state="loading">
        <Skeleton lines={1} label={t('admin.wiz.person.verify.loading')} />
      </div>
    );
  }
  if (!v) {
    const reason = res.error instanceof Error ? res.error.message : String(res.error ?? '');
    return (
      <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-wiz-person-verify" data-state="error">
        {t('admin.wiz.person.verify.error', { reason })}{' '}
        <button type="button" className="adm-btn" onClick={res.reload}>{t('admin.wiz.person.verify.retry')}</button>
      </p>
    );
  }
  const ok = v.misses.length === 0;
  return (
    <div className="adm-note" data-tone={ok ? 'inf' : 'wrn'} role="status" data-testid="adm-wiz-person-verify"
      data-state={ok ? 'ok' : 'mismatch'}>
      <span>{t(ok ? 'admin.wiz.person.verify.ok' : 'admin.wiz.person.verify.mismatch', { login, n: v.matched, m: v.total })}</span>
      {!ok && (
        <ul className="adm-plist">
          {v.misses.map(x => (
            <li key={x.project} className="adm-sub">
              <span className="adm-mono">{x.project}</span>{' — '}
              {x.unverified
                ? t('admin.wiz.person.verify.unverified')
                : t('admin.wiz.person.verify.miss', {
                  expected: x.expected ?? t('admin.wiz.person.verify.noRole'),
                  actual: x.actual ?? t('admin.wiz.person.verify.noRole'),
                })}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="adm-btn" data-testid="adm-wiz-person-verify-again" onClick={res.reload}>
        {t('admin.wiz.person.verify.retry')}
      </button>
    </div>
  );
}

/**
 * AP-03: что будет делать агент с выбранным профилем в проектах владельца — по ответу сервера
 * (delegation). Исходы: «пишет во всех N» · «в проектах X, Y — только читать: роль R не
 * делегирует профиль» · «у владельца нет проектов» · «не смогли проверить». Не запрещает:
 * читающего агента можно завести осознанно, мастер только называет последствие до «Выдать».
 */
function DelegationNote({ state, retry, profile, testId }: {
  state: { kind: 'loading' } | { kind: 'ok'; data: DelegationRow[] | null } | { kind: 'error'; error: unknown };
  retry: () => void; profile: string; testId: string;
}) {
  const t = useAppT();
  if (state.kind === 'loading') {
    return (
      <div data-testid={testId} data-state="loading">
        <Skeleton lines={1} label={t('admin.wiz.agent.deleg.loading')} />
      </div>
    );
  }
  if (state.kind === 'error' || !state.data) {
    const reason = state.kind === 'error' ? reasonOf(state.error) : '';
    return (
      <p className="adm-note" data-tone="wrn" role="status" data-testid={testId} data-state="error">
        {t('admin.wiz.agent.deleg.error', { reason })}{' '}
        <button type="button" className="adm-btn" onClick={retry}>{t('admin.wiz.person.verify.retry')}</button>
      </p>
    );
  }
  const rows = state.data;
  if (rows.length === 0) {
    return (
      <p className="adm-note" data-tone="wrn" role="status" data-testid={testId} data-state="none">
        {t('admin.wiz.agent.deleg.noProjects')}
      </p>
    );
  }
  const readOnly = rows.filter(r => !r.delegates);
  if (readOnly.length === 0) {
    return (
      <p className="adm-note" data-tone="inf" role="status" data-testid={testId} data-state="all">
        {t('admin.wiz.agent.deleg.all', { profile, n: rows.length })}
      </p>
    );
  }
  return (
    <div className="adm-note" data-tone="wrn" role="alert" data-testid={testId}
      data-state={readOnly.length === rows.length ? 'none-writes' : 'partial'}>
      <span>{t('admin.wiz.agent.deleg.partial', { profile, n: rows.length - readOnly.length, m: rows.length })}</span>
      <ul className="adm-plist">
        {readOnly.map(r => (
          <li key={r.project} className="adm-sub">
            <span className="adm-mono">{r.project}</span>{' — '}
            {r.role
              ? t('admin.wiz.agent.deleg.readsRole', { role: r.role, profile })
              : t('admin.wiz.agent.deleg.readsNoRole', { profile })}
          </li>
        ))}
      </ul>
      <span className="adm-hint">{t('admin.wiz.agent.deleg.allowed')}</span>
    </div>
  );
}

// ── UC-2 / UC-7: агент человеку · агент новой машины ─────────────────────

interface AgentWizardProps { mode: 'agent' | 'machine'; fetchImpl: typeof fetch; meSub: string | null; env: WizardsEnv; onDone: () => void }

function AgentWizard({ mode, fetchImpl, meSub, env, onDone }: AgentWizardProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [ownerParam, setOwner] = useUrlParam('adm-owner');
  const [machineParam, setMachine] = useUrlParam('adm-machine');
  const [profileParam, setProfile] = useUrlParam('adm-profile');
  const [harness, setHarness] = useState<string>('');
  const [matrix, retryMatrix] = useLoad(() => (mode === 'agent' ? fetchRoleMatrix(undefined, fetchImpl) : Promise.resolve(null)), [fetchImpl, mode]);
  const [clients, retryClients] = useLoad(() => fetchKcClients(fetchImpl), [fetchImpl]);
  const [agents, retryAgents] = useLoad<AgentsData>(() => fetchAgents(undefined, fetchImpl, lang), [fetchImpl, lang]);
  const gitHost = useGitHost(fetchImpl);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ agent: IssuedAgent; linkError: string | null; since: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [seen, setSeen] = useState<FirstCall | { kind: 'error'; reason: string } | null>(null);

  const ownerSub = mode === 'machine' ? meSub : ownerParam;
  const machine = (machineParam ?? '').trim();
  const profiles = clients.kind === 'ok' ? templateProfiles(clients.data) : [];
  // UC-7: агент машины по умолчанию — полный профиль владельца, если такой шаблон есть.
  const profile = profileParam ?? (mode === 'machine' ? (profiles.includes('full') ? 'full' : profiles[0] ?? null) : null);
  const problem = machineProblem(machine);
  const takenBy = agents.kind === 'ok' ? machineTakenBy(agents.data.rows, machine, ownerSub) : null;
  // AP-03: где агент с этим профилем будет писать, а где только читать — ответ сервера ДО выдачи.
  const [deleg, retryDeleg] = useLoad<DelegationRow[] | null>(
    () => (ownerSub ? fetchOwnerDelegation(ownerSub, profile, { fetchImpl }) : Promise.resolve(null)),
    [ownerSub, profile, fetchImpl],
  );
  const delegNote = (testId: string) => (ownerSub && profile
    ? <DelegationNote state={deleg} retry={retryDeleg} profile={profile} testId={testId} />
    : null);
  /** Счётчик у профиля: пишет в N из M проектов владельца (по ответу сервера). */
  const profileCount = (p: string) => (deleg.kind === 'ok' && deleg.data
    ? (
      <span className="adm-dim" data-testid={`adm-wiz-profile-count-${p}`}>
        {' · '}{t('admin.wiz.agent.deleg.count', { n: deleg.data.filter(r => r.profiles.includes(p)).length, m: deleg.data.length })}
      </span>
    )
    : null);

  const machineBlocked = problem === 'empty' ? t('admin.wiz.agent.b.machineEmpty')
    : problem === 'chars' ? t('admin.wiz.agent.b.machineChars')
      : takenBy ? t('admin.wiz.agent.b.machineTaken', { owner: takenBy })
        : !profile ? t('admin.wiz.agent.b.profile')
          : null;

  const issue = async () => {
    if (!ownerSub || !profile || machineBlocked) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const r = await issueAgent({ profile, machine, ownerSub, harness: harness || null }, fetchImpl);
      setIssued({ ...r, since: Date.now() - 60_000 });
    } catch (e) {
      setIssueError(reasonOf(e));
    } finally {
      setIssuing(false);
    }
  };

  const check = async () => {
    if (!issued) return;
    setChecking(true);
    try {
      setSeen(await fetchFirstCall({ clientId: issued.agent.clientId, machine, since: issued.since }, fetchImpl));
    } catch (e) {
      setSeen({ kind: 'error', reason: reasonOf(e) });
    } finally {
      setChecking(false);
    }
  };

  const ownerStep = (
    <Loaded state={matrix} retry={retryMatrix}>
      {data => (
        <label className="adm-field">
          <span>{t('admin.wiz.agent.owner')}</span>
          <select className="adm-select" data-testid="adm-wiz-owner" value={ownerParam ?? ''} onChange={e => setOwner(e.target.value || null)}>
            <option value="">{t('admin.wiz.pickOne')}</option>
            {(data?.people ?? []).map(p => <option key={p.kc_sub} value={p.kc_sub}>{p.name}</option>)}
          </select>
          <span className="adm-hint">{t('admin.wiz.agent.ownerHint')}</span>
        </label>
      )}
    </Loaded>
  );

  const harnessField = agents.kind === 'ok' && agents.data.registry
    ? (
      <label className="adm-field">
        <span>{t('admin.wiz.agent.harness')}</span>
        <select className="adm-select" data-testid="adm-wiz-harness" value={harness} onChange={e => setHarness(e.target.value)}>
          <option value="">{t('admin.wiz.agent.harnessNone')}</option>
          {agents.data.registry.map(h => <option key={h} value={h}>{agents.data.labels[h] ?? h}</option>)}
        </select>
      </label>
    )
    : agents.kind === 'error' ? <LoadError error={agents.error} onRetry={retryAgents} /> : null;

  const profileStep = (
    <div className="adm-field">
      <Loaded state={clients} retry={retryClients}>
        {() => profiles.length === 0
          ? <p className="adm-note" role="status" data-testid="adm-wiz-noprofiles">{t('admin.wiz.agent.noProfiles')}</p>
          : (
            <fieldset className="adm-field" data-testid="adm-wiz-profiles">
              <legend>{t('admin.wiz.agent.profile')}</legend>
              {profiles.map(p => (
                <label key={p} className="adm-sub">
                  <input type="radio" name="adm-wiz-profile" data-testid={`adm-wiz-profile-${p}`} checked={profile === p} onChange={() => setProfile(p)} />
                  <b>{p}</b>
                  <span className="adm-dim">{profileWords(t, p)}</span>
                  {profileCount(p)}
                </label>
              ))}
            </fieldset>
          )}
      </Loaded>
      <label className="adm-field">
        <span>{t('admin.wiz.agent.machine')}</span>
        <input className="adm-input" data-testid="adm-wiz-machine" value={machineParam ?? ''} placeholder="huawei-matebook" onChange={e => setMachine(e.target.value || null)} />
        {!problem && profile && <span className="adm-hint">{t('admin.wiz.agent.clientWillBe', { client: agentClientIdOf(profile, machine) })}</span>}
      </label>
      {harnessField}
      <p className="adm-hint">{t('admin.wiz.agent.inherits')}</p>
      {delegNote('adm-wiz-delegation')}
    </div>
  );

  const mcp = issued ? { ...env, clientId: issued.agent.clientId, machine } : null;
  const secretStep = (
    <div className="adm-field">
      {/* AP-03: последствие названо рядом с «Выдать», до нажатия. */}
      {!issued && delegNote('adm-wiz-delegation-issue')}
      {!issued && (
        <div className="adm-field--btns">
          <button type="button" className="adm-btn" data-testid="adm-wiz-issue" disabled={issuing || !!machineBlocked || !ownerSub} onClick={() => { void issue(); }}>
            {t('admin.wiz.agent.issue', { client: profile && !problem ? agentClientIdOf(profile, machine) : '…' })}
          </button>
        </div>
      )}
      {issueError && <p className="adm-err" role="alert" data-testid="adm-wiz-issue-error">{issueError}</p>}
      {issued && (
        <>
          {issued.agent.secret
            ? <SecretOnce value={issued.agent.secret} label={t('admin.wiz.agent.secretLabel', { client: issued.agent.clientId })} lang={lang} />
            : <p className="adm-note" data-tone="dng" role="alert">{t('admin.wiz.agent.noSecret')}</p>}
          {issued.linkError && <p className="adm-err" role="alert" data-testid="adm-wiz-link-error">{t('admin.wiz.agent.linkError', { reason: issued.linkError })}</p>}
          {issued.agent.rolesNote && <p className="adm-note" role="status">{issued.agent.rolesNote}</p>}
          {/* AO-AGENT-ADD: «завёлся» — фактом токена, а не отсутствием ошибки. */}
          <TokenCheckNote check={issued.agent.tokenCheck} />
          {mcp && (
            <>
              <p className="adm-lead">{t('admin.wiz.agent.command')}</p>
              <pre className="adm-prose adm-wiz-code" data-testid="adm-wiz-command">{mcpAddCommand(mcp)}</pre>
              <p className="adm-lead">{t('admin.wiz.agent.mcpJson')}</p>
              <pre className="adm-prose adm-wiz-code" data-testid="adm-wiz-mcpjson">{mcpJsonText(mcp)}</pre>
              <p className="adm-hint">{t('admin.wiz.agent.secretEnv')}</p>
            </>
          )}
        </>
      )}
    </div>
  );

  const checkStep = (
    <div className="adm-field">
      <p className="adm-lead">{t('admin.wiz.agent.checkLead')}</p>
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-wiz-check" disabled={checking || !issued} onClick={() => { void check(); }}>
          {t('admin.wiz.agent.check')}
        </button>
      </div>
      {seen?.kind === 'seen' && (
        <p className="adm-verdict" data-testid="adm-wiz-seen" role="status">
          {t(seen.how === 'session' ? 'admin.wiz.agent.seenSession' : 'admin.wiz.agent.seenWrite', { machine, at: seen.at ?? '' })}
        </p>
      )}
      {seen?.kind === 'waiting' && <p className="adm-note" role="status" data-testid="adm-wiz-waiting">{t('admin.wiz.agent.waiting')}</p>}
      {seen?.kind === 'error' && <p className="adm-err" role="alert" data-testid="adm-wiz-check-error">{t('admin.wiz.agent.checkError', { reason: seen.reason })}</p>}
    </div>
  );

  const steps: StepDef[] = mode === 'agent'
    ? [
      { key: 'owner', title: t('admin.wiz.agent.s.owner'), blocked: ownerSub ? null : t('admin.wiz.agent.b.owner'), render: () => ownerStep },
      { key: 'profile', title: t('admin.wiz.agent.s.profile'), blocked: machineBlocked, render: () => profileStep },
      { key: 'secret', title: t('admin.wiz.agent.s.secret'), blocked: issued ? null : t('admin.wiz.agent.b.issue'), render: () => secretStep },
      { key: 'check', title: t('admin.wiz.agent.s.check'), render: () => checkStep },
    ]
    : [
      { key: 'machine', title: t('admin.wiz.machine.s.machine'), blocked: ownerSub ? machineBlocked : t('admin.wiz.machine.b.me'), render: () => profileStep },
      { key: 'connect', title: t('admin.wiz.machine.s.connect'), blocked: issued ? null : t('admin.wiz.agent.b.issue'), render: () => secretStep },
      { key: 'check', title: t('admin.wiz.agent.s.check'), render: () => checkStep },
    ];
  const manual: StepsManualItem[] = mode === 'agent'
    ? [
      { text: t('admin.wiz.manual.secretStore'), hint: t('admin.wiz.manual.secretStoreHint') },
    ]
    : [
      { text: t('admin.wiz.manual.mcpBuild'), hint: t('admin.wiz.manual.mcpBuildHint') },
      { text: t('admin.wiz.manual.tea'), hint: teaLoginHint(gitHost.data ?? null, t('admin.wiz.gitHost.missing')) },
      { text: t('admin.wiz.manual.minilore'), hint: t('admin.wiz.manual.miniloreHint', { machine: machine || '…' }) },
      { text: t('admin.wiz.manual.infisical'), hint: t('admin.wiz.manual.infisicalHint') },
    ];
  return (
    <Steps
      steps={steps}
      urlKey={STEP_KEY}
      lang={lang}
      flow={`adm-${mode}`}
      onDone={onDone}
      manual={{ title: t('admin.wiz.manual.title'), items: manual }}
    />
  );
}

/** Профиль словами; незнакомый профиль — без выдуманного описания. */
function profileWords(t: ReturnType<typeof useAppT>, p: string): string {
  const known: Record<string, AppKey> = {
    full: 'admin.wiz.profile.full',
    developer: 'admin.wiz.profile.developer',
    tester: 'admin.wiz.profile.tester',
    marketer: 'admin.wiz.profile.marketer',
  };
  return known[p] ? t(known[p]) : t('admin.wiz.profile.unknown');
}
