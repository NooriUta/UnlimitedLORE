// «Перенос на новую модель» — раздел админки (SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02).
// Владелица 19.11.2026: «админку делай на стенде к 18 версии» — «да» прототипу
// docs/prototypes/mig-transfer-admin.html (в репозитории его нет — экран собран по описанию в задаче).
//
// Образец — «Привести в порядок» (TidyScreen). Отличие: решение человека здесь — правило переноса
// (mig-decisions/1): «значение medium свести к normal» действует на все записи с этим значением и
// переживает повторный перенос со свежего снимка; записи прода не меняются.
//   • полоса этапов конвейера: чтение → расчёт по карте → сведение → запись → сверка «до и после»;
//   • группы по виду расхождения, строка — значение со счётом записей и ссылками на них;
//   • у строки — выбор правила; окно kit DiffPreview со своим логином; отмена — kit BatchUndo;
//   • счётчик «ждут решения» убывает с каждым правилом;
//   • «Перепроверить» и «Пробный перенос» — запуск с сервера пока не подключён, это сказано словами;
//   • честные состояния: «прогона ещё не было», «источник недоступен», «сверка не сошлась» — разные.
// Элементы — Seiðr kit: Pill, EmptyState, LoadError, Forbidden, Skeleton, DiffPreview, BatchUndo, GameIcon.
import { useState } from 'react';
import {
  BatchUndo, DiffPreview, EmptyState, Forbidden, GameIcon, LoadError, Pill, Skeleton,
  useKitLang, useLoadState, useUrlParam, type DiffRow,
} from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import { LoreHttpError } from '../api/loreSlice';
import {
  MIG_ACTIONS, decide, fetchMigration, runPipeline, undoLast,
  type MigAction, type MigAnswer, type MigGroup, type MigRow, type MigStage,
} from './migration';
import './Admin.css';

export interface MigrationScreenProps {
  fetchImpl?: typeof fetch;
}

const reasonOf = (e: unknown) =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : undefined;
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

type Tone = 'suc' | 'wrn' | 'dng' | 'inf' | 't2' | 't3';
const STAGE_TONE: Record<string, Tone> = { done: 'suc', ok: 'suc', attention: 'wrn', failed: 'dng', not_run: 't3' };

export function MigrationScreen({ fetchImpl }: MigrationScreenProps) {
  const t = useAppT();
  const res = useLoadState<MigAnswer>(signal => fetchMigration({ signal, fetchImpl }), [fetchImpl]);
  const [fresh, setFresh] = useState<MigAnswer | null>(null);
  const [run, setRun] = useState<{ tone: Tone; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const data = fresh ?? res.data ?? null;

  const start = async (what: 'recheck' | 'trial') => {
    setRunning(true);
    setRun(null);
    try {
      const r = await runPipeline(what, { fetchImpl });
      setRun(r.started ? { tone: 'inf', text: t('admin.mig.run.started') } : { tone: 'wrn', text: t('admin.mig.run.notConnected', { reason: r.reason }) });
    } catch (e) {
      setRun({ tone: 'dng', text: t('admin.mig.run.failed', { reason: reasonOf(e) ?? '' }) });
    } finally { setRunning(false); }
  };

  let body;
  if (res.state === 'loading' && !data) body = <Skeleton lines={6} label={t('admin.mig.loading')} />;
  else if (res.state === 'forbidden') body = <Forbidden reason={reasonOf(res.error)} />;
  else if (!data) body = <LoadError title={t('admin.mig.failed')} error={res.error} onRetry={res.reload} />;
  else if (data.state === 'no_run') {
    body = (
      <div data-testid="adm-mig-norun">
        <EmptyState title={t('admin.mig.noRun')}
          hint={t(data.reason === 'not_configured' ? 'admin.mig.noRun.notConfigured' : 'admin.mig.noRun.noReport')} />
      </div>
    );
  } else if (data.state === 'source_unavailable') {
    body = (
      <div data-testid="adm-mig-source">
        <LoadError title={t('admin.mig.sourceDown')} hint={t('admin.mig.sourceDownHint', { list: data.unread.join(', ') || '—' })} onRetry={res.reload} />
      </div>
    );
  } else if (data.state === 'unknown') body = <LoadError title={t('admin.mig.unknownState')} onRetry={res.reload} />;
  else body = <MigBody data={data} onData={setFresh} fetchImpl={fetchImpl} />;

  return (
    <section className="adm" aria-labelledby="adm-mig-h" data-testid="adm-migration">
      <h2 id="adm-mig-h" className="adm-h">{t('admin.mig.title')}</h2>
      <p className="adm-lead">{t('admin.mig.lead')}</p>
      <div className="adm-tidy-status">
        {data?.at && <Pill tone="suc">{t('admin.mig.at', { at: kitMinute(data.at)?.text ?? data.at })}</Pill>}
        {data?.source && <Pill tone="t2">{t('admin.mig.source', { db: data.source })}</Pill>}
        {data?.target && <Pill tone="t2">{t('admin.mig.target', { db: data.target })}</Pill>}
        <button type="button" className="adm-btn" onClick={() => start('recheck')} disabled={running} data-testid="adm-mig-run-recheck">
          <GameIcon slug="cycle" size={12} /> {t('admin.mig.recheck')}
        </button>
        <button type="button" className="adm-btn" onClick={() => start('trial')} disabled={running} data-testid="adm-mig-run-trial">
          <GameIcon slug="cargo-crate" size={12} /> {t('admin.mig.trial')}
        </button>
      </div>
      {run && <p className="adm-note" data-tone={run.tone} role="status" data-testid="adm-mig-run-note">{run.text}</p>}
      {body}
    </section>
  );
}

function StageStrip({ stages }: { stages: MigStage[] }) {
  const t = useAppT();
  return (
    <ol className="adm-chips" aria-label={t('admin.mig.stages')}>
      {stages.map(s => (
        <li key={s.key} data-testid="adm-mig-stage" data-state={s.state}>
          <Pill tone={STAGE_TONE[s.state] ?? 't3'}>
            {t(`admin.mig.stage.${s.key}` as AppKey)}
            {s.n !== null ? ` · ${fmt(s.n)}` : ''}
            {' · '}{t(`admin.mig.stageState.${s.state in STAGE_TONE ? s.state : 'not_run'}` as AppKey)}
          </Pill>
        </li>
      ))}
    </ol>
  );
}

interface Pending { row: MigRow; action: MigAction; to: string }

function MigBody({ data, onData, fetchImpl }: { data: MigAnswer; onData: (a: MigAnswer) => void; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lang = useKitLang();
  const [param, setParam] = useUrlParam('mig');
  const groups = data.groups.filter(g => g.rows.length > 0 || g.n > 0);
  const gi = param !== null && /^\d+$/.test(param) && Number(param) < groups.length ? Number(param) : 0;
  const group: MigGroup | undefined = groups[gi];
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; undoUntil: string | null } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const login = data.login;

  const apply = () => {
    if (!pending || !login || busy) return;
    setBusy(true);
    setError(null);
    decide(pending.row, pending.action, pending.to, login, { fetchImpl }).then(
      a => { onData(a); setDone({ id: a.accepted ?? '', undoUntil: a.undoUntil }); setUndone(false); setUndoError(null); setPending(null); setBusy(false); },
      (e: unknown) => { setError(reasonOf(e) ?? ''); setBusy(false); },
    );
  };

  const undo = () => {
    if (!login || undoing) return;
    setUndoing(true);
    setUndoError(null);
    undoLast(login, { fetchImpl }).then(
      a => { onData(a); setUndone(true); setUndoing(false); },
      (e: unknown) => { setUndoError(t('admin.mig.undoFailed', { reason: reasonOf(e) ?? '' })); setUndoing(false); },
    );
  };

  const diff: DiffRow[] = pending ? [{
    id: 'rule', kind: 'change', text: `${pending.row.type}.${pending.row.field}`,
    from: pending.row.value ?? t('admin.mig.empty'),
    to: pending.action === 'map_to' ? pending.to.trim() : t(`admin.mig.action.${pending.action}` as AppKey),
    detail: t('admin.mig.confirm.records', { n: fmt(pending.row.n) }), check: { state: 'checked' },
  }] : [];

  return (
    <>
      {data.state === 'verify_failed' && (
        <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-mig-verify-failed">{t('admin.mig.verifyFailed')}</p>
      )}
      <StageStrip stages={data.stages} />
      <div className="adm-tidy-status">
        <Pill tone={data.waiting > 0 ? 'wrn' : 'suc'}><span data-testid="adm-mig-waiting">{t('admin.mig.waiting', { n: fmt(data.waiting) })}</span></Pill>
        {data.heldWaiting > 0 && <Pill tone="t2">{t('admin.mig.heldWaiting', { n: fmt(data.heldWaiting) })}</Pill>}
      </div>
      {!login && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-mig-human">{t('admin.mig.human')}</p>}

      {done && login && (
        <div data-testid="adm-mig-done">
          <BatchUndo batch={{ id: done.id, applied: 1, total: 1, undoUntil: done.undoUntil }}
            onUndo={undo} undoing={undoing} undone={undone} undoError={undoError} lang={lang} />
        </div>
      )}
      {!done && data.last && login && (
        <p className="adm-dim" data-testid="adm-mig-last">
          {t('admin.mig.lastRule', { id: data.last.id, by: data.last.by, at: kitMinute(data.last.at)?.text ?? data.last.at })}{' '}
          <button type="button" className="adm-btn" onClick={undo} disabled={undoing} data-testid="adm-mig-undo-last">{t('admin.mig.undoLast')}</button>
          {undoError && <span className="adm-err" role="alert"> {undoError}</span>}
        </p>
      )}

      {groups.length === 0 ? (
        <div data-testid="adm-mig-clean"><EmptyState title={t('admin.mig.clean')} hint={t('admin.mig.cleanHint')} /></div>
      ) : (
        <div className="adm-card" data-testid="adm-mig-groups">
          <h3 className="adm-sub">{t('admin.mig.groups')}</h3>
          <div className="adm-chips" role="radiogroup" aria-label={t('admin.mig.groups')}>
            {groups.map((g, i) => (
              <button key={i} type="button" role="radio" className="adm-chip" aria-checked={i === gi} aria-pressed={i === gi}
                data-testid={`adm-mig-group-${i}`} onClick={() => { setParam(String(i)); setPending(null); }}>
                {t(g.kind === 'held' ? 'admin.mig.kind.held' : 'admin.mig.kind.reject', { why: g.why })} <b>{fmt(g.n)}</b>
              </button>
            ))}
          </div>
          {group && group.kind === 'held' && <HeldList group={group} />}
          {group && group.kind === 'reject' && (
            <RejectTable group={group} canDecide={login !== null} onAccept={p => { setPending(p); setError(null); }} />
          )}
        </div>
      )}

      {pending && login && (
        <section className="adm-danger" aria-labelledby="adm-mig-confirm-h" data-testid="adm-mig-confirm">
          <h3 id="adm-mig-confirm-h" className="adm-danger__h">{t('admin.mig.confirm.title')}</h3>
          <DiffPreview rows={diff} onApply={apply} busy={busy} label={t('admin.mig.confirm.diff')} lang={lang}
            confirm={{ word: login, label: t('admin.mig.confirm.word', { login }) }} />
          {error && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-mig-error">{t('admin.mig.error', { reason: error })}</p>}
          <button type="button" className="adm-btn" onClick={() => setPending(null)} data-testid="adm-mig-confirm-close">{t('admin.mig.confirm.close')}</button>
        </section>
      )}
    </>
  );
}

function HeldList({ group }: { group: MigGroup }) {
  const t = useAppT();
  return (
    <div data-testid="adm-mig-held">
      <p className="adm-dim">{t('admin.mig.heldHint')}</p>
      <ul className="adm-list">
        {group.rows.map(r => (
          <li key={`${r.type}.${r.field}`}>
            <span className="adm-mono">{r.type}.{r.field}</span> · {t('admin.mig.records', { n: fmt(r.n) })}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RejectTable({ group, canDecide, onAccept }: { group: MigGroup; canDecide: boolean; onAccept: (p: Pending) => void }) {
  const t = useAppT();
  return (
    <>
      <div className="adm-tablewrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>{t('admin.mig.col.where')}</th><th>{t('admin.mig.col.value')}</th><th>{t('admin.mig.col.n')}</th>
              <th>{t('admin.mig.col.refs')}</th><th>{t('admin.mig.col.rule')}</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map(r => <RejectRow key={`${r.type}|${r.field}|${r.value}`} row={r} canDecide={canDecide} onAccept={onAccept} />)}
          </tbody>
        </table>
      </div>
      {group.rest > 0 && <p className="adm-dim">{t('admin.mig.rest', { n: fmt(group.rest) })}</p>}
    </>
  );
}

function RejectRow({ row, canDecide, onAccept }: { row: MigRow; canDecide: boolean; onAccept: (p: Pending) => void }) {
  const t = useAppT();
  const [action, setAction] = useState<MigAction | ''>('');
  const [to, setTo] = useState('');
  const ready = action !== '' && (action !== 'map_to' || to.trim() !== '');
  return (
    <tr data-testid="adm-mig-row">
      <td className="adm-mono">{row.type}.{row.field}</td>
      <td className="adm-mono">{row.value === null || row.value === '' ? <span className="adm-dim">{t('admin.mig.empty')}</span> : row.value}</td>
      <td className="adm-tidy-num">{fmt(row.n)}</td>
      <td>
        {row.refs.length === 0 ? <span className="adm-dim">{t('admin.mig.noRefs')}</span> : row.refs.map(ref => {
          const href = recordHref(ref.type, ref.id, new URLSearchParams(window.location.search));
          return href
            ? <a key={ref.id} className="adm-link adm-mono" href={href} target="_blank" rel="noopener noreferrer" data-testid="adm-mig-ref">{ref.id} ↗</a>
            : <span key={ref.id} className="adm-mono adm-dim">{ref.id}</span>;
        })}
      </td>
      <td>
        {row.decision ? (
          <Pill tone="suc">{t('admin.mig.decided', { id: row.decision.id, action: t(`admin.mig.action.${row.decision.action in ACTION_KEYS ? row.decision.action : 'other'}` as AppKey) })}{row.decision.to ? ` → ${row.decision.to}` : ''}</Pill>
        ) : canDecide ? (
          <span className="adm-tidy-acts">
            <select className="adm-select" value={action} onChange={e => setAction(e.target.value as MigAction | '')}
              aria-label={t('admin.mig.col.rule')} data-testid="adm-mig-action">
              <option value="">{t('admin.mig.action.pick')}</option>
              {MIG_ACTIONS.map(a => <option key={a} value={a}>{t(`admin.mig.action.${a}` as AppKey)}</option>)}
            </select>
            {action === 'map_to' && (
              <input className="adm-input" value={to} onChange={e => setTo(e.target.value)} placeholder={t('admin.mig.to')}
                aria-label={t('admin.mig.to')} data-testid="adm-mig-to" />
            )}
            <button type="button" className="adm-btn" data-tone="acc" disabled={!ready}
              onClick={() => { if (action) onAccept({ row, action, to }); }} data-testid="adm-mig-accept">
              {t('admin.mig.accept')}
            </button>
          </span>
        ) : <span className="adm-dim">—</span>}
      </td>
    </tr>
  );
}

const ACTION_KEYS: Record<string, true> = { map_to: true, to_note: true, drop: true, defer: true, add_code: true };
