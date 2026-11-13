// «Привести в порядок» — раздел админки (SPRINT_UXR_POLISH_UAT_1113/PU-20).
// Прототип docs/prototypes/pu20-tidy-links.html одобрен владелицей 13.11.2026.
//
// Слова владелицы, по которым собран экран:
//   • «если нет [однозначного прочтения] то в админке сделать раздел привести в порядок с указанием
//     списка типа ошибки и переходом (Если в одном тексте несколько то ссылка одна) но счетчик
//     проверок уменьшается и возможность сделать речек» — группы по виду ошибки, строка = запись,
//     «Перепроверить» у строки и для всего корпуса;
//   • «внешние ссылки MD должно не быть багом и не быть лишним шумом» — их здесь нет вовсе;
//   • «на проде все делается бэком с подтверждением через ui и логином человека» — применение
//     пачки появится вторым шагом (dry_run → DiffPreview с вводом логина → BatchUndo).
// Элементы — Seiðr kit (просьба владелицы): Pill, EmptyState, LoadError, Forbidden, Skeleton.
import { useMemo, useState } from 'react';
import { EmptyState, Forbidden, GameIcon, LoadError, Pill, Skeleton, useLoadState, useUrlParam } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { recordHref } from '../nav/loreRoutes';
import {
  TIDY_KINDS, TIDY_RULES, defaultRules, fetchTidy, loreTypeOf, planFor, recheckAll, recheckRecord, rowsOfKind,
  type TidyCheck, type TidyRow,
} from './tidy';
import './Admin.css';

export interface TidyScreenProps {
  fetchImpl?: typeof fetch;
}

/** Строк группы на экране сразу; дальше — «показать ещё». */
export const TIDY_PAGE = 50;

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : undefined);
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
  else body = <TidyBody check={data} onCheck={setFresh} fetchImpl={fetchImpl} />;

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

function TidyBody({ check, onCheck, fetchImpl }: { check: TidyCheck; onCheck: (c: TidyCheck) => void; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  if (check.auto.edits === 0 && check.manual.records === 0) {
    return <div data-testid="adm-tidy-clean"><EmptyState title={t('admin.tidy.clean')} hint={t('admin.tidy.cleanHint')} /></div>;
  }
  return (
    <>
      <AutoBlock check={check} />
      <ManualBlock check={check} onCheck={onCheck} fetchImpl={fetchImpl} />
    </>
  );
}

function AutoBlock({ check }: { check: TidyCheck }) {
  const t = useAppT();
  const [enabled, setEnabled] = useState<Set<string>>(() => defaultRules(check));
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
                      <input type="checkbox" checked={enabled.has(k)} onChange={() => toggle(k)} data-testid={`adm-tidy-rule-${k}`} />
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
      <p className="adm-note" data-tone="inf" role="note" data-testid="adm-tidy-apply-next">{t('admin.tidy.auto.applyNext')}</p>
    </div>
  );
}

function ManualBlock({ check, onCheck, fetchImpl }: { check: TidyCheck; onCheck: (c: TidyCheck) => void; fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const kinds = TIDY_KINDS.filter(k => (check.manual.groups[k]?.records ?? 0) > 0);
  const [param, setParam] = useUrlParam('tidy');
  const kind = param && kinds.includes(param as (typeof kinds)[number]) ? param : kinds[0] ?? null;
  const [limit, setLimit] = useState(TIDY_PAGE);
  const [status, setStatus] = useState<string | null>(null);
  const rows = kind ? rowsOfKind(check, kind) : [];

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

  return (
    <div className="adm-card adm-tidy-manual" data-testid="adm-tidy-manual">
      <h3 className="adm-sub">{t('admin.tidy.manual.title', { records: fmt(check.manual.records), places: fmt(check.manual.places) })}</h3>
      {kinds.length === 0 ? <p className="adm-dim">{t('admin.tidy.manual.none')}</p> : (
        <>
          <div className="adm-chips" role="radiogroup" aria-label={t('admin.tidy.manual.groups')}>
            {kinds.map(k => (
              <button key={k} type="button" role="radio" className="adm-chip" aria-checked={k === kind} aria-pressed={k === kind}
                data-testid={`adm-tidy-kind-${k}`} onClick={() => { setParam(k); setLimit(TIDY_PAGE); }}>
                {t(`admin.tidy.kind.${k}` as AppKey)} <b>{fmt(check.manual.groups[k].records)}</b>
              </button>
            ))}
          </div>
          {kind && <p className="adm-dim">{t(`admin.tidy.fix.${kind}` as AppKey)}</p>}
          {status && <p className="adm-note" data-tone="inf" role="status" data-testid="adm-tidy-status">{status}</p>}
          <ul className="adm-tidy-rows" data-testid="adm-tidy-rows">
            {rows.slice(0, limit).map(r => <TidyRowView key={`${r.type}|${r.id}`} row={r} kind={kind!} onRecheck={() => recheckOne(r)} />)}
          </ul>
          {rows.length > limit && (
            <button type="button" className="adm-btn" onClick={() => setLimit(l => l + TIDY_PAGE)} data-testid="adm-tidy-more">
              {t('admin.tidy.manual.more', { shown: fmt(limit), total: fmt(rows.length) })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TidyRowView({ row, kind, onRecheck }: { row: TidyRow; kind: string; onRecheck: () => void }) {
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
