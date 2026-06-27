import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMartSlice } from '../../hooks/useMuninn';
import type {
  CorpusRow, HopKindRow, MetricRow, ProjectRow, RiskRow, SubtypeRow, TaskRow,
} from '../../utils/muninnData';
import { num, pickLocale, severityRank, strArr } from '../../utils/muninnData';
import { MartProse } from './MartProse';
import { PanelMsg, ScreenTitle, StatusBadge } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};
const entityLink: React.CSSProperties = { color: 'var(--acc)', fontFamily: 'var(--mono)', fontSize: 12 };

/**
 * Narrative pages (HBR-11, HEIMDALL_NARRATIVE_PAGES.md): the four blocks that
 * used to live only in the static HTML report and are now machine truth in the
 * mart (v8.4–8.6). Invariant N-source: not a single number or narrative string
 * is hardcoded here — NULL fields render as an empty state, not a stub.
 */

// ── N1 — project header (ExpProject singleton) ──────────────────────────────

export function ProjectScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const project = useMartSlice<ProjectRow>('project', EMPTY_PARAMS);

  if (project.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={project.reload} />;
  if (project.error) return <PanelMsg kind="error" text={project.error} onRetry={project.reload} />;
  if (!project.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;
  const p = project.rows[0];
  if (!p) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;

  const problemStmt = pickLocale(lang, p.problem_statement_ru_sci, p.problem_statement_en, p.problem_statement, p.problem_statement_ru);
  const centralQ    = pickLocale(lang, p.central_question_ru_sci,  p.central_question_en,  p.central_question,  p.central_question_ru);
  const contribGap  = pickLocale(lang, p.contribution_gap_ru_sci,  p.contribution_gap_en,  p.contribution_gap,  p.contribution_gap_ru);
  const repro       = pickLocale(lang, p.reproducibility_ru_sci,   p.reproducibility_en,   p.reproducibility,   p.reproducibility_ru);
  const axesOverview = pickLocale(lang, p.axes_overview_ru_sci, p.axes_overview_en, p.axes_overview, p.axes_overview_ru);

  return (
    <div data-testid="bench-project">
      <ScreenTitle text={p.title ?? t('bench.nar.projectTitle', 'Project')}
                   hint={t('bench.nar.projectHint', 'machine truth from ExpProject')} />

      {problemStmt && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <MartProse text={problemStmt} />
        </div>
      )}

      {centralQ && (
        <div className="analytics-card" data-testid="project-central-question"
             style={{ marginBottom: 12, borderLeft: '3px solid var(--acc)' }}>
          <div className="analytics-card-title">{t('bench.nar.centralQuestion', 'Central question')}</div>
          <MartProse text={centralQ} />
        </div>
      )}

      {contribGap && (
        <div className="analytics-card" style={{ marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.nar.contributionGap', 'Gap in the literature = our contribution')}</div>
          <MartProse text={contribGap} />
        </div>
      )}

      {axesOverview && (
        <div className="analytics-card" style={{ marginBottom: 12 }} data-testid="project-axes">
          <div className="analytics-card-title">{t('bench.nar.axes', 'Comparison axes')}</div>
          <MartProse text={axesOverview} />
        </div>
      )}

      {repro && (
        <details className="analytics-card" style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--t2)', fontSize: 12 }}>
            {t('bench.nar.reproducibility', 'How a run works (reproducibility, as-run)')}
          </summary>
          <MartProse text={repro} />
        </details>
      )}
    </div>
  );
}

// ── N2 — metric definitions (ExpMetric; the legend behind every score) ──────

/** Clickable `metric=…` chip: any score on any screen resolves to a definition. */
export function MetricChip({ metric }: { metric: string }) {
  return (
    <Link to={`/benchmark?tab=metrics&metric=${encodeURIComponent(metric)}`}
          className="scope-tag" data-testid={`metric-chip-${metric}`}
          style={{ textDecoration: 'none' }}
          title="metric definition">
      metric={metric}
    </Link>
  );
}

export function MetricsScreen({ hopKinds, focus }: { hopKinds: HopKindRow[]; focus?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const metrics = useMartSlice<MetricRow>('metrics', EMPTY_PARAMS);
  const focusRef = useRef<HTMLDivElement>(null);

  const recsByMetric = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const hk of hopKinds) {
      const rec = hk.metric_recommended;
      if (!rec) continue;
      if (!m.has(rec)) m.set(rec, []);
      m.get(rec)!.push(hk.hop_kind_id);
    }
    return m;
  }, [hopKinds]);

  useEffect(() => {
    if (focus && focusRef.current) focusRef.current.scrollIntoView?.({ block: 'start' });
  }, [focus, metrics.rows]);

  if (metrics.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={metrics.reload} />;
  if (metrics.error) return <PanelMsg kind="error" text={metrics.error} onRetry={metrics.reload} />;
  if (!metrics.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  return (
    <div data-testid="bench-metrics">
      <ScreenTitle text={t('bench.nar.metricsTitle', 'Metric definitions')}
                   hint={t('bench.nar.metricsHint', 'metric_id is part of every fact\'s key')} />
      {metrics.rows.map(m => {
        const focused = focus === m.metric_id;
        const orderSensitive = m.order_sensitive === true || String(m.order_sensitive) === 'true';
        const def = pickLocale(lang, m.definition_ru_sci, m.definition_en, m.definition, m.definition_ru);
        return (
          <div key={m.metric_id} ref={focused ? focusRef : undefined}
               className="analytics-card" data-testid={`metric-card-${m.metric_id}`}
               style={{ marginBottom: 12, borderLeft: focused ? '3px solid var(--acc)' : undefined }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{m.metric_id}</span>
              <span style={{ color: 'var(--t2)', fontSize: 12 }}>{m.name}</span>
              {orderSensitive && <StatusBadge tone="warn" text={t('bench.nar.orderSensitive', 'order matters')} />}
            </div>
            {m.formula && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t1)',
                            background: 'var(--bg3)', borderRadius: 6, padding: '6px 10px', margin: '8px 0' }}>
                {m.formula}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6 }}>
              {m.aggregation && <span>{t('bench.nar.aggregation', 'aggregation')}: {m.aggregation}</span>}
              {m.vs_slice && <span> · {t('bench.nar.vsSlice', 'vs literature')}: {m.vs_slice}</span>}
            </div>
            {(recsByMetric.get(m.metric_id) ?? []).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t('bench.nar.recommendedFor', 'recommended for hop kinds')}: </span>
                {(recsByMetric.get(m.metric_id) ?? []).map(hk => (
                  <span key={hk} className="scope-tag" style={{ marginRight: 4 }}>{hk}</span>
                ))}
              </div>
            )}
            <MartProse text={def} />
          </div>
        );
      })}
    </div>
  );
}

// ── N3 — risk register (ExpRisk; trust & limits of the whole experiment) ───

function severityDot(severity: string | undefined) {
  const color = severity === 'high' ? 'var(--err)' : severity === 'medium' ? 'var(--wrn)' : 'var(--t3)';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                        background: color, marginRight: 6 }} title={severity ?? '?'} />;
}

function riskStatusTone(status: string | undefined): 'suc' | 'warn' | 'neutral' {
  if (status === 'mitigated') return 'suc';
  if (status === 'mitigating') return 'warn';
  return 'neutral';
}

export function RisksScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const risks = useMartSlice<RiskRow>('risks', EMPTY_PARAMS);

  if (risks.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={risks.reload} />;
  if (risks.error) return <PanelMsg kind="error" text={risks.error} onRetry={risks.reload} />;
  if (!risks.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const sorted = [...risks.rows].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) || a.risk_id.localeCompare(b.risk_id));

  return (
    <div data-testid="bench-risks">
      <ScreenTitle text={t('bench.nar.risksTitle', 'Trust & risks')}
                   hint={t('bench.nar.risksHint', 'ExpRisk register: the threat and how we contain it')} />
      {sorted.map(r => {
        const desc = pickLocale(lang, r.description_ru_sci, r.description_en, r.description, r.description_ru);
        const mit  = pickLocale(lang, r.mitigation_ru_sci,  r.mitigation_en,  r.mitigation,  r.mitigation_ru);
        return (
          <div key={r.risk_id} className="analytics-card" data-testid={`risk-${r.risk_id}`}
               style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              {severityDot(r.severity)}
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{r.risk_id}</span>
              <span style={{ color: 'var(--t2)', fontSize: 12 }}>{r.title}</span>
              {r.category && <span className="scope-tag">{r.category}</span>}
              {r.status && <StatusBadge tone={riskStatusTone(r.status)} text={r.status} />}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              <div style={{ flex: '1 1 320px' }}>
                <div className="analytics-card-title">{t('bench.nar.threat', 'Threat')}</div>
                <MartProse text={desc} />
              </div>
              <div style={{ flex: '1 1 320px' }}>
                <div className="analytics-card-title">{t('bench.nar.mitigation', 'Mitigation')}</div>
                <MartProse text={mit} />
              </div>
            </div>
            {(strArr(r.affects_hyps).length > 0 || strArr(r.from_findings).length > 0) && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
                {strArr(r.affects_hyps).length > 0 && (
                  <span>{t('bench.nar.affectsHyps', 'conditional hypotheses')}: {strArr(r.affects_hyps).map(h => (
                    <Link key={h} to={`/benchmark/hypothesis/${encodeURIComponent(h)}`}
                          style={{ ...entityLink, marginRight: 6 }}>{h}</Link>
                  ))}</span>
                )}
                {strArr(r.from_findings).length > 0 && (
                  <span> · {t('bench.nar.fromFinding', 'born from finding')}: {strArr(r.from_findings).map(f => (
                    <Link key={f} to={`/benchmark/finding/${encodeURIComponent(f)}`}
                          style={{ ...entityLink, marginRight: 6 }}>{f}</Link>
                  ))}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── N4 — design of roles & corpus (ExpTask/ExpSubtype/ExpCorpus) ───────────

export function DesignScreen({ tasks }: { tasks: TaskRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const subtypes = useMartSlice<SubtypeRow>('subtypes', EMPTY_PARAMS);
  const corpora = useMartSlice<CorpusRow>('corpora', EMPTY_PARAMS);
  const [open, setOpen] = useState<string | null>(null);

  const subsByTask = useMemo(() => {
    const m = new Map<string, SubtypeRow[]>();
    for (const s of subtypes.rows ?? []) {
      if (!s.task_id) continue;
      if (!m.has(s.task_id)) m.set(s.task_id, []);
      m.get(s.task_id)!.push(s);
    }
    return m;
  }, [subtypes.rows]);

  const designed = useMemo(() => {
    const seen = new Set<string>();
    return tasks.filter(x => {
      if (!(x.design_rationale || x.cognitive_load)) return false;
      if (seen.has(x.task_id)) return false;
      seen.add(x.task_id);
      return true;
    });
  }, [tasks]);

  return (
    <div data-testid="bench-design">
      <ScreenTitle text={t('bench.nar.designTitle', 'Design — the role ladder and the corpus')}
                   hint={t('bench.nar.designHint', 'why each role exists and why the corpus is built this way')} />

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.nar.roleLadder', 'Role ladder')}</div>
        {designed.length === 0 && <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />}
        {designed.map(task => {
          const mixed = (task.cognitive_load ?? '').includes('MIXED');
          const subs = subsByTask.get(task.task_id) ?? [];
          const expanded = open === task.task_id;
          const designRationale = pickLocale(lang, task.design_rationale_ru_sci, task.design_rationale_en, task.design_rationale, task.design_rationale_ru);
          return (
            <div key={task.task_id} data-testid={`design-role-${task.task_id}`}
                 style={{ borderBottom: '1px solid var(--bd)', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap',
                            cursor: subs.length ? 'pointer' : 'default' }}
                   onClick={() => setOpen(expanded ? null : task.task_id)}>
                <span style={{ color: 'var(--t3)', width: 12 }}>{subs.length ? (expanded ? '▾' : '▸') : ''}</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{task.task_id}</span>
                {task.cognitive_load && (
                  <StatusBadge tone={mixed ? 'warn' : 'neutral'}
                               text={mixed ? `⚠ ${task.cognitive_load}` : task.cognitive_load} />
                )}
                {task.gold_source_type && <span className="scope-tag">gold: {task.gold_source_type}</span>}
                {num(task.n_cases) !== undefined && (
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>n={task.n_cases}</span>
                )}
              </div>
              <MartProse text={designRationale} />
              {expanded && subs.length > 0 && (
                <div style={{ paddingLeft: 20 }}>
                  {subs.map(s => (
                    <div key={s.subtype_id} style={{ fontSize: 12, padding: '2px 0' }}>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{s.subtype_id}</span>
                      <span className="scope-tag" style={{ marginLeft: 6 }}>{s.level_id} · {s.hop_kind_id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="analytics-card" style={{ marginBottom: 12 }}>
        <div className="analytics-card-title">{t('bench.nar.corpusDesign', 'Corpus design')}</div>
        {corpora.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={corpora.reload} />}
        {!corpora.unavailable && corpora.error && <PanelMsg kind="error" text={corpora.error} onRetry={corpora.reload} />}
        {!corpora.unavailable && !corpora.error && !corpora.rows && <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />}
        {(corpora.rows ?? []).filter(c => c.design_rationale || c.description).map(c => {
          const corpDesc   = pickLocale(lang, undefined, c.description_en, c.description, c.description_ru);
          const corpDesign = pickLocale(lang, c.design_rationale_ru_sci, c.design_rationale_en, c.design_rationale, c.design_rationale_ru);
          return (
            <div key={c.corpus_id} data-testid={`design-corpus-${c.corpus_id}`}
                 style={{ borderBottom: '1px solid var(--bd)', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{c.corpus_id}</span>
                {c.corpus_role && <span className="scope-tag">{c.corpus_role}</span>}
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  files={c.files ?? '?'} · dup={c.duplicates ?? '?'} · sql_lines={c.sql_lines ?? '?'}
                </span>
              </div>
              {corpDesc && <MartProse text={corpDesc} />}
              {corpDesign && <MartProse text={corpDesign} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
