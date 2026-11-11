// UC-5 «завести проект как у похожего» (SPRINT_UXR_S7B_ADMIN/S7B-18). Прототип —
// docs/prototypes/s7b-admin-v6.html, раздел UC-5.
//
// Шаги (kit Steps):
//   1. проект — slug, имя, ветка, репозиторий; регистрация POST /lore/project.
//      Уже зарегистрированный slug не шлётся повторно: upsert перезаписал бы поля;
//   2. репозиторий — проверка мостом Forgejo (/lore/forgejo/ci). «Не смогли
//      проверить» ≠ «нет»; ссылка на Forgejo есть всегда; вперёд можно — права в
//      LORE выдаются и до появления репозитория;
//   3. как у похожего — люди и роли выбранного проекта (role_matrix) галочками,
//      роль можно сменить; непроверенная роль не копируется;
//   4. выдача — пачка на человека через DangerBatch (DiffPreview + BatchUndo):
//      дифф dry_run → слово → применить → окно отмены; затем следующий. Итог —
//      по каждому, частичный отказ назван, пачка — ссылкой в журнал;
//   5. итог и «осталось руками» — доступ к репозиторию в Forgejo LORE не выдаёт.
import { useEffect, useMemo, useState } from 'react';
import {
  LoadError, Skeleton, Steps, useKitLang, useLoadState, useUrlParam, type StepDef, type StepsManualItem,
} from '@seidr/kit';
import { useAppT } from '../i18n';
import { useAdminNav } from './adminNav';
import { DangerBatch } from './DangerBatch';
import { fetchRoleMatrix, PROJECT_ROLES, type RolesData } from './roles';
import { reasonOf } from './wizards';
import {
  batchVerdict, checkRepo, fetchGitProjects, FORGEJO_BASE, likeProjectBatches, projectPeople, registerProject,
  repoProblem, slugProblem, type BatchOutcome, type GitProject, type Registered, type RepoCheck,
} from './projectLike';

const STEP_KEY = 'adm-step';

export function ProjectLikeWizard({ fetchImpl, onDone }: { fetchImpl: typeof fetch; onDone: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const nav = useAdminNav();
  const [step] = useUrlParam(STEP_KEY);
  const [slugP, setSlug] = useUrlParam('adm-pslug');
  const [nameP, setName] = useUrlParam('adm-pname');
  const [branchP, setBranch] = useUrlParam('adm-pbranch');
  const [repoP, setRepo] = useUrlParam('adm-prepo');
  const [src, setSrc] = useUrlParam('adm-psrc');
  const projects = useLoadState<GitProject[]>(() => fetchGitProjects(fetchImpl), [fetchImpl]);
  const matrix = useLoadState<RolesData>(signal => fetchRoleMatrix(signal, fetchImpl), [fetchImpl], { rows: d => d.people });

  const slug = (slugP ?? '').trim();
  const branch = (branchP ?? '').trim() || 'develop';
  // Репозиторий по умолчанию — сам slug, если он вида владелец/имя (так у большинства проектов).
  const existing = projects.data?.find(p => p.slug === slug) ?? null;
  const repo = existing ? (existing.repo ?? '') : (repoP ?? '').trim() || (repoProblem(slug) === null ? slug : '');
  const repoUrl = repoProblem(repo) === null ? `${FORGEJO_BASE}/${repo}` : FORGEJO_BASE;

  // ── 1. проект ──────────────────────────────────────────────────────────
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<(Registered & { slug: string }) | null>(null);
  const exists = existing !== null;
  const isRegistered = !!slug && ((registered?.slug === slug) || exists);
  const sp = slugProblem(slug);
  const rp = repoProblem(repo);

  const register = async () => {
    if (sp || rp || exists) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const r = await registerProject({ slug, name: nameP ?? '', repo, branch }, fetchImpl);
      setRegistered({ ...r, slug });
    } catch (e) {
      setRegisterError(reasonOf(e));
    } finally {
      setRegistering(false);
    }
  };

  const projectBlocked = sp === 'empty' ? t('admin.wiz.project.b.slugEmpty')
    : sp === 'chars' ? t('admin.wiz.project.b.slugChars')
      : isRegistered ? null
        : projects.data === undefined ? t('admin.wiz.project.b.projectsUnknown')
          : t('admin.wiz.project.b.register');

  const projectStep = (
    <div className="adm-field">
      <label className="adm-field">
        <span>{t('admin.wiz.project.slug')}</span>
        <input className="adm-input" data-testid="adm-wiz-pslug" value={slugP ?? ''} placeholder="AIDA/new-service"
          disabled={registered?.slug === slug && !!slug} onChange={e => setSlug(e.target.value || null)} />
        <span className="adm-hint">{t('admin.wiz.project.slugHint')}</span>
      </label>
      {projects.data === undefined && projects.state === 'loading' && <Skeleton lines={1} label={t('admin.wiz.loading')} />}
      {projects.data === undefined && projects.state !== 'loading' && <LoadError error={projects.error} onRetry={projects.reload} />}
      {exists && (
        <p className="adm-note" data-tone="inf" role="status" data-testid="adm-wiz-pexists">
          {t('admin.wiz.project.exists', { slug })}
        </p>
      )}
      {!exists && (
        <>
          <label className="adm-field">
            <span>{t('admin.wiz.project.name')}</span>
            <input className="adm-input" data-testid="adm-wiz-pname" value={nameP ?? ''} placeholder="new-service"
              onChange={e => setName(e.target.value || null)} />
          </label>
          <label className="adm-field">
            <span>{t('admin.wiz.project.branch')}</span>
            <input className="adm-input" data-testid="adm-wiz-pbranch" value={branchP ?? ''} placeholder="develop"
              onChange={e => setBranch(e.target.value || null)} />
          </label>
          <label className="adm-field">
            <span>{t('admin.wiz.project.repo')}</span>
            <input className="adm-input" data-testid="adm-wiz-prepo" value={repoP ?? ''} placeholder={repo || 'AIDA/new-service'}
              onChange={e => setRepo(e.target.value || null)} />
            <span className="adm-hint">{rp === 'shape' ? t('admin.wiz.project.b.repoShape') : t('admin.wiz.project.repoHint', { url: repoUrl })}</span>
          </label>
          {registered?.slug !== slug && (
            <div className="adm-field--btns">
              <button type="button" className="adm-btn" data-testid="adm-wiz-register"
                disabled={registering || !!sp || !!rp || projects.data === undefined} onClick={() => { void register(); }}>
                {t('admin.wiz.project.register', { slug: slug || '…' })}
              </button>
            </div>
          )}
        </>
      )}
      {registerError && (
        <p className="adm-err" role="alert" data-testid="adm-wiz-register-error">
          {t('admin.wiz.project.registerError', { reason: registerError })}
        </p>
      )}
      {registered && registered.slug === slug && (
        <div data-testid="adm-wiz-registered" role="status">
          <p className="adm-verdict">{t('admin.wiz.project.registered', { slug, outcome: registered.outcome || '—' })}</p>
          {registered.rolesGranted.length > 0 && (
            <p className="adm-sub">{t('admin.wiz.project.ownerGranted', { who: registered.rolesGranted.join(', ') })}</p>
          )}
          {registered.rolesWarning && <p className="adm-note" data-tone="wrn">{registered.rolesWarning}</p>}
        </div>
      )}
    </div>
  );

  // ── 2. репозиторий ─────────────────────────────────────────────────────
  const [check, setCheck] = useState<{ key: string; res: RepoCheck | null } | null>(null);
  const [checkTick, setCheckTick] = useState(0);
  const checkKey = `${slug}|${branch}|${checkTick}`;
  const repoReached = step === 'repo' || step === 'people' || step === 'apply' || step === 'done';
  useEffect(() => {
    if (!repoReached || !isRegistered || check?.key === checkKey) return;
    let alive = true;
    setCheck({ key: checkKey, res: null });
    checkRepo(slug, branch, fetchImpl).then(res => { if (alive) setCheck({ key: checkKey, res }); });
    return () => { alive = false; };
  }, [repoReached, isRegistered, checkKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const repoRes = check?.key === checkKey ? check.res : null;

  const repoStep = (
    <div className="adm-field">
      <p className="adm-lead">{t('admin.wiz.project.repoLead', { slug, branch })}</p>
      {!repoRes && <Skeleton lines={1} label={t('admin.wiz.project.checking')} />}
      {repoRes?.kind === 'found' && (
        <p className="adm-verdict" data-sees="true" role="status" data-testid="adm-wiz-repo-found">
          {t('admin.wiz.project.repoFound', { branch, sha: repoRes.sha.slice(0, 12) })}
        </p>
      )}
      {repoRes?.kind === 'missing' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-wiz-repo-missing">
          {t('admin.wiz.project.repoMissing', { reason: repoRes.reason })}
        </p>
      )}
      {repoRes?.kind === 'unresolvable' && (
        <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-wiz-repo-unresolvable">
          {t('admin.wiz.project.repoUnresolvable', { reason: repoRes.reason })}
        </p>
      )}
      {repoRes?.kind === 'unchecked' && (
        <p className="adm-note" data-tone="dng" role="status" data-testid="adm-wiz-repo-unchecked">
          {t('admin.wiz.project.repoUnchecked', { reason: repoRes.reason })}
        </p>
      )}
      <p className="adm-sub">
        <a className="adm-link" href={repoUrl} target="_blank" rel="noreferrer" data-testid="adm-wiz-repo-link">{repoUrl}</a>
        {' '}
        <button type="button" className="adm-btn" data-testid="adm-wiz-repo-recheck" disabled={!repoRes}
          onClick={() => setCheckTick(n => n + 1)}>{t('admin.wiz.project.recheck')}</button>
      </p>
    </div>
  );

  // ── 3. как у похожего ──────────────────────────────────────────────────
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [override, setOverride] = useState<Record<string, string>>({});
  const batches = useMemo(
    () => (matrix.data && src ? likeProjectBatches(matrix.data, src, slug, excluded, override) : []),
    [matrix.data, src, slug, excluded, override],
  );
  const batchesKey = JSON.stringify(batches);
  const toggle = (sub: string) => setExcluded(prev => {
    const next = new Set(prev);
    if (next.has(sub)) next.delete(sub); else next.add(sub);
    return next;
  });
  const people = matrix.data && src ? projectPeople(matrix.data, src) : [];

  const peopleStep = matrix.data === undefined
    ? (matrix.state === 'loading' ? <Skeleton lines={2} label={t('admin.wiz.loading')} /> : <LoadError error={matrix.error} onRetry={matrix.reload} />)
    : (
      <div className="adm-field">
        <label className="adm-field">
          <span>{t('admin.wiz.project.like')}</span>
          <select className="adm-select" data-testid="adm-wiz-psrc" value={src ?? ''}
            onChange={e => { setSrc(e.target.value || null); setExcluded(new Set()); setOverride({}); }}>
            <option value="">{t('admin.wiz.pickOne')}</option>
            {matrix.data.projects.filter(p => p !== slug).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {src && people.length === 0 && <p className="adm-note" role="status" data-testid="adm-wiz-pnobody">{t('admin.wiz.project.nobody', { project: src })}</p>}
        {people.length > 0 && (
          <ul className="adm-plist" data-testid="adm-wiz-ppeople">
            {people.map(p => {
              const ok = p.state === 'checked';
              return (
                <li key={p.kc_sub} className="adm-sub">
                  <label>
                    <input type="checkbox" data-testid={`adm-wiz-pperson-${p.kc_sub}`} disabled={!ok}
                      checked={ok && !excluded.has(p.kc_sub)} onChange={() => toggle(p.kc_sub)} />
                    {' '}{p.name}
                  </label>
                  <select className="adm-select" data-testid={`adm-wiz-prole-${p.kc_sub}`} disabled={!ok}
                    aria-label={t('admin.wiz.project.roleOf', { name: p.name })}
                    value={override[p.kc_sub] ?? p.role}
                    onChange={e => setOverride(o => ({ ...o, [p.kc_sub]: e.target.value }))}>
                    {[...new Set([p.role, ...PROJECT_ROLES])].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {!ok && <span className="adm-missing">{t('admin.wiz.person.unverified')}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="adm-hint">{t('admin.wiz.project.likeHint', { slug })}</p>
      </div>
    );

  // ── 4. выдача пачками по людям ─────────────────────────────────────────
  const [applyReached, setApplyReached] = useState(false);
  if (!applyReached && step === 'apply') setApplyReached(true);
  const [run, setRun] = useState<{ key: string; closed: ReadonlySet<string>; outcomes: Record<string, BatchOutcome> }>(
    { key: '', closed: new Set(), outcomes: {} },
  );
  // Другой набор пачек — другой прогон: итог прежнего к нему не относится.
  const cur = run.key === batchesKey ? run : { key: batchesKey, closed: new Set<string>(), outcomes: {} };
  const update = (fn: (r: typeof cur) => typeof cur) => setRun(r => fn(r.key === batchesKey ? r : cur));
  const order = batches.map(b => b.kc_sub);
  const nameOf = (sub: string) => matrix.data?.people.find(p => p.kc_sub === sub)?.name ?? sub;
  const active = batches.find(b => !cur.closed.has(b.kc_sub)) ?? null;
  const verdict = batchVerdict(order, cur.outcomes);
  const waiting = order.filter(s => !cur.closed.has(s));

  const outcomeText = (sub: string): string => {
    const o = cur.outcomes[sub];
    if (!o) return cur.closed.has(sub) ? t('admin.wiz.project.out.skipped') : t('admin.wiz.project.out.pending');
    if (o.kind === 'skipped') return t('admin.wiz.project.out.skipped');
    if (o.kind === 'undone') return t('admin.wiz.project.out.undone');
    const base = t('admin.wiz.project.out.applied', { applied: o.applied, total: o.total });
    return o.failed.length ? `${base} · ${o.failed.map(f => f.reason || f.text).join('; ')}` : base;
  };

  // Итог рисуется и на шаге выдачи, и на шаге «Итог»; отметки тестов — только у первого.
  const summary = (at: 'apply' | 'done') => order.length > 0 && (
    <div className="adm-field">
      <ul className="adm-plist" data-testid={at === 'apply' ? 'adm-wiz-pbatch-list' : undefined}>
        {order.map(sub => {
          const o = cur.outcomes[sub];
          const batchId = o && o.kind !== 'skipped' ? o.batchId : '';
          return (
            <li key={sub} className="adm-sub" data-testid={at === 'apply' ? `adm-wiz-pout-${sub}` : undefined}>
              <b>{nameOf(sub)}</b>{' — '}{outcomeText(sub)}
              {batchId && (
                <>
                  {' '}
                  <button type="button" className="adm-link" onClick={() => nav.go('log', { 'adm-batch': batchId })}>
                    {t('admin.roles.danger.journal')}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {waiting.length === 0 && (
        <p className="adm-verdict" role="status" data-testid={at === 'apply' ? 'adm-wiz-pbatch-summary' : 'adm-wiz-pbatch-final'}>
          {verdict.partial.length > 0
            ? t('admin.wiz.project.verdict.partial', { n: verdict.applied.length, total: order.length, who: verdict.partial.map(nameOf).join(', ') })
            : verdict.applied.length === order.length
              ? t('admin.wiz.project.verdict.all', { n: order.length })
              : t('admin.wiz.project.verdict.some', { n: verdict.applied.length, total: order.length })}
        </p>
      )}
    </div>
  );

  const applyStep = !applyReached || batches.length === 0
    ? <p className="adm-dim">{t('admin.wiz.project.applyLead')}</p>
    : (
      <div className="adm-field">
        <p className="adm-lead">{t('admin.wiz.project.applyLead')}</p>
        {active && (
          <>
            {waiting.length > 1 && (
              <p className="adm-note" data-tone="inf" role="status">{t('admin.wiz.project.queue', { n: waiting.length - 1 })}</p>
            )}
            <DangerBatch
              key={`${batchesKey}|${active.kc_sub}`}
              person={{ kc_sub: active.kc_sub, name: nameOf(active.kc_sub) }}
              changes={active.changes}
              fetchImpl={fetchImpl}
              onAnswer={a => update(r => ({
                ...r,
                outcomes: { ...r.outcomes, [active.kc_sub]: { kind: 'applied', applied: a.batch.applied, total: a.batch.total, failed: [...(a.batch.failed ?? [])], batchId: a.batch.id } },
              }))}
              onChanged={what => {
                if (what === 'undone') {
                  update(r => {
                    const prev = r.outcomes[active.kc_sub];
                    return { ...r, outcomes: { ...r.outcomes, [active.kc_sub]: { kind: 'undone', batchId: prev && prev.kind !== 'skipped' ? prev.batchId : '' } } };
                  });
                }
              }}
              onClose={() => update(r => ({
                ...r,
                closed: new Set([...r.closed, active.kc_sub]),
                outcomes: r.outcomes[active.kc_sub] ? r.outcomes : { ...r.outcomes, [active.kc_sub]: { kind: 'skipped' } },
              }))}
            />
          </>
        )}
        {summary('apply')}
      </div>
    );

  // ── 5. итог ────────────────────────────────────────────────────────────
  const doneStep = (
    <div className="adm-field">
      {summary('done') || <p className="adm-dim">{t('admin.wiz.project.applyLead')}</p>}
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" data-testid="adm-wiz-popen-who" onClick={() => nav.go('who', {})}>
          {t('admin.wiz.person.openWho')}
        </button>
      </div>
    </div>
  );

  const steps: StepDef[] = [
    { key: 'project', title: t('admin.wiz.project.s.project'), blocked: projectBlocked, render: () => projectStep },
    { key: 'repo', title: t('admin.wiz.project.s.repo'), render: () => repoStep },
    { key: 'people', title: t('admin.wiz.project.s.people'), blocked: batches.length ? null : t('admin.wiz.project.b.people'), render: () => peopleStep },
    {
      key: 'apply', title: t('admin.wiz.project.s.apply'),
      blocked: waiting.length ? t('admin.wiz.project.b.apply', { n: waiting.length }) : null,
      render: () => applyStep,
    },
    { key: 'done', title: t('admin.wiz.project.s.done'), render: () => doneStep },
  ];
  const manual: StepsManualItem[] = [
    { text: t('admin.wiz.project.manual.access'), href: repoProblem(repo) === null ? `${repoUrl}/settings/collaboration` : FORGEJO_BASE, hint: t('admin.wiz.project.manual.accessHint') },
    ...(repoRes?.kind === 'found' ? [] : [{ text: t('admin.wiz.project.manual.create'), href: `${FORGEJO_BASE}/repo/create`, hint: t('admin.wiz.project.manual.createHint') }]),
  ];
  return <Steps steps={steps} urlKey={STEP_KEY} lang={lang} flow="adm-project" onDone={onDone} manual={{ title: t('admin.wiz.manual.title'), items: manual }} />;
}
