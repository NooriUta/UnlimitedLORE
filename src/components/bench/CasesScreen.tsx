import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';
import { useMartSlice } from '../../hooks/useMuninn';
import type { CaseDimRow, CaseRow, CaseWithDim, GoldInfo, GoldRow, GoldVerdictRow, HopKindRow, RunRow, SubstrateRow, TaskRow, TraceRow } from '../../utils/muninnData';
import { buildGoldIndex, diffGoldPredicted, f1Band, fmtF1, formatTokens, formatUsd, joinCases, num, strArr } from '../../utils/muninnData';
import { MuninnSelect, Field, PanelMsg, ScreenTitle, StatusBadge, SubstrateLink } from './shared';
import { MetricChip } from './NarrativeScreens';
import type { CasesPreset } from './MatrixScreen';

const EMPTY_PARAMS: Record<string, string> = {};

function DiffChips({ gold, predicted }: { gold: string[]; predicted: string[] }) {
  const diff = diffGoldPredicted(gold, predicted);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {diff.tp.map(g => <span key={`tp-${g}`} className="badge badge-suc" style={{ fontFamily: 'var(--mono)' }}>{g}</span>)}
      {diff.fp.map(p => <span key={`fp-${p}`} className="badge badge-err" style={{ fontFamily: 'var(--mono)' }}>{p}</span>)}
      {diff.fn.map(g => <span key={`fn-${g}`} className="badge badge-warn" style={{ fontFamily: 'var(--mono)' }}>{g}</span>)}
      {diff.tp.length + diff.fp.length + diff.fn.length === 0 && (
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>∅</span>
      )}
    </div>
  );
}

/** LLM trace viewer — fetched lazily on expand (number → case → trace). */
function TraceBlock({ run, c }: { run: string; c: CaseWithDim }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trace = useMartSlice<TraceRow>('trace',
    open && run && c.substrate_id
      ? { run, case_id: c.case_id, substrate: c.substrate_id }
      : null);
  const row = trace.rows?.[0];

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(v => !v)}>
        {open ? '▾' : '▸'} {t('bench.traceTitle', 'LLM trace (question + raw_output)')}
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {trace.loading && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.loading', 'Loading…')}</span>}
          {!trace.loading && trace.rows && !row && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>{t('bench.traceEmpty', 'No trace (deterministic or not loaded into the mart)')}</span>
          )}
          {row && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {row.model && <span className="scope-tag">{row.model}</span>}
                {row.prompt_template_id && <span className="scope-tag">prompt: {row.prompt_template_id}</span>}
                {num(row.temperature) !== undefined && <span className="scope-tag">T={row.temperature}</span>}
                {num(row.latency_s) !== undefined && <span className="scope-tag">{(row.latency_s as number).toFixed(1)}s</span>}
                {num(row.cost_usd) !== undefined && <span className="scope-tag">{formatUsd(num(row.cost_usd))}</span>}
                {row.error_type && <StatusBadge tone="err" text={String(row.error_type)} />}
                <button type="button" className="btn btn-xs btn-ghost"
                        onClick={() => { void navigator.clipboard?.writeText(row.raw_output ?? ''); }}>
                  {t('bench.copy', 'copy raw_output')}
                </button>
              </div>
              {row.question && (
                <pre style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t2)', whiteSpace: 'pre-wrap',
                              background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6,
                              padding: 10, maxHeight: 200, overflow: 'auto', margin: '0 0 6px' }}>
                  {row.question}
                </pre>
              )}
              <pre style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--t1)', whiteSpace: 'pre-wrap',
                            background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6,
                            padding: 10, maxHeight: 280, overflow: 'auto', margin: 0 }}>
                {row.raw_output ?? '∅'}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function CaseDetails({ c, run, runSnapshot, gold }: {
  /** gold revision provenance for this case@epoch (circularity disclaimer) */
  gold?: GoldInfo;
  c: CaseWithDim;
  /** run_id of the slice — needed for the lazy trace fetch */
  run?: string;
  /** the run's parse snapshot — gold_epoch mismatch hints at stale gold (rep1 incident) */
  runSnapshot?: string;
}) {
  const { t } = useTranslation();
  // deterministic substrates (tierA) carry null elapsed_s/cost_usd — guard via num()
  const elapsed = num(c.elapsed_s);
  const cost = num(c.cost_usd);
  const goldStale = !!(c.gold_epoch && runSnapshot && c.gold_epoch !== runSnapshot);
  return (
    <div style={{ padding: '8px 12px 12px 28px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>
      {c.dim?.question && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            {t('bench.question', 'Question')}
          </span>
          <div style={{ fontSize: 'var(--fs-base)', color: 'var(--t1)' }}>{c.dim.question}</div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {c.dim?.target && <span className="scope-tag">{t('bench.target', 'Target')}: {c.dim.target}</span>}
        {c.dim?.subtype && <span className="scope-tag">{c.dim.subtype}</span>}
        {c.level_id && c.hop_kind_id && <span className="scope-tag">{c.level_id}·{c.hop_kind_id}</span>}
        {c.capability && <span className="scope-tag">capability: {c.capability}</span>}
        {/* N2: every score resolves to a metric definition (the cases slice pins exact_set) */}
        <MetricChip metric="exact_set" />
        {c.abstained === true && <StatusBadge tone="warn" text={t('bench.abstained', 'abstained')} />}
        {c.llm_called === false && <StatusBadge tone="neutral" text={t('bench.deterministic', 'deterministic')} />}
        <span className="scope-tag">{t('bench.tokens', 'tokens')}: {formatTokens(num(c.tokens_in))} / {formatTokens(num(c.tokens_out))}</span>
        {elapsed !== undefined && <span className="scope-tag">{elapsed.toFixed(1)}s</span>}
        {cost !== undefined && <span className="scope-tag">{formatUsd(cost)}</span>}
        {c.gold_epoch && !goldStale && <span className="scope-tag" title="gold_epoch">gold: {c.gold_epoch}</span>}
        {goldStale && (
          <span className="badge badge-warn"
                title={t('bench.goldStaleHint',
                  'gold_epoch is older than the run snapshot — possibly scored against stale gold (rep1 incident)')}>
            gold: {c.gold_epoch} ≠ {runSnapshot}
          </span>
        )}
        {gold && gold.risk === true && (
          <span className="badge badge-warn" title={gold.rationale ?? ''}>
            gold ⚠ circularity{gold.verdictKind ? ` · ${gold.verdictKind}` : ''}
          </span>
        )}
        {gold && gold.risk === false && (
          <span className="badge badge-suc" title={gold.generatedBy ?? ''}>
            gold ✓{gold.verdictKind ? ` ${gold.verdictKind}` : ''}
          </span>
        )}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
        {t('bench.goldVsPredicted', 'gold_at_run vs predicted')} — {t('bench.diffLegend', 'TP — in both · FP — predicted only · FN — gold only')}
      </div>
      <DiffChips gold={strArr(c.gold_at_run)} predicted={strArr(c.predicted)} />
      {run && c.llm_called !== false && <TraceBlock run={run} c={c} />}
    </div>
  );
}

/**
 * Screen 6 — case drill-down: ExpMeasure facts joined with the ExpCase
 * dimension; diff highlight of gold_at_run vs predicted.
 */
export function CasesScreen({ runs, substrates, tasks, hopKinds, subLabel, preset }: {
  runs: RunRow[];
  substrates: SubstrateRow[];
  tasks: TaskRow[];
  hopKinds: HopKindRow[];
  subLabel: (id: string) => string;
  /** initial filters from the URL (matrix/semantic cell drill-through) */
  preset?: Partial<CasesPreset>;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState(preset?.run ?? runs[0]?.run_id ?? '');
  const [substrate, setSubstrate] = useState(preset?.substrate ?? '');
  const [task, setTask] = useState(preset?.task ?? '');
  const [hopKind, setHopKind] = useState(preset?.hopKind ?? '');
  // deep-link from finding pages (FINDING_DEMONSTRATED_BY); cleared by changing any filter
  const caseId = preset?.caseId ?? '';
  const [taxonomy, setTaxonomy] = useState('');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = useMemo(() => {
    if (!run) return null;
    const p: Record<string, string> = { run };
    if (substrate) p.substrate = substrate;
    if (task) p.task = task;
    if (hopKind) p.hop_kind = hopKind;
    if (caseId) p.case_id = caseId;
    return p;
  }, [run, substrate, task, hopKind, caseId]);

  const slice = useMartSlice<CaseRow>('cases', params);
  const dim = useMartSlice<CaseDimRow>('cases_dim', EMPTY_PARAMS);
  // gold provenance (v7): 262/296 revisions are graph-extracted with
  // circularity risk — the main methodological disclaimer, must be visible
  const golds = useMartSlice<GoldRow>('golds', EMPTY_PARAMS);
  const goldVerdicts = useMartSlice<GoldVerdictRow>('gold_verdicts', EMPTY_PARAMS);
  const goldIndex = useMemo(
    () => buildGoldIndex(golds.rows ?? [], goldVerdicts.rows ?? []),
    [golds.rows, goldVerdicts.rows],
  );

  const taxonomyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of slice.rows ?? []) {
      if (r.error_taxonomy != null && r.error_taxonomy !== '') set.add(r.error_taxonomy);
    }
    return [...set].sort();
  }, [slice.rows]);

  const rows = useMemo(() => {
    if (!slice.rows) return null;
    const filtered = taxonomy
      ? slice.rows.filter(r => r.error_taxonomy === taxonomy)
      : slice.rows;
    const joined = joinCases(filtered, dim.rows ?? []);
    const q = search.trim().toLowerCase();
    const searched = q
      ? joined.filter(c =>
          c.case_id.toLowerCase().includes(q)
          || (c.dim?.target ?? '').toLowerCase().includes(q)
          || (c.dim?.question ?? '').toLowerCase().includes(q)
          || strArr(c.gold_at_run).some(g => g.toLowerCase().includes(q))
          || strArr(c.predicted).some(p => p.toLowerCase().includes(q)))
      : joined;
    const sorted = [...searched].sort((a, b) => (a.f1 ?? 0) - (b.f1 ?? 0) || a.case_id.localeCompare(b.case_id));
    return sortAsc ? sorted : sorted.reverse();
  }, [slice.rows, dim.rows, sortAsc, taxonomy, search]);

  const runSnapshot = runs.find(r => r.run_id === run)?.snapshot_id;

  const rowKey = (c: CaseWithDim) => `${c.case_id}|${c.substrate_id ?? ''}`;

  return (
    <div data-testid="bench-cases">
      <ScreenTitle text={t('bench.secCases', 'Case drill-down — facts joined with the case dimension')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.run', 'Run')}>
          <MuninnSelect value={run} onChange={setRun}
                       options={runs.map(r => ({ value: r.run_id, label: r.run_id }))} />
        </Field>
        <Field label={t('bench.substrate', 'Substrate')}>
          <MuninnSelect value={substrate} onChange={setSubstrate} allLabel={t('bench.all', 'all')}
                       options={substrates.map(s => ({ value: s.substrate_id, label: subLabel(s.substrate_id) }))} />
        </Field>
        <Field label={t('bench.task', 'Task')}>
          <MuninnSelect value={task} onChange={setTask} allLabel={t('bench.all', 'all')}
                       options={tasks.map(x => ({ value: x.task_id, label: x.task_id }))} />
        </Field>
        <Field label={t('bench.hopKind', 'Hop kind')}>
          <MuninnSelect value={hopKind} onChange={setHopKind} allLabel={t('bench.all', 'all')}
                       options={hopKinds.map(h => ({ value: h.hop_kind_id, label: h.hop_kind_id }))} />
        </Field>
        <Field label={t('bench.filterTaxonomy', 'Failure')}>
          <MuninnSelect value={taxonomy} onChange={setTaxonomy} allLabel={t('bench.all', 'all')}
                       options={taxonomyOptions.map(x => ({ value: x, label: x }))} />
        </Field>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('bench.searchCases', 'case_id / target / geoid…')}
          style={{ background: 'var(--bg2)', color: 'var(--t1)', border: '1px solid var(--bd)',
                   borderRadius: 6, padding: '5px 8px', fontSize: 'var(--fs-base)', fontFamily: 'var(--mono)', width: 190 }}
        />
        {caseId && <span className="scope-tag">case: {caseId}</span>}
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSortAsc(v => !v)}>
          {t('bench.f1', 'F1')} {sortAsc ? '↑' : '↓'}
        </button>
        {rows && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
            {t('bench.casesShown', 'shown')}: {rows.length}
          </span>
        )}
      </div>

      {slice.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={slice.reload} />}
      {!slice.unavailable && slice.error && <PanelMsg kind="error" text={slice.error} onRetry={slice.reload} />}
      {!slice.unavailable && !slice.error && (slice.loading || !rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {!slice.unavailable && !slice.error && !slice.loading && rows && (
        rows.length === 0
          ? <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />
          : (
            <div className="data-panel" data-testid="bench-cases-list">
              <Virtuoso
                style={{ height: 520 }}
                data={rows}
                computeItemKey={(_, c) => rowKey(c)}
                itemContent={(_, c) => {
                  const key = rowKey(c);
                  const open = expanded === key;
                  return (
                    <div>
                      <div
                        onClick={() => setExpanded(open ? null : key)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                                 borderBottom: '1px solid var(--bd)', cursor: 'pointer', fontSize: 'var(--fs-base)' }}>
                        <span style={{ color: 'var(--t3)', width: 12 }}>{open ? '▾' : '▸'}</span>
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)', width: 110 }}>{c.case_id}</span>
                        <span className={`badge badge-${f1Band(c.f1)}`} style={{ fontFamily: 'var(--mono)' }}>
                          {fmtF1(c.f1)}
                        </span>
                        <span className="scope-tag" onClick={e => e.stopPropagation()}>
                          <SubstrateLink id={c.substrate_id ?? ''} label={subLabel(c.substrate_id ?? '')} />
                        </span>
                        {c.task_id && <span className="scope-tag">{c.task_id}</span>}
                        {c.hop_kind_id && <span className="scope-tag">{c.hop_kind_id}</span>}
                        {c.error_taxonomy && <span className="badge badge-warn">{c.error_taxonomy}</span>}
                        <span style={{ flex: 1 }} />
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--t3)' }}
                              title="tp/fp/fn">
                          {c.tp ?? 0}/{c.fp ?? 0}/{c.fn ?? 0}
                        </span>
                      </div>
                      {open && (
                        <CaseDetails c={c} run={run} runSnapshot={runSnapshot}
                                     gold={c.gold_epoch ? goldIndex.get(`${c.case_id}@${c.gold_epoch}`) : undefined} />
                      )}
                    </div>
                  );
                }}
              />
            </div>
          )
      )}
    </div>
  );
}
