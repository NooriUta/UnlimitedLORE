import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useBench';
import type {
  CampaignRow, DecisionRow, FindingRow, HypothesisRow, PhaseRow, RunRow,
} from '../../utils/benchData';
import { dedupe, formatSeconds, formatUsd, num, pickLocale, strArr } from '../../utils/benchData';
import { MartProse } from './MartProse';
import { PanelMsg, StatusBadge, campaignTone, hypothesisTone } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

function phaseTone(status: string | undefined): 'suc' | 'warn' | 'info' | 'neutral' {
  if (status === 'closed') return 'suc';
  if (status === 'running') return 'info';
  if (status === 'planned') return 'warn';
  return 'neutral';
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase',
                  letterSpacing: '.07em', margin: '10px 0 4px' }}>
      {text}
    </div>
  );
}

function RunLine({ run }: { run: RunRow }) {
  return (
    <Link to={`/benchmark?tab=cases&run=${encodeURIComponent(run.run_id)}`}
          className="scope-tag" style={{ color: 'var(--acc)', textDecoration: 'none' }}
          title={run.note ?? ''}>
      {run.run_id} · {run.model ?? '?'}·{run.prompt ?? '?'} · n={run.n_records ?? '?'}
      {num(run.cost_usd) !== undefined && ` · ${formatUsd(num(run.cost_usd))}`}
      {num(run.duration_s) !== undefined && ` · ${formatSeconds(num(run.duration_s))}`}
    </Link>
  );
}

function HypothesisBet({ h, decidedHere }: { h: HypothesisRow; decidedHere: boolean }) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const rationale = pickLocale(lang, h.rationale_ru_sci, h.rationale_en, h.rationale, h.rationale_ru);
  const interpretation = pickLocale(lang, h.interpretation_ru_sci, h.interpretation_en, h.interpretation, h.interpretation_ru);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
          {h.hyp_id}
        </Link>
        <StatusBadge tone={hypothesisTone(h.status)} text={h.status ?? '?'} />
        <span style={{ fontSize: 12, color: 'var(--t1)' }}>{pickLocale(lang, h.statement_ru_sci, h.statement_en, h.statement, h.statement_ru) ?? ''}</span>
      </div>
      {rationale && <MartProse text={rationale} style={{ fontSize: 12, paddingLeft: 12 }} />}
      {decidedHere && interpretation && (
        <div style={{ borderLeft: '3px solid var(--acc)', paddingLeft: 10, marginTop: 4 }}>
          <MartProse text={interpretation} style={{ fontSize: 12 }} />
        </div>
      )}
    </div>
  );
}

/**
 * The STORYLINE — the research as a narrative, not a dashboard (owner's
 * diagnosis: "dashboards exist, the story does not"). Chapters = phases
 * (summary prose), inside — campaigns in order: goal → bets (hypotheses with
 * rationale; registered BEFORE the run — anti-p-hacking is visible) → runs →
 * verdicts (interpretation prose) → conclusions; findings as inserts, method
 * decisions in the margins, epilogue = what's next. Pure projection of the
 * mart — every entity links into its slice.
 */
export function StoryScreen({ runs }: { runs: RunRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const phases = useMartSlice<PhaseRow>('phases', EMPTY_PARAMS);
  const campaigns = useMartSlice<CampaignRow>('campaigns', EMPTY_PARAMS);
  const hypotheses = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);
  const findings = useMartSlice<FindingRow>('findings', EMPTY_PARAMS);
  const decisions = useMartSlice<DecisionRow>('decisions', EMPTY_PARAMS);

  if (phases.unavailable) {
    return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={phases.reload} />;
  }
  if (phases.error) return <PanelMsg kind="error" text={phases.error} onRetry={phases.reload} />;
  if (!phases.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const allCampaigns = campaigns.rows ?? [];
  const allHyps = hypotheses.rows ?? [];
  const allFindings = findings.rows ?? [];
  const allDecisions = decisions.rows ?? [];
  const ordered = [...phases.rows].sort((a, b) => a.phase_id.localeCompare(b.phase_id));

  const plannedCampaigns = allCampaigns.filter(c => c.status === 'planned');
  const openBets = allHyps.filter(h => h.status === 'registered_bet' || h.status === 'open');
  const openFindings = allFindings.filter(f => f.finding_status_id !== 'fixed');

  return (
    <div data-testid="bench-story" style={{ maxWidth: 1080 }}>
      {ordered.map((p, i) => {
        const phaseCampaigns = allCampaigns.filter(c => strArr(c.phase_ids).includes(p.phase_id));
        const phaseCampaignIds = new Set(phaseCampaigns.map(c => c.campaign_id));
        const phaseFindings = allFindings.filter(f => strArr(f.campaigns).some(c => phaseCampaignIds.has(c)));
        const phaseDecisions = allDecisions.filter(d => d.phase_id === p.phase_id);
        const phaseLabel = pickLocale(lang, undefined, p.label_en, p.label, p.label_ru);
        const phaseSummary = pickLocale(lang, p.summary_ru_sci, p.summary_en, p.summary, p.summary_ru);
        const phaseGoal = pickLocale(lang, p.goal_ru_sci, p.goal_en, p.goal, p.goal_ru);

        return (
          <div key={p.phase_id} className="analytics-card" style={{ marginBottom: 14 }}
               data-testid={`story-phase-${p.phase_id}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span className="badge badge-info" style={{ fontFamily: 'var(--mono)' }}>
                {t('bench.story.chapter', 'Chapter')} {i + 1}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>
                {p.phase_id}{phaseLabel ? ` · ${phaseLabel}` : ''}
              </span>
              <StatusBadge tone={phaseTone(p.status)} text={p.status ?? '?'} />
            </div>
            {phaseGoal && <div style={{ fontSize: 12, color: 'var(--t2)', margin: '4px 0' }}>{phaseGoal}</div>}
            {phaseSummary && <MartProse text={phaseSummary} style={{ margin: '6px 0' }} />}

            {phaseCampaigns.map(c => {
              const cHyps = allHyps.filter(h => strArr(h.campaigns).includes(c.campaign_id));
              const cRuns = dedupe(strArr(c.run_ids))
                .map(id => runs.find(r => r.run_id === id))
                .filter((r): r is RunRow => !!r);
              const concl = pickLocale(lang, c.conclusions_ru_sci, c.conclusions_en, c.conclusions, c.conclusions_ru);
              const cAxis = pickLocale(lang, c.contrast_axis_ru_sci, c.contrast_axis_en, c.contrast_axis, c.contrast_axis_ru);
              const cGoal = pickLocale(lang, c.goal_ru_sci, c.goal_en, c.goal, c.goal_ru);
              return (
                <div key={c.campaign_id}
                     style={{ borderLeft: '2px solid var(--bd)', paddingLeft: 14, margin: '12px 0' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>
                      {c.campaign_id}
                    </span>
                    <StatusBadge tone={campaignTone(c.status)} text={c.status ?? '?'} />
                    {cAxis && <span className="scope-tag">{cAxis}</span>}
                  </div>
                  {cGoal && <div style={{ fontSize: 12, color: 'var(--t2)', margin: '2px 0 4px' }}>{cGoal}</div>}

                  {cHyps.length > 0 && (
                    <>
                      <SectionLabel text={t('bench.story.bets', 'Bets (registered before the run)')} />
                      {cHyps.map(h => (
                        <HypothesisBet key={h.hyp_id} h={h} decidedHere={h.decided_on === c.campaign_id} />
                      ))}
                    </>
                  )}
                  {cRuns.length > 0 && (
                    <>
                      <SectionLabel text={t('bench.story.runs', 'Runs (cycles)')} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {cRuns.map(r => <RunLine key={r.run_id} run={r} />)}
                      </div>
                    </>
                  )}
                  {concl && (
                    <div style={{ borderLeft: '3px solid var(--suc)', background: 'var(--bg2)',
                                  padding: '6px 10px', borderRadius: '0 4px 4px 0', marginTop: 8 }}>
                      <MartProse text={concl} />
                    </div>
                  )}
                </div>
              );
            })}

            {phaseFindings.length > 0 && (
              <>
                <SectionLabel text={t('bench.story.findings', 'Findings along the way')} />
                {phaseFindings.map(f => {
                  const narrative = pickLocale(lang, f.narrative_ru_sci, f.narrative_en, f.narrative, f.narrative_ru);
                  return (
                    <details key={f.finding_id} style={{ marginBottom: 4 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                        <Link to={`/benchmark/finding/${encodeURIComponent(f.finding_id)}`}
                              style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', textDecoration: 'none' }}>
                          {f.finding_id}
                        </Link>
                        <span style={{ color: 'var(--t3)' }}> [{f.finding_status_id ?? '?'}] </span>
                        <span style={{ color: 'var(--t2)' }}>{f.title ?? ''}</span>
                      </summary>
                      {narrative && <MartProse text={narrative} style={{ fontSize: 12, padding: '4px 0 0 16px' }} />}
                    </details>
                  );
                })}
              </>
            )}

            {phaseDecisions.length > 0 && (
              <>
                <SectionLabel text={t('bench.story.decisions', 'Method decisions (why we measure this way)')} />
                {phaseDecisions.map(d => {
                  const rationale = pickLocale(lang, d.rationale_ru_sci, d.rationale_en, d.rationale, d.rationale_ru);
                  const decisionText = pickLocale(lang, d.decision_ru_sci, d.decision_en, d.decision, d.decision_ru);
                  return (
                    <details key={d.decision_id} style={{ marginBottom: 4 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{d.decision_id}</span>
                        {d.topic && <span className="scope-tag" style={{ marginLeft: 6 }}>{d.topic}</span>}
                        <span style={{ color: 'var(--t2)' }}> {decisionText ?? ''}</span>
                      </summary>
                      {rationale && <MartProse text={rationale} style={{ fontSize: 12, padding: '4px 0 0 16px' }} />}
                    </details>
                  );
                })}
              </>
            )}
          </div>
        );
      })}

      <div className="analytics-card" style={{ marginBottom: 14 }} data-testid="story-epilogue">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="analytics-card-title">{t('bench.story.epilogue', 'What\'s next')}</div>
          <Link to="/benchmark/references" style={{ fontSize: 11, color: 'var(--acc)', textDecoration: 'none' }}>
            {t('bench.refs.title', 'Bibliography')} →
          </Link>
        </div>
        {plannedCampaigns.length > 0 && (
          <>
            <SectionLabel text={t('bench.story.planned', 'Planned campaigns')} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {plannedCampaigns.map(c => (
                <span key={c.campaign_id} className="scope-tag" title={c.goal ?? ''}>{c.campaign_id}</span>
              ))}
            </div>
          </>
        )}
        {openBets.length > 0 && (
          <>
            <SectionLabel text={t('bench.story.openBets', 'Open bets')} />
            {openBets.map(h => (
              <div key={h.hyp_id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 3 }}>
                <Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`}
                      style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
                  {h.hyp_id}
                </Link>
                <StatusBadge tone={hypothesisTone(h.status)} text={h.status ?? '?'} />
                <span style={{ fontSize: 12, color: 'var(--t2)' }}>{pickLocale(lang, h.statement_ru_sci, h.statement_en, h.statement, h.statement_ru) ?? ''}</span>
              </div>
            ))}
          </>
        )}
        {openFindings.length > 0 && (
          <>
            <SectionLabel text={t('bench.story.openFindings', 'Open findings')} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {openFindings.map(f => (
                <Link key={f.finding_id} to={`/benchmark/finding/${encodeURIComponent(f.finding_id)}`}
                      className="scope-tag" style={{ color: 'var(--acc)', textDecoration: 'none' }}>
                  {f.finding_id} [{f.finding_status_id ?? '?'}]
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
