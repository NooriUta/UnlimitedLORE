import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type {
  CampaignRow, DriftRow, FindingRow, HypothesisRow, RunRow, SnapshotRow, SubstrateRevAllRow, SubstrateRow,
} from '../../utils/muninnData';
import { dedupe, filterRevAtRunTime, fmtF1, generationDeltas, groupRevChains, num, pickLocale, strArr } from '../../utils/muninnData';
import { MartProse } from './MartProse';
import { MuninnSelect, Field, PanelMsg, ScreenTitle, StatusBadge, SubstrateLink, campaignTone, hypothesisTone } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

function edgeDelta(cur: number | undefined, prev: number | undefined): string {
  if (cur === undefined) return '—';
  if (prev === undefined) return String(cur);
  const d = cur - prev;
  return `${cur} (${d >= 0 ? '+' : ''}${d})`;
}

/**
 * Screen — parse GENERATIONS: a chronological timeline of snapshots where
 * every generation carries (a) its corpus/edge passport with deltas vs the
 * previous one, (b) the top F1 movements per (substrate, task) pinned to one
 * model+prompt, and (c) the science attached to it — campaigns sharing the
 * snapshot, hypotheses decided on them, findings localized here. This is the
 * "deltas tied to conclusions and hypotheses" view.
 */
export function GenerationsScreen({ runs, snapshots, subLabel }: {
  runs: RunRow[];
  snapshots: SnapshotRow[];
  /** kept for call-site compat; the SCD2 register is the revision source now */
  substrates?: SubstrateRow[];
  subLabel: (id: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const models = dedupe(runs.map(r => r.model ?? '').filter(Boolean));
  const prompts = dedupe(runs.map(r => r.prompt ?? '').filter(Boolean));
  const [model, setModel] = useState(runs[0]?.model ?? models[0] ?? '');
  const [prompt, setPrompt] = useState(runs[0]?.prompt ?? prompts[0] ?? '');

  const pinned = model !== '' && prompt !== '';
  const drift = useMartSlice<DriftRow>('drift', pinned ? { model, prompt } : null);
  const campaigns = useMartSlice<CampaignRow>('campaigns', EMPTY_PARAMS);
  const hypotheses = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);
  const findings = useMartSlice<FindingRow>('findings', EMPTY_PARAMS);

  const ordered = useMemo(
    () => [...snapshots].sort((a, b) => (a.parse_date ?? '').localeCompare(b.parse_date ?? '')),
    [snapshots],
  );
  // I3 (Д-2): a fact belongs to the revision valid at ITS RUN's moment —
  // current-rev comparison produced phantom deltas the moment an actor was
  // promoted (tierA → r2-neg hid the honest r1 epoch entirely)
  const revsAll = useMartSlice<SubstrateRevAllRow>('substrate_revs_all', EMPTY_PARAMS);
  const chains = useMemo(() => groupRevChains(revsAll.rows ?? []), [revsAll.rows]);
  const runStarts = useMemo(() => new Map(runs.map(r => [r.run_id, r.started_ts])), [runs]);
  const deltas = useMemo(
    () => generationDeltas(
      filterRevAtRunTime(drift.rows ?? [], runStarts, chains).kept,
      ordered.map(s => s.snapshot_id)),
    [drift.rows, runStarts, chains, ordered],
  );

  if (campaigns.unavailable) {
    return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={campaigns.reload} />;
  }
  if (ordered.length === 0) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const allCampaigns = campaigns.rows ?? [];
  const allHyps = hypotheses.rows ?? [];
  const allFindings = findings.rows ?? [];

  return (
    <div data-testid="bench-generations">
      <ScreenTitle text={t('bench.gen.title', 'Parse generations — snapshot deltas tied to conclusions and hypotheses')}
                   hint={t('bench.gen.hint', 'F1 deltas need model+prompt pins; pairs must exist in both generations')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Field label={t('bench.model', 'Model')}>
          <MuninnSelect value={model} onChange={setModel} options={models.map(m => ({ value: m, label: m }))} />
        </Field>
        <Field label={t('bench.prompt', 'Prompt')}>
          <MuninnSelect value={prompt} onChange={setPrompt} options={prompts.map(p => ({ value: p, label: p }))} />
        </Field>
      </div>

      {ordered.map((s, i) => {
        const prev = i > 0 ? ordered[i - 1] : undefined;
        const gen = i + 1;
        const genCampaigns = allCampaigns.filter(c => c.shared_snapshot_id === s.snapshot_id);
        const genCampaignIds = new Set(genCampaigns.map(c => c.campaign_id));
        const genHyps = allHyps.filter(h =>
          (h.decided_on && genCampaignIds.has(h.decided_on))
          || strArr(h.campaigns).some(c => genCampaignIds.has(c)));
        const genFindings = allFindings.filter(f => f.snapshot_id === s.snapshot_id);
        const genDeltas = deltas.get(s.snapshot_id) ?? [];
        const corpCond = pickLocale(lang, s.corpus_condition_ru_sci, s.corpus_condition_en, s.corpus_condition, s.corpus_condition_ru);
        const snapshotSummary = pickLocale(lang, s.summary_ru_sci, s.summary_en, s.summary, s.summary_ru);

        return (
          <div key={s.snapshot_id} className="analytics-card" style={{ marginBottom: 12 }}
               data-testid={`bench-generation-${i}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="badge badge-info" style={{ fontFamily: 'var(--mono)' }}>G{gen}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' }}>
                {s.snapshot_id}
              </span>
              <span className="scope-tag">{s.parse_date ?? '—'}</span>
              {s.commit_baseline && <span className="scope-tag">@{s.commit_baseline}</span>}
              <span className="scope-tag" title="COL_LINEAGE edges">
                col: {edgeDelta(num(s.col_edges), num(prev?.col_edges))}
              </span>
              <span className="scope-tag" title="TABLE_LINEAGE edges">
                tbl: {edgeDelta(num(s.tbl_edges), num(prev?.tbl_edges))}
              </span>
            </div>
            {(corpCond || snapshotSummary) && (
              <div style={{ fontSize: 'var(--fs-base)', color: 'var(--t2)', marginBottom: 8 }}>
                {corpCond}{corpCond && snapshotSummary ? ' · ' : ''}{snapshotSummary}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              <div style={{ minWidth: 280, flex: 1 }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                  {t('bench.gen.deltas', 'Top F1 movements vs previous generation')}
                </div>
                {i === 0 && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.gen.baseline', 'baseline generation')}</span>}
                {i > 0 && pinned && drift.loading && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.loading', 'Loading…')}</span>}
                {i > 0 && !drift.loading && genDeltas.length === 0 && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.gen.noPairs', 'no (substrate, task) pairs measured in both generations under these pins')}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {genDeltas.map(d => (
                    <div key={`${d.substrate_id}|${d.task_id}`}
                         style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)', fontFamily: 'var(--mono)' }}>
                      <span style={{ width: 16, textAlign: 'center',
                                     color: d.delta > 0 ? 'var(--suc)' : d.delta < 0 ? 'var(--danger)' : 'var(--t3)' }}>
                        {d.delta > 0 ? '▲' : d.delta < 0 ? '▼' : '·'}
                      </span>
                      <SubstrateLink id={d.substrate_id} label={subLabel(d.substrate_id)} />
                      <span className="scope-tag">{d.task_id}</span>
                      <span style={{ color: 'var(--t2)' }}>{fmtF1(d.prev)} → {fmtF1(d.cur)}</span>
                      <span style={{ color: d.delta > 0 ? 'var(--suc)' : d.delta < 0 ? 'var(--danger)' : 'var(--t3)' }}
                            title={`Δ ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(3)}`}>
                        {d.delta >= 0 ? '+' : ''}{d.delta.toFixed(3)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ minWidth: 320, flex: 1 }}>
                {genCampaigns.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                      {t('bench.gen.campaigns', 'Campaigns on this generation')}
                    </div>
                    {genCampaigns.map(c => {
                      const concl = pickLocale(lang, c.conclusions_ru_sci, c.conclusions_en, c.conclusions, c.conclusions_ru);
                      return (
                        <div key={c.campaign_id} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', color: 'var(--t1)' }}>{c.campaign_id}</span>
                            <StatusBadge tone={campaignTone(c.status)} text={c.status ?? '?'} />
                          </div>
                          {concl && <MartProse text={concl} style={{ fontSize: 'var(--fs-base)' }} />}
                        </div>
                      );
                    })}
                  </div>
                )}
                {genHyps.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                      {t('bench.gen.hypotheses', 'Hypotheses tested / decided here')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {genHyps.map(h => (
                        <span key={h.hyp_id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`}
                                style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', color: 'var(--acc)', textDecoration: 'none' }}>
                            {h.hyp_id}
                          </Link>
                          <StatusBadge tone={hypothesisTone(h.status)} text={h.status ?? '?'} />
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {genFindings.length > 0 && (
                  <div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                      {t('bench.gen.findings', 'Findings localized on this generation')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {genFindings.map(f => (
                        <Link key={f.finding_id}
                              to={`/benchmark/finding/${encodeURIComponent(f.finding_id)}`}
                              className="scope-tag" style={{ color: 'var(--acc)', textDecoration: 'none' }}>
                          {f.finding_id} [{f.finding_status_id ?? '?'}]
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {genCampaigns.length === 0 && genHyps.length === 0 && genFindings.length === 0 && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.gen.noScience', 'no campaigns / hypotheses / findings attached')}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
