// «Привести в порядок» — раздел админки (SPRINT_UXR_POLISH_UAT_1113/PU-20).
// Прототип docs/prototypes/pu20-tidy-links.html одобрен владелицей 13.11.2026.
//
// Слова владелицы, по которым собран экран:
//   • «если нет [однозначного прочтения] то в админке сделать раздел привести в порядок с указанием
//     списка типа ошибки и переходом (Если в одном тексте несколько то ссылка одна) но счетчик
//     проверок уменьшается и возможность сделать речек» — группы по виду ошибки, строка = запись,
//     «Перепроверить» у строки и для всего корпуса;
//   • «внешние ссылки MD должно не быть багом и не быть лишним шумом» — их здесь нет вовсе;
//   • «на проде все делается бэком с подтверждением через ui и логином человека» — пачку считает
//     и пишет сервер; окно — kit DiffPreview с вводом своего логина, отмена — kit BatchUndo (15 минут).
//   • Допущения 13.11: «не ссылка» — объект в БД; применяет суперадмин-человек; все 8 типов сразу.
// Элементы — Seiðr kit (просьба владелицы): Pill, EmptyState, LoadError, Forbidden, Skeleton,
// DiffPreview, BatchUndo, GameIcon.
import { useEffect, useMemo, useState } from 'react';
import {
  BatchUndo, DiffPreview, EmptyState, Forbidden, GameIcon, LoadError, Pill, Skeleton,
  useKitLang, useLoadState, useUrlParam, type DiffRow,
} from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { LoreHttpError } from '../api/loreSlice';
import {
  DISMISSABLE, TIDY_KINDS, TIDY_RULES, applyBatch, defaultRules, dismissKind, fetchTidy, loreTypeOf, planApply, planFor,
  recheckAll, recheckRecord, rowsOfKind, undoBatch,
  type TidyApplyAnswer, type TidyCheck, type TidyPlan, type TidyRow,
} from './tidy';
import './Admin.css';

export interface TidyScreenProps {
  fetchImpl?: typeof fetch;
}

/** Строк группы на экране сразу; дальше — «показать ещё». */
export const TIDY_PAGE = 50;

const reasonOf = (e: unknown) =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : undefined;
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function TidyScreen({ fetchImpl }: TidyScreenProps) {
  const t = useAppT();
  const res = useLoadState<TidyCheck>(signal => fetchTidy({ signal, fetchImpl }), [fetchImpl]);
  const [fresh, setFresh] = useState<TidyCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const data = fresh ?? res.data ?? null;

  const recheck = async () => {
    setBusy(true);
    setRecheckError(null);
    try { setFresh(await recheckAll({ fetchImpl })); }
    catch (e) { setRecheckError(reasonOf(e) ?? 'error'); }
    finally { setBusy(false); }
  };

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={6} label={t('admin.tidy.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={reasonOf(res.error)} />;
  else if (!data) body = <LoadError title={t('admin.tidy.failed')} error={res.error} onRetry={res.reload} />;
  else body = <TidyBody check={data} onCheck={setFresh} onChanged={recheck} fetchImpl={fetchImpl} />;

  return (
    <section className="adm" aria-labelledby="adm-tidy-h" data-testid="adm-tidy">
      <h2 id="adm-tidy-h" className="adm-h">{t('admin.tidy.title')}</h2>
      <p className="adm-lead">{t('admin.tidy.lead')}</p>
      <div className="adm-tidy-status">
        {data?.checkedAt && <Pill tone="suc">{t('admin.tidy.checkedAt', { at: kitMinute(data.checkedAt)?.text ?? data.checkedAt })}</Pill>}
        {data && <Pill tone="t2">{t('admin.tidy.scanned', { records: fmt(data.scanned.records), fields: fmt(data.scanned.fields) })}</Pill>}
        <Pill tone="t3">{t('admin.tidy.externalNote')}</Pill>
        <button type="button" className="adm-btn" onClick={recheck} disabled={busy} data-testid="adm-tidy-recheck-all">
          <GameIcon slug="cycle" size={12} /> {busy ? t('admin.tidy.rechecking') : t('admin.tidy.recheckAll')}
        </button>
      </div>
      {recheckError && (
        // «Не смогли проверить» — не «всё чисто»: прежний результат остаётся, но помечен устаревшим.
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-tidy-recheck-failed">
          {t('admin.tidy.recheckFailed', { reason: recheckError })}
        </p>
      )}
      {body}
    </section>
  );
}

function TidyBody({ check, onCheck, onChanged, fetchImpl }: {
  check: TidyCheck; onCheck: (c: TidyCheck) => void; onChanged: () => void; fetchImpl?: typeof fetch;
}) {
  const t = useAppT();
  if (check.auto.edits === 0 && check.manual.records === 0 && check.manual.dismissed.length === 0) {
    return <div data-testid="adm-tidy-clean"><EmptyState title={t('admin.tidy.clean')} hint={t('admin.tidy.cleanHint')} /></div>;
  }
  return (
    <>
      {check.auto.edits > 0 && <AutoBlock check={check} onChanged={onChanged} fetchImpl={fetchImpl} />}
      <ManualBlock check={check} onCheck={onCheck} fetchImpl={fetchImpl} />
    </>
  );
}

function AutoBlock({ check, onChanged, fetchImpl }: { check: TidyCheck; onChanged: () => void; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const [enabled, setEnabled] = useState<Set<string>>(() => defaultRules(check));
  const [open, setOpen] = useState(false);
  const plan = useMemo(() => planFor(check, enabled), [check, enabled]);
  const toggle = (k: string) => setEnabled(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  return (
    <div className="adm-card adm-tidy-auto" data-testid="adm-tidy-auto">
      <h3 className="adm-sub">{t('admin.tidy.auto.title')}</h3>
      <p className="adm-tidy-kpi" data-testid="adm-tidy-plan">{t('admin.tidy.auto.plan', { edits: fmt(plan.edits), records: fmt(plan.records) })}</p>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead><tr><th>{t('admin.tidy.auto.rule')}</th><th>{t('admin.tidy.auto.edits')}</th><th>{t('admin.tidy.auto.example')}</th></tr></thead>
          <tbody>
            {TIDY_RULES.filter(k => check.auto.rules[k]).map(k => {
              const r = check.auto.rules[k];
              const s = r.samples[0];
              return (
                <tr key={k} data-rule={k} data-on={enabled.has(k) || undefined}>
                  <td>
                    <label className="adm-tidy-rule">
                      <input type="checkbox" checked={enabled.has(k)} onChange={() => toggle(k)} disabled={open} data-testid={`adm-tidy-rule-${k}`} />
                      {t(`admin.tidy.rule.${k}` as AppKey)}
                    </label>
                    {k === 'lone_unique' && <Pill tone="wrn">{t('admin.tidy.rule.risky')}</Pill>}
                  </td>
                  <td className="adm-tidy-num">{fmt(r.edits)}</td>
                  <td className="adm-tidy-ex">
                    {s ? <><span className="adm-mono adm-dim">{s.id}: </span><del>{s.old}</del> → <ins>{s.new}</ins></> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!open ? (
        <div className="adm-tidy-applybar">
          <span className="adm-dim">{t('admin.tidy.apply.hint')}</span>
          <button type="button" className="adm-btn" data-tone="acc" disabled={plan.edits === 0}
            onClick={() => setOpen(true)} data-testid="adm-tidy-apply-open">
            <GameIcon slug="broom" size={12} /> {t('admin.tidy.apply.open')}
          </button>
        </div>
      ) : (
        <ApplyPanel check={check} rules={[...enabled]} fetchImpl={fetchImpl}
          onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </div>
  );
}

type PlanState =
  | { kind: 'loading' }
  | { kind: 'ok'; plan: TidyPlan }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'bad'; reason: string }
  | { kind: 'error'; error: unknown };

/**
 * Окно применения — тот же путь, что у опасных правок ролей (DangerBatch): сервер считает план
 * (dry_run), строки диффа по правилам с настоящим примером «было → станет», слово подтверждения —
 * свой логин (его называет сервер), пачка одним вызовом, итог по каждому полю, отмена 15 минут.
 */
function ApplyPanel({ check, rules, fetchImpl, onClose, onChanged }: {
  check: TidyCheck; rules: string[]; fetchImpl?: typeof fetch; onClose: () => void; onChanged: () => void;
}) {
  const t = useAppT();
  const lang = useKitLang();
  const [state, setState] = useState<PlanState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<TidyApplyAnswer | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const key = rules.slice().sort().join(',');

  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    planApply(rules, { fetchImpl }).then(
      plan => { if (alive) setState({ kind: 'ok', plan }); },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)) setState({ kind: 'forbidden', reason: reasonOf(e) ?? '' });
        else if (e instanceof LoreHttpError && e.status === 400) setState({ kind: 'bad', reason: reasonOf(e) ?? '' });
        else setState({ kind: 'error', error: e });
      },
    );
    return () => { alive = false; };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: DiffRow[] = useMemo(() => {
    if (state.kind !== 'ok') return [];
    return state.plan.rules.filter(k => (check.auto.rules[k]?.edits ?? 0) > 0).map(k => {
      const r = check.auto.rules[k];
      const s = r.samples[0];
      const base = { id: k, text: t(`admin.tidy.rule.${k}` as AppKey), detail: t('admin.tidy.apply.edits', { n: fmt(r.edits) }), check: { state: 'checked' as const } };
      return s ? { ...base, kind: 'change' as const, from: s.old, to: s.new } : { ...base, kind: 'add' as const };
    });
  }, [state, check, t]);

  const login = state.kind === 'ok' ? state.plan.login : null;

  const apply = (chosen: readonly DiffRow[]) => {
    if (applying || !login) return;
    setApplying(true);
    setApplyError(null);
    applyBatch(chosen.map(r => r.id), login, { fetchImpl }).then(
      a => { setAnswer(a); setApplying(false); onChanged(); },
      (e: unknown) => { setApplyError(reasonOf(e) ?? ''); setApplying(false); },
    );
  };

  const undo = (id: string) => {
    if (!login || undoing) return;
    setUndoing(true);
    setUndoError(null);
    undoBatch(id, login, { fetchImpl }).then(
      r => { setUndone(t('admin.tidy.apply.undone', { restored: fmt(r.restored), changed: fmt(r.changedAfter) })); setUndoing(false); onChanged(); },
      (e: unknown) => { setUndoError(t('admin.tidy.apply.undoFailed', { reason: reasonOf(e) ?? '' })); setUndoing(false); },
    );
  };

  return (
    <section className="adm-danger" aria-labelledby="adm-tidy-apply-h" data-testid="adm-tidy-apply">
      <h3 id="adm-tidy-apply-h" className="adm-danger__h">{t('admin.tidy.apply.title')}</h3>
      {state.kind === 'loading' && <Skeleton lines={3} label={t('admin.tidy.apply.loading')} />}
      {state.kind === 'forbidden' && (
        <div data-testid="adm-tidy-apply-forbidden">
          <Forbidden title={t('admin.tidy.apply.forbidden')} reason={state.reason} />
        </div>
      )}
      {state.kind === 'bad' && <p className="adm-note" data-tone="dng" role="alert">{t('admin.tidy.apply.bad', { reason: state.reason })}</p>}
      {state.kind === 'error' && <LoadError error={state.error} onRetry={() => setAttempt(a => a + 1)} />}
      {state.kind === 'ok' && !answer && (
        <>
          <p className="adm-dim" data-testid="adm-tidy-apply-summary">
            {t('admin.tidy.apply.summary', { edits: fmt(state.plan.edits), records: fmt(state.plan.records) })}
          </p>
          {!login ? (
            <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-tidy-apply-human">{t('admin.tidy.apply.humanOnly')}</p>
          ) : rows.length === 0 ? (
            <p className="adm-note" role="status">{t('admin.tidy.apply.nothing')}</p>
          ) : (
            <DiffPreview key={`${key}|${attempt}`} rows={rows} onApply={apply} busy={applying}
              label={t('admin.tidy.apply.diff')} lang={lang}
              confirm={{ word: login, label: t('admin.tidy.apply.confirm', { login }) }} />
          )}
          {applyError && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-tidy-apply-error">{t('admin.tidy.apply.error', { reason: applyError })}</p>}
        </>
      )}
      {answer && (
        <div data-testid="adm-tidy-apply-done">
          <BatchUndo batch={{ id: answer.batchId, applied: answer.applied, total: answer.applied + answer.failed, failed: answer.failures, undoUntil: answer.undoUntil }}
            onUndo={undo} undoing={undoing} undone={undone !== null} undoError={undoError} lang={lang} />
          {undone && <p className="adm-note" data-tone="inf" role="status">{undone}</p>}
          <p className="adm-sub">{t('admin.tidy.apply.logged')} <span className="adm-mono">{answer.batchId}</span></p>
        </div>
      )}
      <button type="button" className="adm-btn" onClick={onClose} data-testid="adm-tidy-apply-close">{t('admin.tidy.apply.close')}</button>
    </section>
  );
}

function ManualBlock({ check, onCheck, fetchImpl }: { check: TidyCheck; onCheck: (c: TidyCheck) => void; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const kinds = TIDY_KINDS.filter(k => (check.manual.groups[k]?.records ?? 0) > 0 || check.manual.dismissed.some(d => d.kind === k));
  const [param, setParam] = useUrlParam('tidy');
  const kind = param && kinds.includes(param as (typeof kinds)[number]) ? param : kinds[0] ?? null;
  const [limit, setLimit] = useState(TIDY_PAGE);
  const [status, setStatus] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const rows = kind ? rowsOfKind(check, kind) : [];
  const hidden = kind ? check.manual.dismissed.filter(d => d.kind === kind) : [];
  const canDismiss = kind !== null && DISMISSABLE.includes(kind);

  const recheckOne = async (row: TidyRow) => {
    setStatus(null);
    try {
      const r = await recheckRecord(row.type, row.id, { fetchImpl });
      onCheck(r.check);
      setStatus(r.clean
        ? t('admin.tidy.row.clean', { id: row.id, before: fmt(check.manual.records), after: fmt(r.check.manual.records) })
        : t('admin.tidy.row.still', { id: row.id }));
    } catch (e) {
      setStatus(t('admin.tidy.row.failed', { id: row.id, reason: reasonOf(e) ?? '' }));
    }
  };

  const mark = async (type: string, id: string, action: 'add' | 'remove') => {
    if (!kind) return;
    setStatus(null);
    try {
      const next = await dismissKind(type, id, kind, action, { fetchImpl });
      if (next) onCheck(next);
      setStatus(action === 'add'
        ? t('admin.tidy.row.dismissed', { id, before: fmt(check.manual.records), after: fmt(next?.manual.records ?? check.manual.records) })
        : t('admin.tidy.hidden.restored', { id }));
    } catch (e) {
      setStatus(t('admin.tidy.row.dismissFailed', { id, reason: reasonOf(e) ?? '' }));
    }
  };

  return (
    <div className="adm-card adm-tidy-manual" data-testid="adm-tidy-manual">
      <h3 className="adm-sub">{t('admin.tidy.manual.title', { records: fmt(check.manual.records), places: fmt(check.manual.places) })}</h3>
      {kinds.length === 0 ? <p className="adm-dim">{t('admin.tidy.manual.none')}</p> : (
        <>
          <div className="adm-chips" role="radiogroup" aria-label={t('admin.tidy.manual.groups')}>
            {kinds.map(k => (
              <button key={k} type="button" role="radio" className="adm-chip" aria-checked={k === kind} aria-pressed={k === kind}
                data-testid={`adm-tidy-kind-${k}`} onClick={() => { setParam(k); setLimit(TIDY_PAGE); setShowHidden(false); }}>
                {t(`admin.tidy.kind.${k}` as AppKey)} <b>{fmt(check.manual.groups[k]?.records ?? 0)}</b>
              </button>
            ))}
          </div>
          {kind && <p className="adm-dim">{t(`admin.tidy.fix.${kind}` as AppKey)}</p>}
          {canDismiss && (
            <label className="adm-tidy-rule">
              <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} data-testid="adm-tidy-hidden-toggle" />
              {t('admin.tidy.hidden.toggle')} <b>{fmt(hidden.length)}</b>
            </label>
          )}
          {status && <p className="adm-note" data-tone="inf" role="status" data-testid="adm-tidy-status">{status}</p>}
          {showHidden ? (
            <ul className="adm-tidy-rows" data-testid="adm-tidy-hidden">
              {hidden.length === 0 && <li className="adm-dim adm-tidy-row__head">{t('admin.tidy.hidden.empty')}</li>}
              {hidden.map(d => (
                <li key={`${d.type}|${d.id}`} className="adm-tidy-row" data-testid="adm-tidy-hidden-row" data-id={d.id}>
                  <div className="adm-tidy-row__head">
                    <span />
                    <span className="adm-mono adm-tidy-id" title={d.id}>{d.id}</span>
                    <span className="adm-dim">{t(`admin.tidy.type.${d.type}` as AppKey)}</span>
                    <span className="adm-tidy-num">{t('admin.tidy.row.places', { n: fmt(d.places) })}</span>
                    <span />
                    <span className="adm-tidy-acts">
                      <button type="button" className="adm-btn" onClick={() => mark(d.type, d.id, 'remove')} data-testid="adm-tidy-restore">{t('admin.tidy.hidden.restore')}</button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ul className="adm-tidy-rows" data-testid="adm-tidy-rows">
                {rows.slice(0, limit).map(r => (
                  <TidyRowView key={`${r.type}|${r.id}`} row={r} kind={kind!} onRecheck={() => recheckOne(r)}
                    onDismiss={canDismiss ? () => mark(r.type, r.id, 'add') : undefined} />
                ))}
              </ul>
              {rows.length > limit && (
                <button type="button" className="adm-btn" onClick={() => setLimit(l => l + TIDY_PAGE)} data-testid="adm-tidy-more">
                  {t('admin.tidy.manual.more', { shown: fmt(limit), total: fmt(rows.length) })}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TidyRowView({ row, kind, onRecheck, onDismiss }: { row: TidyRow; kind: string; onRecheck: () => void; onDismiss?: () => void }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const loreType = loreTypeOf(row.type);
  const href = loreType ? recordHref(loreType, row.id, new URLSearchParams(window.location.search)) : null;
  const typeLabel = t(`admin.tidy.type.${row.type}` as AppKey);
  return (
    <li className="adm-tidy-row" data-testid="adm-tidy-row" data-id={row.id}>
      <div className="adm-tidy-row__head">
        <button type="button" className="adm-btn adm-tidy-tog" aria-expanded={open} onClick={() => setOpen(o => !o)}
          aria-label={t(open ? 'admin.tidy.row.collapse' : 'admin.tidy.row.expand', { id: row.id })}>{open ? '▾' : '▸'}</button>
        <span className="adm-mono adm-tidy-id" title={row.id}>{row.id}</span>
        <span className="adm-dim">{typeLabel}</span>
        <span className="adm-tidy-num">{t('admin.tidy.row.places', { n: fmt(row.places) })}</span>
        <span className="adm-tidy-kinds">
          {Object.keys(row.byKind).map(k => <Pill key={k} tone={k === kind ? 'wrn' : 't3'}>{t(`admin.tidy.kindShort.${k}` as AppKey)}</Pill>)}
        </span>
        <span className="adm-tidy-acts">
          {href
            ? <a className="adm-btn" href={href} target="_blank" rel="noopener noreferrer" data-testid="adm-tidy-open">{t('admin.tidy.row.open')} ↗</a>
            : <span className="adm-dim" title={t('admin.tidy.row.noPassportHint')}>{t('admin.tidy.row.noPassport')}</span>}
          <button type="button" className="adm-btn" onClick={onRecheck} data-testid="adm-tidy-recheck">{t('admin.tidy.row.recheck')}</button>
          {onDismiss && <button type="button" className="adm-btn" onClick={onDismiss} data-testid="adm-tidy-dismiss">{t('admin.tidy.row.dismiss')}</button>}
        </span>
      </div>
      {open && (
        <ul className="adm-tidy-issues">
          {row.issues.map((i, n) => (
            <li key={n} data-kind={i.kind}>
              <span className="adm-mono adm-dim">{i.field}</span> · <Snippet text={i.snippet} mark={i.id} />
              {i.suggest.length > 0 && <span className="adm-tidy-suggest"> {t('admin.tidy.row.suggest', { list: i.suggest.join(', ') })}</span>}
            </li>
          ))}
          {row.places > row.issues.length && <li className="adm-dim">{t('admin.tidy.row.morePlaces', { n: fmt(row.places - row.issues.length) })}</li>}
        </ul>
      )}
    </li>
  );
}

/** Фрагмент текста с подсвеченным местом: разметку не рисуем — текст как есть. */
function Snippet({ text, mark }: { text: string; mark: string }) {
  const i = mark ? text.indexOf(mark) : -1;
  if (i < 0) return <span>{text}</span>;
  return <span>{text.slice(0, i)}<mark>{mark}</mark>{text.slice(i + mark.length)}</span>;
}
