// Очередь согласования (SPRINT_UXR_S13_KIT4/K4-SUMMARY-QUEUE). Решения владелицы 16.11.2026:
//  Q4 — «вернуть с правкой» пачкой: общая причина обязательна, своя у записи — по желанию («и так и так»);
//  Q5 — одна лента, вид дела — чип-фильтр сверху («Статусы», «Правки», «Мои правки»);
//  Q6 — своя правка при selfApprove:false видна, «Согласовать» выключена с причиной; в пачке — в «не прошли».
// Что согласовать и как вернуть — решает приложение (onApprove/onReturn); kit собирает очередь, выбор и
// итог «прошли / не прошли». Это подсказка интерфейса, окончательно проверяет сервер приложения.
import { useMemo, useState } from 'react';
import type { KitCtx, KitJournalEntry, KitRecord } from '../core/contract';
import { kitMinute } from '../core/fmtValue';
import { kitT, useKitLang } from '../i18n';
import type { KitKey } from '../i18n';
import { EmptyState } from '../states/StateViews';
import { RecordRef } from '../record/fmt';
import { pendingProposal } from './approval';
import { denyText } from './ApprovalViews';

export interface QueueItem {
  /** Ключ дела: статус — `status:<id>`, правка — `edit:<id>:<поле>:<когда>`. */
  key: string;
  type: 'status' | 'edit';
  recordId: string;
  record?: KitRecord;
  /** Правка: строка журнала. */
  entry?: KitJournalEntry;
  /** Кто предложил и когда (у статуса — последняя несогласованная правка записи, если есть). */
  who?: string;
  at?: string;
  /** Q6: предложил сам смотрящий при selfApprove:false — согласовать нельзя. */
  self: boolean;
}

export interface QueueResult { failed: { key: string; reason: string }[] }
export interface QueueReturnReasons { common: string; per: Record<string, string> }

/** Что ждёт решения: записи в статусах согласования и несогласованные правки. Свежие сверху. */
export function queueItems(ctx: Pick<KitCtx, 'data' | 'config' | 'user'>, opts: { reviewStatuses: readonly string[] }): QueueItem[] {
  const fourEyes = ctx.config.statuses.selfApprove === false;
  const byId = new Map(ctx.data.records.map(r => [r.id, r]));
  const isSelf = (who?: string) => fourEyes && !!who && !!ctx.user && who === ctx.user;
  const edits: QueueItem[] = ctx.data.journal.filter(e => !e.approved_by).map(e => ({
    key: `edit:${e.record_id}:${e.field}:${e.at}`, type: 'edit' as const, recordId: e.record_id, record: byId.get(e.record_id),
    entry: e, who: e.who, at: e.at, self: isSelf(e.who),
  }));
  const statuses: QueueItem[] = ctx.data.records.filter(r => opts.reviewStatuses.includes(r.status)).map(r => {
    const p = pendingProposal(ctx.data.journal, r.id);
    return { key: `status:${r.id}`, type: 'status' as const, recordId: r.id, record: r, ...(p ? { who: p.who, at: p.at } : {}), self: isSelf(p?.who) };
  });
  return [...edits, ...statuses].sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? 1 : (a.at ?? '') > (b.at ?? '') ? -1 : 0));
}

type Filter = 'all' | 'status' | 'edit' | 'mine';

export interface ApprovalQueueProps {
  ctx: KitCtx;
  /** Коды статусов «на согласовании». */
  reviewStatuses: readonly string[];
  onApprove: (items: QueueItem[]) => Promise<QueueResult>;
  onReturn: (items: QueueItem[], reasons: QueueReturnReasons) => Promise<QueueResult>;
}

const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const FILTER_KEY: Record<Filter, KitKey> = { all: 'kit.queue.f.all', status: 'kit.queue.f.status', edit: 'kit.queue.f.edit', mine: 'kit.queue.f.mine' };

type Failed = { item: QueueItem; reason: string };

export function ApprovalQueue({ ctx, reviewStatuses, onApprove, onReturn }: ApprovalQueueProps) {
  const lang = useKitLang();
  const all = useMemo(() => queueItems(ctx, { reviewStatuses }), [ctx, reviewStatuses]);
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [returning, setReturning] = useState<QueueItem[] | null>(null);
  const [common, setCommon] = useState('');
  const [per, setPer] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: Failed[] } | null>(null);

  const mine = (i: QueueItem) => !!ctx.user && i.who === ctx.user;
  const inFilter = (f: Filter) => (i: QueueItem) => f === 'all' || (f === 'mine' ? mine(i) : i.type === f);
  const shown = all.filter(inFilter(filter));
  const title = (i: QueueItem) => i.record?.title ?? i.recordId;
  const chosen = shown.filter(i => picked.has(i.key));
  const selfReason = denyText(lang, 'self');

  const finish = (sent: QueueItem[], res: QueueResult, pre: Failed[]) => {
    const theirs = res.failed.flatMap(f => { const item = sent.find(s => s.key === f.key); return item ? [{ item, reason: f.reason }] : []; });
    setResult({ ok: sent.length - theirs.length, failed: [...pre, ...theirs] });
    setPicked(new Set());
  };
  const fail = (items: QueueItem[], e: unknown) => setResult({ ok: 0, failed: items.map(item => ({ item, reason: e instanceof Error ? e.message : String(e) })) });

  const approve = async (items: QueueItem[]) => {
    const pre = items.filter(i => i.self).map(item => ({ item, reason: selfReason }));
    const sent = items.filter(i => !i.self);
    setBusy(true);
    try { finish(sent, sent.length ? await onApprove(sent) : { failed: [] }, pre); } catch (e) { fail(items, e); } finally { setBusy(false); }
  };
  const sendReturn = async () => {
    if (!returning) return;
    const own: Record<string, string> = {};
    for (const i of returning) { const v = per[i.key]?.trim(); if (v) own[i.key] = v; }
    setBusy(true);
    try {
      finish(returning, await onReturn(returning, { common: common.trim(), per: own }), []);
      setReturning(null); setCommon(''); setPer({});
    } catch (e) { fail(returning, e); } finally { setBusy(false); }
  };

  if (all.length === 0) return <EmptyState title={kitT(lang, 'kit.queue.empty')} hint={kitT(lang, 'kit.queue.emptyHint')} />;

  const allPicked = shown.length > 0 && shown.every(i => picked.has(i.key));
  return (
    <section className="sk-queue" aria-label={kitT(lang, 'kit.queue.title')}>
      <div className="sk-queue__chips" role="group" aria-label={kitT(lang, 'kit.queue.kind')}>
        {(Object.keys(FILTER_KEY) as Filter[]).map(f => (
          <button key={f} type="button" className="sk-pill sk-pill--filter" aria-pressed={filter === f} onClick={() => { setFilter(f); setPicked(new Set()); }}>
            {kitT(lang, FILTER_KEY[f])} <span className="sk-queue__n">{all.filter(inFilter(f)).length}</span>
          </button>
        ))}
      </div>
      <div className="sk-queue__bar">
        <label className="sk-queue__pickall">
          <input type="checkbox" checked={allPicked} aria-label={kitT(lang, 'kit.queue.pickAll')}
            onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map(i => i.key)))} />
          <span aria-hidden="true">{kitT(lang, 'kit.queue.pickAll')}</span>
        </label>
        {chosen.length > 0 && (
          <>
            <button type="button" className="sk-btn sk-btn--primary" disabled={busy} onClick={() => void approve(chosen)}>{kitT(lang, 'kit.queue.approveN', { n: chosen.length })}</button>
            <button type="button" className="sk-btn" disabled={busy} onClick={() => setReturning(chosen)}>{kitT(lang, 'kit.queue.returnN', { n: chosen.length })}</button>
          </>
        )}
      </div>
      {returning && (
        <div className="sk-queue__return" role="group" aria-label={kitT(lang, 'kit.queue.returnTitle')}>
          <label className="sk-queue__field"><span>{kitT(lang, 'kit.queue.common')}</span>
            <textarea value={common} rows={2} onChange={e => setCommon(e.target.value)} />
          </label>
          {returning.map(i => (
            <label key={i.key} className="sk-queue__field"><span>{kitT(lang, 'kit.queue.own', { title: title(i) })}</span>
              <input value={per[i.key] ?? ''} onChange={e => { const v = e.target.value; setPer(p => ({ ...p, [i.key]: v })); }} />
            </label>
          ))}
          <div className="sk-queue__acts">
            <button type="button" className="sk-btn sk-btn--primary" disabled={busy || !common.trim()} onClick={() => void sendReturn()}>{kitT(lang, 'kit.queue.return')}</button>
            <button type="button" className="sk-btn" onClick={() => setReturning(null)}>{kitT(lang, 'kit.queue.cancel')}</button>
          </div>
        </div>
      )}
      {result && (
        <div className="sk-queue__result" role="status" data-testid="kit-queue-result">
          <span>{kitT(lang, 'kit.queue.ok', { n: result.ok })}</span>
          {result.failed.length > 0 && (
            <>
              <span className="sk-queue__bad">{kitT(lang, 'kit.queue.failed', { n: result.failed.length })}</span>
              <ul className="sk-queue__fails">{result.failed.map(f => <li key={f.item.key}>{title(f.item)}: {f.reason}</li>)}</ul>
            </>
          )}
        </div>
      )}
      <ul className="sk-queue__list">
        {shown.length === 0 && <li className="sk-queue__none">{kitT(lang, 'kit.queue.noneInFilter')}</li>}
        {shown.map(i => {
          const when = kitMinute(i.at);
          return (
            <li key={i.key} className="sk-queue__row" data-testid="kit-queue-row" data-type={i.type}>
              <label className="sk-queue__pick"><input type="checkbox" checked={picked.has(i.key)} aria-label={kitT(lang, 'kit.queue.pick', { title: title(i) })}
                onChange={() => setPicked(p => { const n = new Set(p); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })} /></label>
              <div className="sk-queue__main">
                <span className="sk-queue__head">
                  <span className="sk-pill sk-pill--value">{kitT(lang, i.type === 'edit' ? 'kit.queue.t.edit' : 'kit.queue.t.status')}</span>
                  <span className="sk-queue__title"><RecordRef id={i.recordId} ctx={ctx} {...(i.record ? { kind: i.record.kind } : {})} /></span>
                </span>
                {i.entry && (
                  <span className="sk-queue__diff">
                    <span className="sk-queue__fname">{i.entry.field}</span>
                    <del>{show(i.entry.from)}</del><span aria-hidden="true">→</span><ins>{show(i.entry.to)}</ins>
                  </span>
                )}
                {i.who && <span className="sk-queue__who">{kitT(lang, 'kit.queue.proposed', { who: i.who, when: when?.text ?? '—' })}</span>}
                {i.self && <span className="sk-queue__deny">{selfReason}</span>}
              </div>
              <div className="sk-queue__acts">
                <button type="button" className="sk-btn sk-btn--primary" disabled={busy || i.self} title={i.self ? selfReason : undefined} onClick={() => void approve([i])}>{kitT(lang, 'kit.queue.approve')}</button>
                <button type="button" className="sk-btn" disabled={busy} onClick={() => setReturning([i])}>{kitT(lang, 'kit.queue.returnOne')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
