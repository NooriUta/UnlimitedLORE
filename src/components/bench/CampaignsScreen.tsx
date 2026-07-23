import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type { CampaignRow, FindingRow, HypothesisRow, RunRow } from '../../utils/muninnData';
import { dedupe, formatTokens, formatUsd, num, pickLocale, strArr } from '../../utils/muninnData';
import { PanelMsg, StatusBadge, campaignTone, hypothesisTone } from './shared';
import { MartProse } from './MartProse';

/** Column headers inside data grid (Scope / Runs / Cost). */
const SEC_LABEL = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--t2)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.07em',
  marginBottom: 4,
};

/** Structural section dividers inside a campaign card (Hypotheses / Findings). */
const SEC_DIV = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  color: 'var(--t1)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.07em',
  marginBottom: 2,
};

/** Compact badge style for row-level hypothesis/finding status — smaller than campaign badge. */
const SMALL_BADGE: React.CSSProperties = { fontSize: 'var(--fs-2xs)', padding: '1px 5px' };

function GoalBox({ text }: { text: string }) {
  return (
    <div className="goal-prose" style={{
      marginBottom: 10,
      borderLeft: '3px solid var(--acc)',
      background: 'color-mix(in srgb, var(--acc) 6%, transparent)',
      borderRadius: '0 4px 4px 0',
      paddingLeft: 8, paddingTop: 4, paddingBottom: 4,
    }}>
      <MartProse text={text} style={{ fontSize: 'var(--fs-sm)' }} />
    </div>
  );
}

/** Global economics strip — total only. */
function EconomyStrip({ runs }: { runs: RunRow[] }) {
  const { t } = useTranslation();
  const priced = runs.filter(r => num(r.cost_usd) !== undefined);
  if (priced.length === 0) return null;
  const total = priced.reduce((s, r) => s + (num(r.cost_usd) ?? 0), 0);
  const totalTokensIn  = priced.reduce((s, r) => s + (num(r.tokens_in_total)  ?? 0), 0);
  const totalTokensOut = priced.reduce((s, r) => s + (num(r.tokens_out_total) ?? 0), 0);
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14,
      padding: '4px 10px', borderRadius: 6, background: 'var(--bg2)',
    }} title={`${t('bench.economy', 'Economics')} · in ${formatTokens(totalTokensIn)} / out ${formatTokens(totalTokensOut)}`}>
      <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
        {t('bench.economy', 'Economics')}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)' }}>
        {formatUsd(total)}
      </span>
    </div>
  );
}

const EMPTY_PARAMS: Record<string, string> = {};

function RunChip({ runId, runs }: { runId: string; runs: RunRow[] }) {
  const run = runs.find(r => r.run_id === runId);
  const title = run
    ? `${run.model ?? '?'} · ${run.prompt ?? '?'} · n=${run.n_records ?? '?'}${run.note ? ` · ${run.note}` : ''}`
    : runId;
  return <span className="scope-tag" title={title}>{runId}</span>;
}

function findingTone(statusId: string | undefined): 'suc' | 'warn' | 'err' | 'info' | 'neutral' {
  if (statusId === 'fixed') return 'suc';
  if (statusId === 'open') return 'err';
  if (statusId === 'localized' || statusId === 'reported') return 'warn';
  return 'neutral';
}

function HypothesisLine({ h }: { h: HypothesisRow }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const stmt = pickLocale(lang, h.statement_ru_sci, h.statement_en, h.statement, h.statement_ru);
  const evid = pickLocale(lang, h.evidence_ru_sci, h.evidence_en, h.evidence, h.evidence_ru);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '3px 0', flexWrap: 'wrap' }}>
      <Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`}
            style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)', minWidth: 100, textDecoration: 'none' }}>
        {h.hyp_id}
      </Link>
      <StatusBadge tone={hypothesisTone(h.status)} text={h.status ?? '?'} style={SMALL_BADGE} />
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)', flex: 1, minWidth: 220 }} title={evid ?? ''}>
        {stmt ?? ''}
        {h.threshold ? <span style={{ color: 'var(--t3)' }}> · {h.threshold}</span> : null}
      </span>
      {h.decided_on && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', whiteSpace: 'nowrap' }}
              title={`${t('bench.decidedOn', 'decided on')} ${h.decided_ts ?? ''}`}>
          {h.decided_on}
        </span>
      )}
    </div>
  );
}

function FindingLine({ f }: { f: FindingRow }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const evid = pickLocale(lang, f.evidence_ru_sci, f.evidence_en, f.evidence, f.evidence_ru);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0', flexWrap: 'wrap' }}>
      <Link to={`/benchmark/finding/${encodeURIComponent(f.finding_id)}`}
            style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)', minWidth: 150, textDecoration: 'none' }}>
        {f.finding_id}
      </Link>
      <StatusBadge tone={findingTone(f.finding_status_id)} text={f.finding_status_id ?? '?'} style={SMALL_BADGE} />
      {(f.finding_class_id || f.side) && (
        <span className="scope-tag" style={{ fontSize: 'var(--fs-2xs)' }}>
          {[f.finding_class_id, f.side].filter(Boolean).join(' · ')}
        </span>
      )}
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)', flex: 1, minWidth: 190 }} title={evid ?? ''}>
        {f.title ?? ''}
      </span>
    </div>
  );
}

/** Sort key: closed_ts > started_ts > '' — descending (most recent first). */
function campaignSortKey(c: CampaignRow): string {
  return c.closed_ts ?? c.started_ts ?? '';
}

/** Format ISO timestamp as compact date label e.g. "05.06.2026". */
function fmtDate(ts: string | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function CampaignsScreen({ runs }: { runs: RunRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const campaigns = useMartSlice<CampaignRow>('campaigns', EMPTY_PARAMS);
  const hypotheses = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);
  const findings = useMartSlice<FindingRow>('findings', EMPTY_PARAMS);

  if (campaigns.unavailable) {
    return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={campaigns.reload} />;
  }
  if (campaigns.error) return <PanelMsg kind="error" text={campaigns.error} onRetry={campaigns.reload} />;
  if (!campaigns.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const allHyps = hypotheses.rows ?? [];
  const allFindings = findings.rows ?? [];
  const attachedHyp = new Set(allHyps.flatMap(h => strArr(h.campaigns)).map(String));

  const sorted = [...campaigns.rows].sort((a, b) =>
    campaignSortKey(b).localeCompare(campaignSortKey(a))
  );
  const statuses = ['all', ...Array.from(new Set(sorted.map(c => c.status ?? 'unknown')))];
  const visible = activeStatus === 'all' ? sorted : sorted.filter(c => (c.status ?? 'unknown') === activeStatus);

  return (
    <div data-testid="bench-campaigns">

      {/* ── status filter chips ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {statuses.map(s => {
          const count = s === 'all' ? sorted.length : sorted.filter(c => (c.status ?? 'unknown') === s).length;
          const active = activeStatus === s;
          return (
            <button key={s} onClick={() => setActiveStatus(s)} style={{
              padding: '3px 10px', borderRadius: 20, border: '1px solid',
              borderColor: active ? 'var(--acc)' : 'var(--bd)',
              background: active ? 'var(--acc)' : 'transparent',
              color: active ? '#fff' : 'var(--t2)',
              fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400, cursor: 'pointer',
              transition: 'all .15s',
            }}>
              {s === 'all' ? t('bench.filterAll', 'All') : s}
              <span style={{ marginLeft: 5, opacity: .7, fontSize: 'var(--fs-xs)' }}>{count}</span>
            </button>
          );
        })}
      </div>

      <EconomyStrip runs={runs} />
      {visible.map(c => {
        const runIds = dedupe(strArr(c.run_ids));
        const hyps = allHyps.filter(h => strArr(h.campaigns).includes(c.campaign_id));
        const finds = allFindings.filter(f => strArr(f.campaigns).includes(c.campaign_id));
        const concl = pickLocale(lang, c.conclusions_ru_sci, c.conclusions_en, c.conclusions, c.conclusions_ru);
        const cAxis = pickLocale(lang, c.contrast_axis_ru_sci, c.contrast_axis_en, c.contrast_axis, c.contrast_axis_ru);
        const cGoal = pickLocale(lang, c.goal_ru_sci, c.goal_en, c.goal, c.goal_ru);
        const taskScope: string[] = Array.isArray(c.task_scope)
          ? c.task_scope
          : (c.task_scope ? [String(c.task_scope)] : []);
        const campaignRuns = runs.filter(r => runIds.includes(r.run_id));
        const hasCampaignCost = campaignRuns.some(r => num(r.cost_usd) !== undefined);
        const campaignCost = campaignRuns.reduce((s, r) => s + (num(r.cost_usd) ?? 0), 0);
        return (
          <div key={c.campaign_id} className="analytics-card" style={{ marginBottom: 12 }}>

            {/* 1 ── id · status · date ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' }}>
                {c.campaign_id}
              </span>
              <StatusBadge tone={campaignTone(c.status)} text={c.status ?? '?'} />
              {fmtDate(c.closed_ts ?? c.started_ts) && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginLeft: 'auto' }}
                      title={c.closed_ts ? `closed ${c.closed_ts}` : `started ${c.started_ts}`}>
                  {fmtDate(c.closed_ts ?? c.started_ts)}
                </span>
              )}
            </div>

            {/* 2 ── title ── */}
            {c.title && (
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--t1)', lineHeight: 1.4, marginBottom: cGoal ? 6 : (cAxis ? 4 : 10) }}>
                {c.title}
              </div>
            )}

            {/* 2b ── goal (collapsible Markdown prose) ── */}
            {cGoal && <GoalBox text={cGoal} />}

            {/* 3 ── contrast axis ── */}
            {cAxis && (
              <div style={{ fontSize: 'var(--fs-sm)', marginBottom: 10 }}>
                <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 5 }}>
                  {t('bench.campaignAxis', 'axis')}
                </span>
                <span style={{ color: 'var(--t2)' }}>{cAxis}</span>
              </div>
            )}

            {/* 4 ── datasets ── */}
            {(c.shared_snapshot_id || c.shared_corpus_id || c.shared_gold_epoch) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                <span style={{ ...SEC_LABEL, marginBottom: 0, alignSelf: 'center', marginRight: 4 }}>
                  {t('bench.campaignScope', 'Data')}
                </span>
                {c.shared_snapshot_id && <span className="scope-tag">snap: {c.shared_snapshot_id}</span>}
                {c.shared_corpus_id && <span className="scope-tag">corpus: {c.shared_corpus_id}</span>}
                {c.shared_gold_epoch && <span className="scope-tag">gold: {c.shared_gold_epoch}</span>}
              </div>
            )}

            {/* 5 ── tasks ── */}
            {taskScope.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, alignItems: 'center' }}>
                <span style={{ ...SEC_LABEL, marginBottom: 0, marginRight: 4 }}>
                  {t('bench.campaignTasks', 'Tasks')}
                </span>
                {taskScope.map(task => (
                  <span key={task} className="scope-tag" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>
                    {task}
                  </span>
                ))}
              </div>
            )}

            {/* 6 ── hypotheses ── */}
            {hyps.length > 0 && (
              <div style={{ borderTop: '1px solid var(--bd)', marginTop: 4, paddingTop: 6 }}>
                <div style={SEC_DIV}>
                  {t('bench.hypotheses', 'Hypotheses')} · {hyps.length}
                </div>
                {hyps.map(h => <HypothesisLine key={h.hyp_id} h={h} />)}
              </div>
            )}

            {/* 7 ── conclusions ── */}
            {concl && (
              <div style={{ marginTop: 8, padding: '6px 10px',
                            borderLeft: '3px solid var(--suc)', background: 'var(--bg2)', borderRadius: '0 4px 4px 0' }}>
                <MartProse text={concl} style={{ fontSize: 'var(--fs-sm)' }} />
              </div>
            )}

            {/* 8 ── findings ── */}
            {finds.length > 0 && (
              <div style={{ borderTop: '1px solid var(--bd)', marginTop: 8, paddingTop: 6 }}>
                <div style={SEC_DIV}>
                  {t('bench.findings', 'Findings')} · {finds.length}
                </div>
                {finds.map(f => <FindingLine key={f.finding_id} f={f} />)}
              </div>
            )}

            {/* 9 ── runs + cost ── */}
            {(runIds.length > 0 || hasCampaignCost) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginTop: 8, paddingTop: 6,
                            borderTop: '1px solid var(--bd)', alignItems: 'flex-start' }}>
                <div>
                  <div style={SEC_LABEL}>
                    {t('bench.campaignRuns', 'Runs')}{runIds.length > 0 ? ` · ${runIds.length}` : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {runIds.length > 0
                      ? runIds.map(id => <RunChip key={id} runId={id} runs={runs} />)
                      : <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>—</span>}
                  </div>
                </div>
                {hasCampaignCost && (
                  <div>
                    <div style={SEC_LABEL}>{t('bench.campaignCost', 'Cost')}</div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', color: 'var(--t1)' }}>
                      {formatUsd(campaignCost)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {allHyps.some(h => !attachedHyp.has(h.hyp_id) && strArr(h.campaigns).length === 0) && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.hypotheses', 'Hypotheses')} — backlog</div>
          {allHyps.filter(h => strArr(h.campaigns).length === 0).map(h => <HypothesisLine key={h.hyp_id} h={h} />)}
        </div>
      )}
      {allFindings.some(f => strArr(f.campaigns).length === 0) && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.findings', 'Findings')} — backlog</div>
          {allFindings.filter(f => strArr(f.campaigns).length === 0).map(f => <FindingLine key={f.finding_id} f={f} />)}
        </div>
      )}
    </div>
  );
}
