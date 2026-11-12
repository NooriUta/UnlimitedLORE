// Опасные действия Keycloak (SPRINT_UXR_S7B_ADMIN/S7B-03): выдача realm-роли
// человеку и ротация секрета агента — тем же путём, что правка ролей проектов
// (DangerBatch):
//   1. дифф с сервера (dry_run) — сервер сам читает текущее состояние KC;
//   2. ввод подтверждения — логин человека / clientId агента (kit DiffPreview confirm);
//   3. применение;
//   4. «Отменить»: у realm-роли — обратный вызов в окне (kit BatchUndo, undo_of);
//      у ротации — НЕЛЬЗЯ, и это сказано до применения и после: LORE прежний
//      секрет не хранит;
//   5. запись в журнале AO-01 — ссылка на журнал с отбором по семейству kc.
// Секрет — только в kit SecretOnce (за предупреждением), не в адресе и не в хранилище;
// на машину агента — только переменной окружения LORE_MCP_CLIENT_SECRET.
//
// S7B-19 (UC-6, без простоя): если у клиента в Keycloak есть политика ротации,
// прежний секрет остаётся рядом с новым до срока. Это сказано ДО применения
// (old_secret: kept | unknown), после — OldSecretSwitch: «перешёл?» (сессия
// агента, начатая после ротации) и «Отозвать прежний» только после перехода.
import { useEffect, useState } from 'react';
import {
  BatchUndo, DiffPreview, Forbidden, LoadError, SecretOnce, Skeleton, useKitLang, useUrlParam,
  type DiffRow,
} from '@seidr/kit';
import { useAppT } from '../i18n';
import { useAdminNav } from './adminNav';
import { LoreHttpError } from '../api/loreSlice';
import {
  fetchRealmRoles, fetchSecretState, parseRealmApply, parseRealmPlan, parseRevokePlan, parseRotation, parseRotationPlan,
  postRealmRole, postRevokeOld, postRotate,
  type RealmAction, type RealmApply, type RealmRoleOption, type Rotation, type RotationPlan, type SecretState,
} from './kc';

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e);

/** Отказ на чтении/диффе — разными словами: нет права · KC не подключён · запрос не принят · сбой. */
type Fail = { kind: 'forbidden' | 'unavailable' | 'bad'; reason: string } | { kind: 'error'; error: unknown };

function failOf(e: unknown): Fail {
  if (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)) return { kind: 'forbidden', reason: reasonOf(e) };
  if (e instanceof LoreHttpError && e.status === 503) return { kind: 'unavailable', reason: reasonOf(e) };
  if (e instanceof LoreHttpError && e.status >= 400 && e.status < 500) return { kind: 'bad', reason: reasonOf(e) };
  return { kind: 'error', error: e };
}

function FailView({ fail, onRetry }: { fail: Fail; onRetry: () => void }) {
  const t = useAppT();
  if (fail.kind === 'forbidden') {
    return (
      <div data-testid="adm-kc-forbidden">
        <Forbidden title={t('admin.kc.forbidden')} hint={t('admin.roles.forbiddenHint')} reason={fail.reason} />
      </div>
    );
  }
  if (fail.kind === 'unavailable') {
    return <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-kc-unavailable">{t('admin.kc.unavailable', { reason: fail.reason })}</p>;
  }
  if (fail.kind === 'bad') {
    return <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-kc-bad">{t('admin.kc.bad', { reason: fail.reason })}</p>;
  }
  return <LoadError error={'error' in fail ? fail.error : null} onRetry={onRetry} />;
}

function JournalLink({ id }: { id: string | null }) {
  const t = useAppT();
  const nav = useAdminNav();
  return (
    <p className="adm-sub">
      {t('admin.kc.logged')}{' '}
      <button type="button" className="adm-link" data-testid="adm-kc-journal"
        onClick={() => nav.go('log', { 'adm-family': 'kc' })}>{t('admin.roles.danger.journal')}</button>
      {id && <span className="adm-mono"> {id}</span>}
    </p>
  );
}

// ── realm-роль ────────────────────────────────────────────────────────────

export interface RealmRoleDangerProps {
  person: { kc_sub: string; name: string };
  role: string;
  action: RealmAction;
  fetchImpl?: typeof fetch;
  onClose: () => void;
  onChanged?: () => void;
}

export function RealmRoleDanger({ person, role, action, fetchImpl, onClose, onChanged }: RealmRoleDangerProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [plan, setPlan] = useState<{ rows: DiffRow[] } | Fail | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<RealmApply | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setAnswer(null);
    setApplyError(null);
    setUndone(false);
    setUndoError(null);
    postRealmRole(person.kc_sub, { role, action, dry_run: true }, fetchImpl).then(
      body => { if (alive) setPlan({ rows: parseRealmPlan(body) }); },
      (e: unknown) => { if (alive) setPlan(failOf(e)); },
    );
    return () => { alive = false; };
  }, [person.kc_sub, role, action, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    postRealmRole(person.kc_sub, { role, action }, fetchImpl).then(
      body => { setAnswer(parseRealmApply(body)); setApplying(false); onChanged?.(); },
      (e: unknown) => { setApplyError(reasonOf(e)); setApplying(false); },
    );
  };

  const undo = (id: string) => {
    if (!answer?.undo || undoing) return;
    setUndoing(true);
    setUndoError(null);
    postRealmRole(person.kc_sub, { ...answer.undo, undo_of: id }, fetchImpl).then(
      () => { setUndone(true); setUndoing(false); onChanged?.(); },
      (e: unknown) => { setUndoError(t('admin.roles.undoFailed', { reason: reasonOf(e) })); setUndoing(false); },
    );
  };

  return (
    <section className="adm-danger" aria-labelledby="adm-realm-danger-h" data-testid="adm-realm-danger">
      <h3 id="adm-realm-danger-h" className="adm-danger__h">
        {t(action === 'add' ? 'admin.kc.realm.titleAdd' : 'admin.kc.realm.titleRemove', { role, name: person.name })}
      </h3>
      {plan === null && <Skeleton lines={2} label={t('admin.roles.danger.loading')} />}
      {plan && 'kind' in plan && <FailView fail={plan} onRetry={() => setAttempt(a => a + 1)} />}
      {plan && 'rows' in plan && !answer && (
        <>
          <DiffPreview rows={plan.rows} onApply={apply} busy={applying} label={t('admin.roles.danger.diff')} lang={lang}
            confirm={{ word: person.name, label: t('admin.roles.danger.confirm', { name: person.name }) }} />
          {applyError && (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-kc-applyerror">
              {t('admin.roles.danger.applyError', { reason: applyError })}
            </p>
          )}
        </>
      )}
      {answer && (
        <>
          <BatchUndo batch={answer.batch} onUndo={undo} undoing={undoing} undone={undone} undoError={undoError} lang={lang} />
          <JournalLink id={answer.batch.id || null} />
        </>
      )}
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-realm-close" onClick={onClose}>
          {answer ? t('admin.roles.danger.done') : t('admin.roles.danger.cancel')}
        </button>
      </div>
    </section>
  );
}

/**
 * Realm-роль человека (Keycloak) в карточке «Ролей»: какие роли есть — из KC
 * (super-admin мост не выдаёт, D11), выбор роли — в адресе (adm-realm).
 */
export function RealmRolePanel({ person, fetchImpl, onChanged }: {
  person: { kc_sub: string; name: string };
  fetchImpl?: typeof fetch;
  onChanged?: () => void;
}) {
  const t = useAppT();
  const [roles, setRoles] = useState<RealmRoleOption[] | Fail | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useUrlParam('adm-realm');
  const [pending, setPending] = useState<RealmAction | null>(null);

  useEffect(() => {
    let alive = true;
    setRoles(null);
    fetchRealmRoles(fetchImpl).then(
      r => { if (alive) setRoles(r); },
      (e: unknown) => { if (alive) setRoles(failOf(e)); },
    );
    return () => { alive = false; };
  }, [fetchImpl, attempt]);

  let body;
  if (roles === null) body = <Skeleton lines={1} label={t('admin.kc.realm.loading')} />;
  else if (!Array.isArray(roles)) body = <FailView fail={roles} onRetry={() => setAttempt(a => a + 1)} />;
  else {
    const grantable = roles.filter(r => r.grantable);
    const role = picked && grantable.some(r => r.name === picked) ? picked : null;
    body = (
      <>
        <div className="adm-filters">
          <label className="adm-field">
            <span className="adm-field__l">{t('admin.kc.realm.pick')}</span>
            <select className="adm-select" data-testid="adm-realm-pick" value={role ?? ''}
              onChange={e => { setPending(null); setPicked(e.target.value || null); }}>
              <option value="">{t('admin.kc.realm.none')}</option>
              {grantable.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <button type="button" className="adm-btn" data-testid="adm-realm-grant" disabled={!role}
            onClick={() => setPending('add')}>{t('admin.kc.realm.grant')}</button>
          <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-realm-remove" disabled={!role}
            onClick={() => setPending('remove')}>{t('admin.kc.realm.remove')}</button>
        </div>
        {picked && !role && (
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-realm-unknown">{t('admin.kc.realm.unknown', { role: picked })}</p>
        )}
        <p className="adm-hint">{t('admin.kc.realm.hint')}</p>
        {role && pending && (
          <RealmRoleDanger person={person} role={role} action={pending} fetchImpl={fetchImpl}
            onClose={() => setPending(null)} onChanged={onChanged} />
        )}
      </>
    );
  }
  return (
    <div className="adm-card" role="group" aria-label={t('admin.kc.realm.title')} data-testid="adm-realm">
      <span className="adm-field__l">{t('admin.kc.realm.title')}</span>
      {body}
    </div>
  );
}

// ── ротация секрета агента ────────────────────────────────────────────────

export interface RotateDangerProps {
  clientId: string;
  fetchImpl?: typeof fetch;
  onClose: () => void;
}

export function RotateDanger({ clientId, fetchImpl, onClose }: RotateDangerProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [plan, setPlan] = useState<RotationPlan | Fail | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [done, setDone] = useState<Rotation | null>(null);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setDone(null);
    setApplyError(null);
    postRotate(clientId, true, fetchImpl).then(
      body => { if (alive) setPlan(parseRotationPlan(body)); },
      (e: unknown) => { if (alive) setPlan(failOf(e)); },
    );
    return () => { alive = false; };
  }, [clientId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    postRotate(clientId, false, fetchImpl).then(
      body => { setDone(parseRotation(body)); setApplying(false); },
      // Текст ошибки — от сервера; секрета в нём нет: при отказе его и не выпускали.
      (e: unknown) => { setApplyError(reasonOf(e)); setApplying(false); },
    );
  };

  const reason = plan && 'rows' in plan ? plan.undoReason : done?.undoReason ?? null;

  return (
    <section className="adm-danger" aria-labelledby="adm-rotate-h" data-testid="adm-rotate-danger">
      <h3 id="adm-rotate-h" className="adm-danger__h">{t('admin.kc.rotate.title', { client: clientId })}</h3>
      {plan === null && <Skeleton lines={2} label={t('admin.roles.danger.loading')} />}
      {plan && 'kind' in plan && <FailView fail={plan} onRetry={() => setAttempt(a => a + 1)} />}
      {plan && 'rows' in plan && !done && (
        <>
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-rotate-noundo">
            {t('admin.kc.rotate.noUndo')}{reason && <span className="adm-dim"> {reason}</span>}
          </p>
          {/* S7B-19: будет ли простой — сказано ДО ввода подтверждения. */}
          {plan.oldSecret && (
            <p className="adm-note" data-tone={plan.oldSecret === 'kept' ? undefined : 'dng'} role="status"
              data-testid="adm-rotate-expect" data-expect={plan.oldSecret}>
              {t(plan.oldSecret === 'kept' ? 'admin.kc.rotate.expectKept' : 'admin.kc.rotate.expectDowntime')}
            </p>
          )}
          <DiffPreview rows={plan.rows} onApply={apply} busy={applying} label={t('admin.roles.danger.diff')} lang={lang}
            confirm={{ word: clientId, label: t('admin.kc.rotate.confirm', { client: clientId }) }} />
          {applyError && (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-kc-applyerror">
              {t('admin.roles.danger.applyError', { reason: applyError })}
            </p>
          )}
        </>
      )}
      {done && (
        <>
          {done.secret
            ? <SecretOnce value={done.secret} label={t('admin.kc.rotate.secretLabel', { client: clientId })} lang={lang} />
            : <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-rotate-nosecret">{t('admin.kc.rotate.noSecret')}</p>}
          {/* S7B-19: секрет — только в переменную окружения; в команде и файле — ссылка на неё. */}
          <p className="adm-note" role="status" data-testid="adm-rotate-env">
            {t('admin.kc.rotate.env')}
          </p>
          <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-rotate-done-noundo">{t('admin.kc.rotate.doneNoUndo')}</p>
          {done.oldSecretKept === true && <OldSecretSwitch clientId={clientId} fetchImpl={fetchImpl} />}
          {done.oldSecretKept === false && (
            <p className="adm-note" data-tone="dng" role="status" data-testid="adm-rotate-olddead">
              {done.oldSecretNote ?? t('admin.kc.rotate.oldDead')}
            </p>
          )}
          {done.oldSecretKept === null && (
            <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-rotate-oldunknown">
              {done.oldSecretNote ?? t('admin.kc.rotate.oldUnknown')}
            </p>
          )}
          <JournalLink id={done.clientId} />
        </>
      )}
      <div className="adm-field--btns adm-danger__btns">
        <button type="button" className="adm-btn" data-testid="adm-rotate-close" onClick={onClose}>
          {done ? t('admin.roles.danger.done') : t('admin.roles.danger.cancel')}
        </button>
      </div>
    </section>
  );
}

// ── два секрета: «перешёл?» и отзыв прежнего (S7B-19, UC-6) ──────────────

/** Как часто перепроверять «перешёл?», пока панель открыта. */
const SWITCH_POLL_MS = 15_000;

/**
 * Прежний секрет рядом с новым: до какого срока он действует, перешёл ли агент
 * (сессия, начатая после ротации), и «Отозвать прежний» — только после
 * перехода; до него кнопка заблокирована с причиной, а сервер отвечает 409.
 * Значений секретов здесь нет — только время и факт.
 */
export function OldSecretSwitch({ clientId, fetchImpl }: { clientId: string; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lang = useKitLang();
  const [state, setState] = useState<SecretState | Fail | null>(null);
  const [tick, setTick] = useState(0);
  const [revoke, setRevoke] = useState<DiffRow[] | Fail | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSecretState(clientId, fetchImpl).then(
      s => { if (alive) setState(s); },
      (e: unknown) => { if (alive) setState(failOf(e)); },
    );
    return () => { alive = false; };
  }, [clientId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = state && 'switched' in state ? state : null;
  const waiting = s !== null && s.oldSecretActive === true && !s.switched.seen && !revoked;
  useEffect(() => {
    if (!waiting) return undefined;
    const id = window.setInterval(() => setTick(n => n + 1), SWITCH_POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting]);

  const openRevoke = () => {
    if (!s?.switched.seen) return;
    setRevoke(null);
    setRevokeError(null);
    postRevokeOld(clientId, true, fetchImpl).then(
      body => setRevoke(parseRevokePlan(body)),
      (e: unknown) => setRevoke(failOf(e)),
    );
  };
  const applyRevoke = () => {
    if (revoking) return;
    setRevoking(true);
    setRevokeError(null);
    postRevokeOld(clientId, false, fetchImpl).then(
      () => { setRevoked(true); setRevoking(false); setRevoke(null); setTick(n => n + 1); },
      (e: unknown) => { setRevokeError(reasonOf(e)); setRevoking(false); },
    );
  };

  return (
    <div className="adm-card" data-testid="adm-oldsecret">
      <span className="adm-field__l">{t('admin.kc.old.title')}</span>
      {state === null && <Skeleton lines={2} label={t('admin.roles.danger.loading')} />}
      {state && 'kind' in state && <FailView fail={state} onRetry={() => setTick(n => n + 1)} />}
      {s && revoked && <p className="adm-note" role="status" data-testid="adm-oldsecret-revoked">{t('admin.kc.old.revoked')}</p>}
      {s && !revoked && s.oldSecretActive !== true && (
        <p className="adm-sub" data-testid="adm-oldsecret-none">{t('admin.kc.old.none')}</p>
      )}
      {s && !revoked && s.oldSecretActive === true && (
        <>
          <p className="adm-sub" data-testid="adm-oldsecret-expires">
            {t('admin.kc.old.expires', { at: s.oldSecretExpiresAt ?? t('admin.kc.old.noExpiry') })}
          </p>
          <p className="adm-note" data-tone={s.switched.seen ? undefined : 'wrn'} role="status"
            data-testid="adm-oldsecret-switched" data-seen={String(s.switched.seen)}>
            {s.switched.seen
              ? t('admin.kc.old.switched', { at: s.switched.at ?? '—', machine: s.switched.machine ?? '—' })
              : t('admin.kc.old.waiting', { reason: s.switched.reason ?? '' })}
          </p>
          <p className="adm-dim">{t('admin.kc.old.signal')}</p>
          {revoke === null || !Array.isArray(revoke) ? (
            <div className="adm-filters">
              <button type="button" className="adm-btn" data-testid="adm-oldsecret-recheck" onClick={() => setTick(n => n + 1)}>
                {t('admin.kc.old.recheck')}
              </button>
              <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-oldsecret-revoke"
                disabled={!s.switched.seen} onClick={openRevoke}>
                {t('admin.kc.old.revoke')}
              </button>
            </div>
          ) : (
            <DiffPreview rows={revoke} onApply={applyRevoke} busy={revoking} label={t('admin.kc.old.revokeDiff')} lang={lang}
              confirm={{ word: clientId, label: t('admin.kc.rotate.confirm', { client: clientId }) }} />
          )}
          {revoke && !Array.isArray(revoke) && <FailView fail={revoke} onRetry={openRevoke} />}
          {revokeError && <p className="adm-note" data-tone="dng" role="alert">{t('admin.roles.danger.applyError', { reason: revokeError })}</p>}
        </>
      )}
    </div>
  );
}

/** Кнопка «Ротировать секрет» в карточке агента: без clientId ротировать нечего — сказано словами. */
export function RotatePanel({ clientId, fetchImpl }: { clientId: string | null; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const [oldOpen, setOldOpen] = useState(false);
  if (!clientId) {
    return <p className="adm-note" data-tone="wrn" role="status" data-testid="adm-rotate-noclient">{t('admin.kc.rotate.noClient')}</p>;
  }
  return (
    <div className="adm-filters" role="group" aria-label={t('admin.kc.rotate.button')}>
      {!open && (
        <button type="button" className="adm-btn adm-btn--dng" data-testid="adm-rotate-open" onClick={() => setOpen(true)}>
          {t('admin.kc.rotate.button')}
        </button>
      )}
      {!open && (
        <button type="button" className="adm-btn" data-testid="adm-oldsecret-open" onClick={() => setOldOpen(v => !v)}>
          {t('admin.kc.old.open')}
        </button>
      )}
      {open && <RotateDanger clientId={clientId} fetchImpl={fetchImpl} onClose={() => setOpen(false)} />}
      {!open && oldOpen && <OldSecretSwitch clientId={clientId} fetchImpl={fetchImpl} />}
    </div>
  );
}
