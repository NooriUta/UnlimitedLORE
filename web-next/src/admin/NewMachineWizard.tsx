// Мастер «Новая машина» (SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT). Прототип
// docs/prototypes/ap-machine-passport.html, экран В (1280 и 390); «да» владельца 25.11.
//
// Поверх двери machine_new (POST /lore/actor/machine): поля как у неё, dry-run — план «было → станет»,
// отказ MACHINE_TAKEN — словами из detail ответа. Решения владельца:
//   • 4а — учётку шлюза в Keycloak мастер НЕ заводит: пишет граф и показывает «осталось руками»;
//   • 5в — один мастер, два входа: кнопка «Новая машина» в списке машин и карточка в «Мастерах»;
//   • находка 3 — агент, у которого ребро к машине уже есть, — «уже привязан», а не «будет привязан».
// Это НЕ UC-7 «Новый ноутбук»: тот заводит учётку агента lore-mcp-<профиль>_<машина>, этот — машину.
// Введённое — в адресе (adm-nm-*), шаг — общий параметр мастеров.
import { useMemo, useState } from 'react';
import { LoadError, Pill, Skeleton, Steps, useKitLang, useLoadState, useUrlParam, type StepDef, type StepsManualItem } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { fetchAgents, type AgentsData } from './agents';
import { fetchRoleMatrix, type RolesData } from './roles';
import {
  agentPlan, machineIdProblem, machinePassportHref, planRows, postEnroll, type EnrollAnswer,
} from './machineGraph';
import './Admin.css';

export const NM_PARAMS = ['adm-nm-id', 'adm-nm-owner', 'adm-nm-harness', 'adm-nm-name', 'adm-nm-profile'] as const;
const STEP_KEY = 'adm-step';

type Check =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'plan'; answer: EnrollAnswer }
  | { kind: 'taken'; detail: string }
  | { kind: 'refused'; status: number; detail: string }
  | { kind: 'error'; reason: string };

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

function verdictOf(e: unknown): Check {
  if (e instanceof LoreHttpError && e.code === 'MACHINE_TAKEN') return { kind: 'taken', detail: e.detail };
  if (e instanceof LoreHttpError && (e.status === 400 || e.status === 403 || e.status === 404)) return { kind: 'refused', status: e.status, detail: e.detail || e.message };
  return { kind: 'error', reason: reasonOf(e) };
}

export interface NewMachineWizardProps {
  fetchImpl?: typeof fetch;
  /** kc_sub смотрящего — владелец по умолчанию (себе заводит любой человек). */
  meSub: string | null;
  onDone: () => void;
}

export function NewMachineWizard({ fetchImpl, meSub, onDone }: NewMachineWizardProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [idParam, setId] = useUrlParam('adm-nm-id');
  const [ownerParam, setOwner] = useUrlParam('adm-nm-owner');
  const [harnessParam, setHarness] = useUrlParam('adm-nm-harness');
  const [nameParam, setName] = useUrlParam('adm-nm-name');
  const [profileParam, setProfile] = useUrlParam('adm-nm-profile');
  const agents = useLoadState<AgentsData>(signal => fetchAgents(signal, fetchImpl, lang), [fetchImpl, lang], { rows: d => d.rows });
  const people = useLoadState<RolesData>(signal => fetchRoleMatrix(signal, fetchImpl), [fetchImpl], { rows: d => d.people });
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [applied, setApplied] = useState<{ answer: EnrollAnswer } | { error: string } | null>(null);
  const [applying, setApplying] = useState(false);

  const raw = idParam ?? '';
  const machine = raw.trim().toLowerCase();
  const problem = machineIdProblem(raw);
  const owner = ownerParam ?? meSub ?? '';
  const client = `minilore-link-${machine || '…'}`;
  const profiles = useMemo(() => [...new Set((agents.data?.rows ?? []).map(r => r.agent_role).filter((x): x is string => !!x))].sort(), [agents.data]);
  const nameOfSub = (sub: string | null | undefined) => (sub ? people.data?.people.find(p => p.kc_sub === sub)?.name ?? sub : '—');

  const request = { machine_id: machine, kc_sub: owner || null, harness: harnessParam || null, name: nameParam || null, profile: profileParam || null };
  // Правка поля после проверки — план устарел: проверять заново, а не заводить по старому плану.
  const edit = (set: (v: string | null) => void) => (v: string) => { set(v || null); setCheck({ kind: 'idle' }); setApplied(null); };

  const runCheck = async () => {
    if (problem) return;
    setCheck({ kind: 'busy' });
    try {
      setCheck({ kind: 'plan', answer: await postEnroll({ ...request, dry_run: true }, fetchImpl) });
    } catch (e) {
      setCheck(verdictOf(e));
    }
  };
  const apply = async () => {
    setApplying(true);
    try {
      setApplied({ answer: await postEnroll(request, fetchImpl) });
    } catch (e) {
      const v = verdictOf(e);
      setApplied({ error: v.kind === 'taken' ? v.detail : v.kind === 'refused' ? v.detail : v.kind === 'error' ? v.reason : '' });
    } finally {
      setApplying(false);
    }
  };

  const problemText = problem === 'empty' ? t('admin.nm.idEmpty')
    : problem === 'chars' ? t('admin.nm.idChars')
      : problem === 'prefix' ? t('admin.nm.idPrefix', { id: raw.trim().slice('minilore-link-'.length) })
        : null;

  const machineStep = (
    <div className="adm-wiz adm-field" data-testid="adm-nm-form">
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.nm.id')} *</span>
        <input className="adm-input" data-testid="adm-nm-id" value={raw} placeholder="argharaga" onChange={e => edit(setId)(e.target.value)} />
        {problemText
          ? <span className="adm-err" role="alert" data-testid="adm-nm-id-problem">{problemText}</span>
          : <span className="adm-hint">{t('admin.nm.idHint', { client })}</span>}
      </label>
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.nm.owner')} *</span>
        {people.data
          ? (
            <select className="adm-select" data-testid="adm-nm-owner" value={owner} onChange={e => edit(setOwner)(e.target.value === meSub ? '' : e.target.value)}>
              {!meSub && <option value="">{t('admin.wiz.pickOne')}</option>}
              {meSub && !people.data.people.some(p => p.kc_sub === meSub) && <option value={meSub}>{t('admin.nm.ownerMe')}</option>}
              {people.data.people.map(p => <option key={p.kc_sub} value={p.kc_sub}>{p.name}{p.kc_sub === meSub ? ` · ${t('admin.nm.ownerMe')}` : ''}</option>)}
            </select>
          )
          : people.state === 'loading' ? <Skeleton lines={1} label={t('admin.wiz.loading')} />
            : <span className="adm-dim">{meSub ? t('admin.nm.ownerMeOnly') : ''} <LoadError compact error={people.error} onRetry={people.reload} /></span>}
        <span className="adm-hint">{t('admin.nm.ownerHint')}</span>
      </label>
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.nm.harness')}</span>
        {agents.data
          ? (
            <select className="adm-select" data-testid="adm-nm-harness" value={harnessParam ?? ''} onChange={e => edit(setHarness)(e.target.value)}>
              <option value="">{t('admin.nm.harnessNone')}</option>
              {(agents.data.registry ?? []).map(h => <option key={h} value={h}>{agents.data?.labels[h] ?? h}</option>)}
            </select>
          )
          : agents.state === 'loading' ? <Skeleton lines={1} label={t('admin.wiz.loading')} /> : <LoadError compact error={agents.error} onRetry={agents.reload} />}
        <span className="adm-hint">{t('admin.nm.harnessHint')}</span>
      </label>
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.nm.name')}</span>
        <input className="adm-input" data-testid="adm-nm-name" value={nameParam ?? ''} maxLength={200} placeholder={client} onChange={e => edit(setName)(e.target.value)} />
        <span className="adm-hint">{t('admin.nm.nameHint')}</span>
      </label>
      <label className="adm-field">
        <span className="adm-field__l">{t('admin.nm.profile')}</span>
        <select className="adm-select" data-testid="adm-nm-profile" value={profileParam ?? ''} onChange={e => edit(setProfile)(e.target.value)}>
          <option value="">{t('admin.nm.profileNone')}</option>
          {profiles.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="adm-hint">{t('admin.nm.profileHint')}</span>
      </label>
      <p className="adm-note" role="note">{t('admin.nm.noSecret')}</p>
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-nm-check" disabled={!!problem || !owner || check.kind === 'busy'} onClick={() => { void runCheck(); }}>
          {check.kind === 'busy' ? t('admin.nm.checking') : t('admin.nm.check')}
        </button>
      </div>
      <CheckView check={check} machine={machine} nameOfSub={nameOfSub} applying={applying} applied={applied} onApply={() => { void apply(); }} />
    </div>
  );

  // Исход записи показан на первом шаге сразу после «Завести»; здесь — ссылка на паспорт и «осталось руками» (kit).
  const doneStep = applied && 'answer' in applied
    ? <p className="adm-sub" data-testid="adm-nm-done-step"><a href={machinePassportHref(machine)}>{t('admin.nm.openPassport')}</a></p>
    : <p className="adm-note" role="status">{t('admin.nm.b.apply')}</p>;

  const steps: StepDef[] = [
    { key: 'machine', title: t('admin.nm.s.machine'), blocked: applied && 'answer' in applied ? null : t('admin.nm.b.apply'), render: () => machineStep },
    { key: 'done', title: t('admin.nm.s.done'), render: () => doneStep },
  ];
  const manual: StepsManualItem[] = [
    { text: t('admin.nm.manual.kc', { client: `minilore-link-${machine || '…'}` }), hint: t('admin.nm.manual.kcHint') },
    { text: t('admin.nm.manual.env', { id: machine || '…' }), hint: t('admin.nm.manual.envHint') },
  ];
  return (
    <div data-testid="adm-wiz-newmachine">
      <Steps steps={steps} urlKey={STEP_KEY} lang={lang} flow="adm-newmachine" onDone={onDone}
        manual={{ title: t('admin.nm.manual.title'), items: manual }} />
      {applied && 'answer' in applied && (
        <ul className="adm-list" data-testid="adm-nm-manual" aria-label={t('admin.nm.manual.title')}>
          {manual.map(m => <li key={m.text}>{m.text} <span className="adm-dim">{m.hint}</span></li>)}
        </ul>
      )}
    </div>
  );
}

function CheckView({ check, machine, nameOfSub, applying, applied, onApply }: {
  check: Check; machine: string; nameOfSub: (s: string | null | undefined) => string; applying: boolean;
  applied: { answer: EnrollAnswer } | { error: string } | null; onApply: () => void;
}) {
  const t = useAppT();
  if (check.kind === 'idle' || check.kind === 'busy') return null;
  if (check.kind === 'taken') {
    return (
      <div className="adm-note" data-tone="dng" role="alert" data-testid="adm-nm-taken">
        <p className="adm-note__line"><b>{t('admin.nm.taken', { id: machine })}</b></p>
        <p className="adm-note__line">{check.detail}</p>
        <p className="adm-note__line">{t('admin.nm.takenHint')}</p>
        <p className="adm-note__line"><span className="adm-mono">409 · MACHINE_TAKEN</span>{' '}<a href={machinePassportHref(machine)}>{t('admin.nm.openPassport')}</a></p>
      </div>
    );
  }
  if (check.kind === 'refused') return <p className="adm-err" role="alert" data-testid="adm-nm-refused">{t('admin.nm.refused', { status: check.status, reason: check.detail })}</p>;
  if (check.kind === 'error') return <p className="adm-err" role="alert" data-testid="adm-nm-error">{t('admin.nm.error', { reason: check.reason })}</p>;
  const a = check.answer;
  const kindKey = (a.kind === 'create' || a.kind === 'update' || a.kind === 'unchanged' ? `admin.nm.kind.${a.kind}` : 'admin.nm.kind.other') as AppKey;
  const agents = agentPlan(a);
  const fieldKey = (k: string) => `admin.nm.f.${k}` as AppKey;
  const show = (k: string, v: string | null) => (v === null ? '—' : k === 'owner' ? nameOfSub(v) : v);
  return (
    <div className="adm-field" data-testid="adm-nm-plan">
      <p className="adm-sub"><Pill tone="acc">{t(kindKey)}</Pill> <span className="adm-mono">plan.kind = {a.kind}</span> · <span className="adm-dim">{t('admin.nm.dry')}</span></p>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead><tr><th>{t('admin.nm.col.field')}</th><th>{t('admin.nm.col.before')}</th><th>{t('admin.nm.col.after')}</th></tr></thead>
          <tbody>
            {planRows(a).map(r => (
              <tr key={r.key}>
                <th scope="row">{t(fieldKey(r.key))}</th>
                <td>{show(r.key, r.before)}</td>
                <td>{r.same ? <span className="adm-dim">{t('admin.nm.same')}</span> : show(r.key, r.after)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">{t('admin.nm.agents')}</th>
              <td>—</td>
              <td data-testid="adm-nm-agents">
                {agents.length
                  ? agents.map(x => <span key={x.actor_id} className="adm-sub">{x.actor_id} · {t(x.state === 'linked' ? 'admin.nm.agentLinked' : 'admin.nm.agentLink')}</span>)
                  : <span className="adm-dim">{t('admin.nm.agentsNone', { id: machine })}</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {!(applied && 'answer' in applied) && (
        <div className="adm-field--btns">
          <button type="button" className="adm-btn" data-testid="adm-nm-apply" disabled={applying} onClick={onApply}>
            {applying ? t('admin.nm.applying') : t('admin.nm.apply')}
          </button>
        </div>
      )}
      {applied && 'error' in applied && <p className="adm-err" role="alert" data-testid="adm-nm-apply-error">{t('admin.nm.error', { reason: applied.error })}</p>}
      {applied && 'answer' in applied && <DoneView answer={applied.answer} machine={machine} />}
    </div>
  );
}

function DoneView({ answer: a, machine }: { answer: EnrollAnswer; machine: string }) {
  const t = useAppT();
  const outcome = (a.outcome ?? '').toLowerCase();
  const key = (outcome === 'created' || outcome === 'updated' || outcome === 'unchanged' ? `admin.nm.done.${outcome}` : 'admin.nm.done.noop') as AppKey;
  return (
    <div className="adm-field" data-testid="adm-nm-done">
      <p className="adm-verdict" role="status">{t(key, { id: machine, client: a.client_id || `minilore-link-${machine}`, reason: a.reason ?? '' })}</p>
      <p className="adm-sub">
        <span className="adm-mono">outcome = {a.outcome ?? '—'} · owner_linked = {String(a.owner_linked)}</span>
        {a.owner_linked && <span className="adm-dim">{t('admin.nm.done.check')}</span>}
      </p>
      <p className="adm-sub"><a href={machinePassportHref(machine)} data-testid="adm-nm-open">{t('admin.nm.openPassport')}</a></p>
    </div>
  );
}
