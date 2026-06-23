// ── rag-vs-parse experiment panel — types + pure data helpers ─────────────────
// Source of truth: the RAGVSDL experiment mart (ArcadeDB) via /bench/mart named
// slices; the only file-based source is the live STATUS.json of the running cell.
// Mart rows are typed loosely (everything optional) — the mart evolves; render
// what is there. Reading rules (experiment-mart skill): structural zeros
// (capability='cap:none') never enter averages — they are kept as separate rows.

export interface BenchStatus {
  manifest?: string;
  total?: number;
  done?: number;
  current?: string;
  errors?: unknown[];
  elapsed_min?: number;
  updated?: string;
}

// ── locale picker ─────────────────────────────────────────────────────────────

/** RU → ru_sci ?? ru ?? fallback; EN → en ?? fallback. */
export function pickLocale(
  lang: string,
  ru_sci: string | undefined,
  en: string | undefined,
  fallback?: string,
  ru?: string,
): string | undefined {
  return lang === 'ru' ? (ru_sci ?? ru ?? fallback) : (en ?? fallback);
}

// ── mart row shapes (1:1 with MartSlices SQL projections) ─────────────────────

export interface CampaignRow {
  campaign_id: string;
  title?: string;
  goal?: string;
  goal_ru_sci?: string;
  goal_ru?: string;
  goal_en?: string;
  conclusions?: string;
  conclusions_ru_sci?: string;
  conclusions_ru?: string;
  conclusions_en?: string;
  contrast_axis?: string;
  contrast_axis_ru_sci?: string;
  contrast_axis_ru?: string;
  contrast_axis_en?: string;
  shared_snapshot_id?: string;
  shared_corpus_id?: string;
  shared_gold_epoch?: string;
  task_scope?: string[] | string;
  n_cycles?: number;
  status?: string; // planned | running | closed
  started_ts?: string;
  closed_ts?: string;
  run_ids?: string[];
  /** CAMPAIGN_IN_PHASE — which research phase this campaign belongs to (v7) */
  phase_ids?: string[];
}

export interface HypothesisRow {
  hyp_id: string;
  statement?: string;
  statement_ru_sci?: string;
  statement_ru?: string;
  statement_en?: string;
  metric?: string;
  threshold?: string;
  status?: string; // confirmed | refuted | open | registered_bet
  evidence?: string;
  evidence_ru_sci?: string;
  evidence_ru?: string;
  evidence_en?: string;
  registered_ts?: string;
  decided_ts?: string;
  decided_on?: string;
  campaigns?: string[];
  rationale?: string;
  rationale_ru_sci?: string;
  rationale_ru?: string;
  rationale_en?: string;
  mechanism?: string;
  mechanism_ru_sci?: string;
  mechanism_ru?: string;
  mechanism_en?: string;
  interpretation?: string;
  interpretation_ru_sci?: string;
  interpretation_ru?: string;
  interpretation_en?: string;
}

export interface FindingRow {
  finding_id: string;
  title?: string;
  finding_class_id?: string;
  finding_status_id?: string;
  side?: string;
  snapshot_id?: string;
  evidence?: string;
  evidence_ru_sci?: string;
  evidence_ru?: string;
  evidence_en?: string;
  found_ts?: string;
  resolved_ts?: string;
  campaigns?: string[];
  narrative?: string;
  narrative_ru_sci?: string;
  narrative_ru?: string;
  narrative_en?: string;
  /** FINDING_DEMONSTRATED_BY edge targets */
  demo_cases?: string[];
}

export interface RunRow {
  run_id: string;
  model?: string;
  prompt?: string;
  snapshot_id?: string;
  corpus_read?: string;
  started_ts?: string;
  finished_ts?: string;
  duration_s?: number;
  n_records?: number;
  note?: string;
  /** v6 economics rollup (PRICING = estimate) */
  cost_usd?: number;
  tokens_in_total?: number;
  tokens_out_total?: number;
}

/** One LLM call trace (ExpLLMTrace) — 1:1 with a fact when llm_called. */
export interface TraceRow {
  question?: string;
  raw_output?: string;
  latency_s?: number;
  temperature?: number;
  seed?: number;
  model?: string;
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  prompt_template_id?: string;
  error_type?: string | null;
}

export interface SubstrateRow {
  substrate_id: string;
  short_name?: string;
  family?: string;
  status?: string;
  description?: string;
  description_ru_sci?: string;
  description_ru?: string;
  description_en?: string;
  data_layer_id?: string;
  retrieval_id?: string;
  text_gran_id?: string;
  reasoner_id?: string;
  config_rev?: string;
  /** v6: builder function in 23_eval + source file */
  builder?: string;
  code_file?: string;
  long_description?: string;
  label_ru?: string;
  label_en?: string;
  long_description_ru_sci?: string;
  long_description_ru?: string;
  long_description_en?: string;
}

export interface ReferenceRow {
  ref_id: string;
  citation?: string;
  year?: number | string;
  venue?: string;
  link?: string;
  ref_group?: string;
  description?: string;
  description_ru?: string;
  description_en?: string;
  takeaway?: string;
  takeaway_ru_sci?: string;
  takeaway_ru?: string;
  takeaway_en?: string;
  relevance?: string;
  relevance_ru_sci?: string;
  relevance_ru?: string;
  relevance_en?: string;
  group_overview?: string;
  group_overview_ru_sci?: string;
  group_overview_ru?: string;
  group_overview_en?: string;
}

/** A source link (git / HF / arXiv / doi …) attached to a reference (SRC_OF). */
export interface SourceRow {
  source_id: string;
  ref_id?: string;
  kind?: string;        // arxiv | github | huggingface | doi | project | other | status
  url?: string;
  annotation?: string;  // why this source correlates with the paper
}

export interface TaskRow {
  task_id: string;
  n_cases?: number;
  metric_default?: string;
  what_tests?: string;
  what_tests_ru_sci?: string;
  what_tests_ru?: string;
  what_tests_en?: string;
  status?: string;
  gated_on?: string;
  /** v8.4 design narrative (N4): role ladder position; r2 = multi-hop-MIXED */
  cognitive_load?: string;
  gold_source_type?: string; // graph | manual | execution
  design_rationale?: string;
  design_rationale_ru_sci?: string;
  design_rationale_ru?: string;
  design_rationale_en?: string;
  label_ru?: string;
  label_en?: string;
}

// ── v8.4–8.6 narrative layer (HBR-11) — all prose fields are Markdown ──────

export interface ProjectRow {
  project_id: string;
  title?: string;
  problem_statement?: string;
  problem_statement_ru_sci?: string;
  problem_statement_ru?: string;
  problem_statement_en?: string;
  central_question?: string;
  central_question_ru_sci?: string;
  central_question_ru?: string;
  central_question_en?: string;
  contribution_gap?: string;
  contribution_gap_ru_sci?: string;
  contribution_gap_ru?: string;
  contribution_gap_en?: string;
  axes_overview?: string;
  axes_overview_ru_sci?: string;
  axes_overview_ru?: string;
  axes_overview_en?: string;
  reproducibility?: string;
  reproducibility_ru_sci?: string;
  reproducibility_ru?: string;
  reproducibility_en?: string;
}

export interface MetricRow {
  metric_id: string;
  name?: string;
  formula?: string;
  aggregation?: string;
  order_sensitive?: boolean | string;
  vs_slice?: string;
  definition?: string;
  definition_ru_sci?: string;
  definition_ru?: string;
  definition_en?: string;
  label_ru?: string;
  label_en?: string;
}

export interface RiskRow {
  risk_id: string;
  title?: string;
  label_ru?: string;
  label_en?: string;
  category?: string; // validity | measurement | construct | economics
  severity?: string; // high | medium | low
  status?: string;   // open | mitigating | mitigated
  description?: string;
  description_ru_sci?: string;
  description_ru?: string;
  description_en?: string;
  mitigation?: string;
  mitigation_ru_sci?: string;
  mitigation_ru?: string;
  mitigation_en?: string;
  affects_hyps?: string[] | string;
  from_findings?: string[] | string;
}

export interface SubtypeRow {
  subtype_id: string;
  task_id?: string;
  level_id?: string;
  hop_kind_id?: string;
}

export interface CorpusRow {
  corpus_id: string;
  name?: string;
  corpus_role?: string;
  files?: number;
  duplicates?: number;
  sql_lines?: number;
  corpus_date?: string;
  description?: string; // MD — what the corpus is (bilingual)
  description_ru?: string;
  description_en?: string;
  design_rationale?: string; // MD — why it is built this way
  design_rationale_ru_sci?: string;
  design_rationale_ru?: string;
  design_rationale_en?: string;
  note?: string;
  note_ru_sci?: string;
  note_ru?: string;
  note_en?: string;
}

/** Risk severity sort: high first (register B: S1 red, S2 orange, S3 gray). */
export function severityRank(s: string | undefined): number {
  if (s === 'high') return 0;
  if (s === 'medium') return 1;
  if (s === 'low') return 2;
  return 3;
}

export interface SnapshotRow {
  snapshot_id: string;
  corpus_id?: string;
  parse_date?: string;
  col_edges?: number;
  tbl_edges?: number;
  corpus_condition?: string;
  corpus_condition_ru_sci?: string;
  corpus_condition_ru?: string;
  corpus_condition_en?: string;
  commit_baseline?: string;
  summary?: string;
  summary_ru_sci?: string;
  summary_ru?: string;
  summary_en?: string;
}

export interface HopKindRow {
  hop_kind_id: string;
  definition?: string;
  walk_function?: string;
  metric_recommended?: string;
  label_ru?: string;
  label_en?: string;
}

export interface LevelRow {
  level_id: string;
  gold_graph?: string;
  description?: string;
}

export interface CapabilityRow {
  substrate_id: string;
  hop_kind_id: string;
  capability?: string; // native | degraded | none
  rationale?: string;
}

export interface CaseDimRow {
  case_id: string;
  task_id?: string;
  subtype?: string;
  question?: string;
  target?: string;
  target_schema?: string;
  level_id?: string;
  hop_kind_id?: string;
  metric_declared?: string;
  gold_size?: number;
  depth?: number;
}

/**
 * One slim raw fact from the `facts` slice. Analytics arrive UN-aggregated:
 * ArcadeDB multi-key GROUP BY silently mis-groups (mart skill, 2026-06-11),
 * so the server ships raw rows and the pivots below aggregate client-side.
 */
export interface FactRow {
  substrate_id: string;
  task_id?: string;
  level_id?: string;
  hop_kind_id?: string;
  capability?: string;
  f1?: number;
  tokens_in?: number;
  tokens_out?: number;
  elapsed_s?: number;
  /** v6 economics (PRICING = estimate) */
  cost_usd?: number;
}

/** Fact of ONE substrate across runs (substrate page). */
export type SubstrateFactRow = Omit<FactRow, 'substrate_id'> & {
  run_id: string;
  error_taxonomy?: string | null;
  /** substrate revision the fact was measured under (I3, v8) */
  config_rev?: string;
};

/** Evidence footprint of one revision: how much was measured under it. */
export interface RevUsage {
  nFacts: number;
  runs: string[];
  /** mean F1 excluding structural zeros (capability='none' never in averages) */
  meanF1?: number;
}

/** Group a substrate's facts by the revision they were measured under —
 *  ties the SCD2 timeline to its evidence (I3 made visible). */
export function revFactStats(facts: SubstrateFactRow[]): Map<string, RevUsage> {
  const acc = new Map<string, { n: number; runs: Set<string>; sum: number; k: number }>();
  for (const f of facts) {
    if (!f.config_rev) continue;
    const cell = acc.get(f.config_rev) ?? { n: 0, runs: new Set<string>(), sum: 0, k: 0 };
    cell.n += 1;
    if (f.run_id) cell.runs.add(f.run_id);
    if (f.capability !== 'cap:none' && typeof f.f1 === 'number' && Number.isFinite(f.f1)) {
      cell.sum += f.f1;
      cell.k += 1;
    }
    acc.set(f.config_rev, cell);
  }
  const out = new Map<string, RevUsage>();
  for (const [rev, c] of acc) {
    out.set(rev, { nFacts: c.n, runs: [...c.runs].sort(), meanF1: c.k > 0 ? c.sum / c.k : undefined });
  }
  return out;
}

export interface DriftRow {
  substrate_id: string;
  task_id: string;
  snapshot_id: string;
  f1?: number;
  /** substrate revision the fact was measured under (I3) */
  config_rev?: string;
  /** Д-2: the run this fact belongs to — its started_ts anchors the SCD2 epoch */
  run_id?: string;
}

export interface PhaseRow {
  phase_id: string;
  label?: string;
  label_ru?: string;
  label_en?: string;
  goal?: string;
  goal_ru_sci?: string;
  goal_ru?: string;
  goal_en?: string;
  summary?: string;
  summary_ru_sci?: string;
  summary_ru?: string;
  summary_en?: string;
  status?: string; // planned | running | closed
  started_ts?: string;
  closed_ts?: string;
  campaigns?: string[];
}

/** v8.2: paid model — the SOURCE record (Fin-1). */
export interface ModelRow {
  model_id: string;
  provider?: string;
  endpoint?: string;
  tier?: string; // flash | pro
  context_len?: number;
  max_output?: number;
  note?: string;
}

/** v8.2: SCD2 price epoch of a model (Fin-1..5). */
export interface PriceEpochRow {
  price_id: string;
  model_id?: string;
  price_epoch?: string;
  in_per_1m?: number;
  out_per_1m?: number;
  cache_hit_in_per_1m?: number;
  valid_from?: string;
  valid_to?: string | null;
  as_of?: string;
  source?: string;
  is_promo?: boolean;
  superseded?: boolean;
}

/** Recompute one run's cost on an arbitrary price epoch (F2):
 *  tokens_in × in_rate + tokens_out × out_rate, per 1M. Cache-MISS rates —
 *  the result is an UPPER BOUND (Fin-3: hits are not tracked). */
export function runCostAt(
  run: { tokens_in_total?: number; tokens_out_total?: number },
  epoch: PriceEpochRow | undefined,
): number | undefined {
  const tin = num(run.tokens_in_total);
  const tout = num(run.tokens_out_total);
  const inRate = num(epoch?.in_per_1m);
  const outRate = num(epoch?.out_per_1m);
  if (tin === undefined || tout === undefined || inRate === undefined || outRate === undefined) return undefined;
  return (tin * inRate + tout * outRate) / 1_000_000;
}

/** v8: SCD2 revision of an actor — architecture snapshot per config_rev. */
export interface SubstrateRevRow {
  rev_id: string;
  config_rev?: string;
  valid_from?: string;
  valid_to?: string | null;
  is_current?: boolean;
  change_why?: string;
  change_why_ru_sci?: string;
  change_why_ru?: string;
  change_why_en?: string;
  /** markdown prose snapshot of the actor architecture at this revision */
  architecture?: string;
  architecture_ru_sci?: string;
  architecture_ru?: string;
  architecture_en?: string;
}

/** substrate_revs_all slice: revision chains of ALL actors (registry view) */
export interface SubstrateRevAllRow extends SubstrateRevRow {
  substrate_id: string;
}

/** Group substrate_revs_all rows into per-substrate chains (rows arrive
 *  ordered by substrate_id, valid_from from the mart; order is preserved). */
export function groupRevChains(rows: SubstrateRevAllRow[]): Map<string, SubstrateRevAllRow[]> {
  const out = new Map<string, SubstrateRevAllRow[]>();
  for (const r of rows) {
    if (!out.has(r.substrate_id)) out.set(r.substrate_id, []);
    out.get(r.substrate_id)!.push(r);
  }
  return out;
}

export interface GoldRow {
  gold_id: string;
  case_id?: string;
  snapshot_id?: string;
  gold_count?: number;
  /** v7: 262/296 revisions are graph-extracted with circularity risk */
  circularity_risk?: boolean;
  circularity_rationale?: string;
  circularity_rationale_ru_sci?: string;
  circularity_rationale_ru?: string;
  circularity_rationale_en?: string;
  provenance_type?: string | null;
  revised_ts?: string;
}

export interface GoldVerdictRow {
  verdict_id: string;
  gold_id?: string;
  kind?: string; // initial | source_verified | rebuilt | disputed
  generated_by?: string;
  evidence?: string;
  decided_ts?: string;
  campaign_id?: string;
}

export interface GoldInfo {
  risk?: boolean;
  rationale?: string;
  provenance?: string | null;
  verdictKind?: string;
  generatedBy?: string;
}

/** Index gold revisions+verdicts by `case_id@snapshot_id` (= ExpMeasure.gold_epoch). */
export function buildGoldIndex(golds: GoldRow[], verdicts: GoldVerdictRow[]): Map<string, GoldInfo> {
  const verdictByGold = new Map(verdicts.map(v => [v.gold_id, v]));
  const out = new Map<string, GoldInfo>();
  for (const g of golds) {
    if (!g.case_id || !g.snapshot_id) continue;
    const v = verdictByGold.get(g.gold_id);
    out.set(`${g.case_id}@${g.snapshot_id}`, {
      risk: g.circularity_risk,
      rationale: g.circularity_rationale,
      provenance: g.provenance_type,
      verdictKind: v?.kind,
      generatedBy: v?.generated_by,
    });
  }
  return out;
}

export interface DecisionRow {
  decision_id: string;
  decision?: string;
  decision_ru_sci?: string;
  decision_ru?: string;
  decision_en?: string;
  topic?: string;
  phase_id?: string;
  rationale?: string;
  rationale_ru_sci?: string;
  rationale_ru?: string;
  rationale_en?: string;
  status?: string;
  created_ts?: string;
}

export interface DispersionRow {
  substrate_id: string;
  run_id: string;
  f1?: number;
}

export interface CaseRow {
  case_id: string;
  substrate_id?: string;
  task_id?: string;
  level_id?: string;
  hop_kind_id?: string;
  capability?: string;
  f1?: number;
  tp?: number;
  fp?: number;
  fn?: number;
  abstained?: boolean;
  predicted?: string[];
  gold_at_run?: string[];
  tokens_in?: number;
  tokens_out?: number;
  elapsed_s?: number;
  cost_usd?: number;
  error_taxonomy?: string | null;
  gold_epoch?: string;
  llm_called?: boolean;
}

export type CaseWithDim = CaseRow & { dim?: CaseDimRow };

// ── RFC-1 «Strategy advisor»: the §1 map task→optimal substrate ───────────────

export interface AdvisorEntry {
  substrate_id: string;
  f1: number;
  n: number;
  costPerCase?: number;
}

export interface AdvisorCell {
  key: string; // `${level}·${hop}`
  level: string;
  hop: string;
  n: number;
  ranking: AdvisorEntry[]; // desc by f1, structural zeros excluded
  zeros: Array<{ substrate_id: string; n: number }>;
}

/** Build the level·hop decision map from ONE run's raw facts (full pin assumed
 *  by the slice: metric_applied='exact_set'). Structural zeros (capability =
 *  'none') never enter the ranking — they are listed apart (I2). */
export function advisorCells(facts: FactRow[]): AdvisorCell[] {
  const acc = new Map<string, Map<string, { sum: number; n: number; cost: number; zeros: number }>>();
  for (const f of facts) {
    if (!f.level_id || !f.hop_kind_id || !f.substrate_id) continue;
    const key = `${f.level_id}·${f.hop_kind_id}`;
    if (!acc.has(key)) acc.set(key, new Map());
    const bySub = acc.get(key)!;
    const cell = bySub.get(f.substrate_id) ?? { sum: 0, n: 0, cost: 0, zeros: 0 };
    if (f.capability === 'cap:none') {
      cell.zeros += 1;
    } else if (typeof f.f1 === 'number' && Number.isFinite(f.f1)) {
      cell.sum += f.f1;
      cell.n += 1;
      cell.cost += num(f.cost_usd) ?? 0;
    }
    bySub.set(f.substrate_id, cell);
  }
  const cells: AdvisorCell[] = [];
  for (const [key, bySub] of acc) {
    const [level, hop] = key.split('·');
    const ranking: AdvisorEntry[] = [];
    const zeros: Array<{ substrate_id: string; n: number }> = [];
    for (const [sub, c] of bySub) {
      if (c.n > 0) {
        ranking.push({ substrate_id: sub, f1: c.sum / c.n, n: c.n,
                       costPerCase: c.n > 0 ? c.cost / c.n : undefined });
      }
      if (c.zeros > 0) zeros.push({ substrate_id: sub, n: c.zeros });
    }
    ranking.sort((a, b) => b.f1 - a.f1 || a.substrate_id.localeCompare(b.substrate_id));
    const n = Math.max(0, ...ranking.map(r => r.n));
    cells.push({ key, level, hop, n, ranking, zeros });
  }
  const lv = (c: AdvisorCell) => LEVEL_ORDER.indexOf(c.level);
  const hp = (c: AdvisorCell) => HOP_ORDER.indexOf(c.hop);
  cells.sort((a, b) => (lv(a) - lv(b)) || (hp(a) - hp(b)) || a.key.localeCompare(b.key));
  return cells;
}

/** I1 spread: mean F1 per RUN, max−min across runs, per (cell|substrate).
 *  Input: raw facts of each run (same model+prompt pins). */
export function advisorSpread(factsByRun: FactRow[][]): Map<string, number> {
  const perRun: Array<Map<string, { sum: number; n: number }>> = factsByRun.map(facts => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const f of facts) {
      if (!f.level_id || !f.hop_kind_id || !f.substrate_id) continue;
      if (f.capability === 'cap:none' || typeof f.f1 !== 'number' || !Number.isFinite(f.f1)) continue;
      const k = `${f.level_id}·${f.hop_kind_id}|${f.substrate_id}`;
      const c = m.get(k) ?? { sum: 0, n: 0 };
      c.sum += f.f1;
      c.n += 1;
      m.set(k, c);
    }
    return m;
  });
  const out = new Map<string, number>();
  const keys = new Set(perRun.flatMap(m => [...m.keys()]));
  for (const k of keys) {
    const means = perRun.filter(m => m.has(k)).map(m => m.get(k)!.sum / m.get(k)!.n);
    if (means.length >= 2) out.set(k, Math.max(...means) - Math.min(...means));
  }
  return out;
}

/** Honesty disclaimers per cell from the case bank + gold register:
 *  goldRisk — share of circularity_risk golds among the cell's cases;
 *  metricMismatch — n cases whose declared metric ≠ exact_set family. */
export function advisorDisclaimers(
  cases: CaseDimRow[],
  golds: GoldRow[],
): Map<string, { goldRiskShare: number; metricMismatch: number }> {
  const cellOfCase = new Map<string, string>();
  for (const c of cases) {
    if (c.level_id && c.hop_kind_id) cellOfCase.set(c.case_id, `${c.level_id}·${c.hop_kind_id}`);
  }
  const acc = new Map<string, { golds: number; risky: number; mismatch: number }>();
  const bump = (key: string) => {
    if (!acc.has(key)) acc.set(key, { golds: 0, risky: 0, mismatch: 0 });
    return acc.get(key)!;
  };
  for (const g of golds) {
    const key = g.case_id ? cellOfCase.get(g.case_id) : undefined;
    if (!key) continue;
    const c = bump(key);
    c.golds += 1;
    if (g.circularity_risk === true) c.risky += 1;
  }
  for (const cs of cases) {
    const key = cellOfCase.get(cs.case_id);
    if (!key) continue;
    if (cs.metric_declared && !/^(metric:exact_set|metric:set_match)$/.test(cs.metric_declared)) {
      bump(key).mismatch += 1;
    }
  }
  const out = new Map<string, { goldRiskShare: number; metricMismatch: number }>();
  for (const [k, c] of acc) {
    out.set(k, { goldRiskShare: c.golds > 0 ? c.risky / c.golds : 0, metricMismatch: c.mismatch });
  }
  return out;
}

/** HBP-25 gaps map: which engine facet combinations have no actor yet.
 *  The universe is the cartesian product of facet values SEEN in the dim. */
export function engineGaps(substrates: SubstrateRow[]): {
  facets: Record<'data_layer' | 'retrieval' | 'text_gran' | 'reasoner', string[]>;
  total: number;
  instantiated: number;
  missing: string[]; // "layer × retr × gran × reasoner"
} {
  const vals = {
    data_layer: dedupe(substrates.map(s => s.data_layer_id ?? '').filter(Boolean)).sort(),
    retrieval: dedupe(substrates.map(s => s.retrieval_id ?? '').filter(Boolean)).sort(),
    text_gran: dedupe(substrates.map(s => s.text_gran_id ?? '').filter(Boolean)).sort(),
    reasoner: dedupe(substrates.map(s => s.reasoner_id ?? '').filter(Boolean)).sort(),
  };
  const have = new Set(substrates
    .filter(s => s.data_layer_id && s.retrieval_id && s.text_gran_id && s.reasoner_id)
    .map(s => `${s.data_layer_id} × ${s.retrieval_id} × ${s.text_gran_id} × ${s.reasoner_id}`));
  const missing: string[] = [];
  for (const dl of vals.data_layer) for (const r of vals.retrieval)
    for (const tg of vals.text_gran) for (const rs of vals.reasoner) {
      const k = `${dl} × ${r} × ${tg} × ${rs}`;
      if (!have.has(k)) missing.push(k);
    }
  const total = vals.data_layer.length * vals.retrieval.length * vals.text_gran.length * vals.reasoner.length;
  return { facets: vals, total, instantiated: have.size, missing };
}

// ── RFC-2: win/loss of a substrate pair ───────────────────────────────────────

export interface WinLossCell {
  key: string; // level·hop
  aWins: number;
  ties: number;
  bWins: number;
}

export interface WinLossDiff {
  case_id: string;
  key: string;
  a: CaseRow;
  b: CaseRow;
  delta: number; // aF1 − bF1
}

/** Per-case comparison of two substrates on the SAME run: counters A>B /
 *  tie / B>A per level·hop + the divergence list (sorted by |Δ|). Pairs where
 *  either side is a structural zero are skipped (I2 — not a contest). */
export function winLoss(aRows: CaseRow[], bRows: CaseRow[]): {
  cells: WinLossCell[];
  diffs: WinLossDiff[];
  totals: { aWins: number; ties: number; bWins: number; joined: number };
} {
  const byId = new Map(bRows.map(r => [r.case_id, r]));
  const cellAcc = new Map<string, WinLossCell>();
  const diffs: WinLossDiff[] = [];
  const totals = { aWins: 0, ties: 0, bWins: 0, joined: 0 };
  for (const a of aRows) {
    const b = byId.get(a.case_id);
    if (!b) continue;
    if (a.capability === 'cap:none' || b.capability === 'cap:none') continue;
    const af = num(a.f1);
    const bf = num(b.f1);
    if (af === undefined || bf === undefined) continue;
    const key = `${a.level_id ?? '?'}·${a.hop_kind_id ?? '?'}`;
    if (!cellAcc.has(key)) cellAcc.set(key, { key, aWins: 0, ties: 0, bWins: 0 });
    const cell = cellAcc.get(key)!;
    totals.joined += 1;
    const d = af - bf;
    if (Math.abs(d) < 0.0005) { cell.ties += 1; totals.ties += 1; }
    else if (d > 0) { cell.aWins += 1; totals.aWins += 1; diffs.push({ case_id: a.case_id, key, a, b, delta: d }); }
    else { cell.bWins += 1; totals.bWins += 1; diffs.push({ case_id: a.case_id, key, a, b, delta: d }); }
  }
  diffs.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const cells = [...cellAcc.values()].sort((x, y) => {
    const [la, ha] = x.key.split('·');
    const [lb, hb] = y.key.split('·');
    return (LEVEL_ORDER.indexOf(la) - LEVEL_ORDER.indexOf(lb))
      || (HOP_ORDER.indexOf(ha) - HOP_ORDER.indexOf(hb))
      || x.key.localeCompare(y.key);
  });
  return { cells, diffs, totals };
}

// ── RFC-3: reproducing SQL for an aggregate (the §1 cell template) ────────────

export interface CellPins {
  run?: string;
  substrate?: string;
  level?: string;
  hop?: string;
  model?: string;
  prompt?: string;
  snapshot?: string;
  task?: string;
  /** Д-3 epoch series: pin the honest config_rev of a split drift row */
  rev?: string;
}

/** Generate the §1-template SQL that reproduces an aggregate: full pin, no
 *  multi-key GROUP BY (ArcadeDB quirk), structural zeros excluded, I5 metric
 *  pinned. The panel never sends this anywhere — it is for the researcher. */
export function buildCellSql(pins: CellPins): string {
  const where: string[] = [];
  if (pins.run) where.push(`run_id = '${pins.run}'`);
  if (pins.substrate) where.push(`substrate_id = '${pins.substrate}'`);
  if (pins.level) where.push(`level_id = '${pins.level}'`);
  if (pins.hop) where.push(`hop_kind_id = '${pins.hop}'`);
  if (pins.model) where.push(`model = '${pins.model}'`);
  if (pins.prompt) where.push(`prompt = '${pins.prompt}'`);
  if (pins.snapshot) where.push(`snapshot_id = '${pins.snapshot}'`);
  if (pins.task) where.push(`task_id = '${pins.task}'`);
  if (pins.rev) where.push(`config_rev = '${pins.rev}'`);
  where.push(`metric_applied = 'metric:exact_set'`);
  where.push(`capability <> 'cap:none'`);
  return [
    'SELECT avg(f1) AS f1, count(*) AS n, sum(cost_usd) AS usd',
    'FROM ExpMeasure',
    `WHERE ${where.join('\n  AND ')}`,
    `-- структурные нули отдельно: то же WHERE, но capability = 'cap:none' → count(*)`,
  ].join('\n');
}

// ── small coercion helpers (mart values arrive untyped) ───────────────────────

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ── ordering ──────────────────────────────────────────────────────────────────

/** Configuration group order: Sub:graph( / Sub:graphrag( < Sub:vec( < Sub:rag( < others < Sub:ctl( */
export function substrateSortKey(substrate: string): string {
  let group = 3;
  if (substrate.startsWith('Sub:graph(') || substrate.startsWith('Sub:graphrag(')) group = 0;
  else if (substrate.startsWith('Sub:vec(')) group = 1;
  else if (substrate.startsWith('Sub:rag(')) group = 2;
  else if (substrate.startsWith('Sub:ctl(')) group = 4;
  return `${group}:${substrate}`;
}

/** Д-4: the default run is the most COMPLETE one (max n_records), not the
 *  latest by date — opening the matrix on an 8-fact regold run reads empty. */
export function defaultRunId(runs: Array<{ run_id: string; n_records?: number }>): string {
  let best = runs[0]?.run_id ?? '';
  let bestN = num(runs[0]?.n_records) ?? -1;
  for (const r of runs) {
    const n = num(r.n_records) ?? -1;
    if (n > bestN) { best = r.run_id; bestN = n; }
  }
  return best;
}

export const LEVEL_ORDER = ['level:table', 'level:column'];
export const HOP_ORDER = ['hop:direct', 'hop:transitive_set', 'hop:path', 'hop:ultimate_source', 'hop:global', 'hop:negative'];

/** Strip namespace prefix for human-readable labels (e.g. 'hop:direct' → 'direct'). */
export function short(id: string): string {
  return id.includes(':') ? id.split(':').slice(1).join(':') : id;
}

function orderIndex(order: string[], v: string | undefined): number {
  const i = order.indexOf(v ?? '');
  return i === -1 ? order.length : i;
}

// ── aggregation pivots ────────────────────────────────────────────────────────

export interface AggCell {
  n: number;
  f1: number;
}

export interface StructuralZero {
  substrate_id: string;
  key: string; // task_id or level·hop column key
  n: number;
}

/**
 * Aggregate raw facts into one cell per (substrate, column); capability='none'
 * facts are counted into `zeros` instead — structural zeros must never blend
 * into averages (reading rule).
 */
function accumulate(
  cells: Record<string, Record<string, { n: number; sum: number }>>,
  zeros: Map<string, StructuralZero>,
  substrate: string,
  colKey: string,
  capability: string | undefined,
  f1: number | undefined,
): void {
  if (capability === 'cap:none') {
    const key = `${substrate}|${colKey}`;
    const z = zeros.get(key) ?? { substrate_id: substrate, key: colKey, n: 0 };
    z.n += 1;
    zeros.set(key, z);
    return;
  }
  if (f1 === undefined) return;
  const cell = ((cells[substrate] ??= {})[colKey] ??= { n: 0, sum: 0 });
  cell.n += 1;
  cell.sum += f1;
}

function finalize(
  cells: Record<string, Record<string, { n: number; sum: number }>>,
): Record<string, Record<string, AggCell>> {
  const out: Record<string, Record<string, AggCell>> = {};
  for (const [sub, byCol] of Object.entries(cells)) {
    out[sub] = {};
    for (const [col, { n, sum }] of Object.entries(byCol)) {
      out[sub][col] = { n, f1: n > 0 ? sum / n : NaN };
    }
  }
  return out;
}

export interface MatrixPivot {
  substrates: string[];
  tasks: string[];
  cells: Record<string, Record<string, AggCell>>;
  zeros: StructuralZero[];
}

export function pivotMatrix(facts: FactRow[]): MatrixPivot {
  const acc: Record<string, Record<string, { n: number; sum: number }>> = {};
  const zeros = new Map<string, StructuralZero>();
  const tasks = new Set<string>();
  const substrates = new Set<string>();

  for (const r of facts) {
    if (!r.substrate_id || !r.task_id) continue;
    substrates.add(r.substrate_id);
    tasks.add(r.task_id);
    accumulate(acc, zeros, r.substrate_id, r.task_id, r.capability, num(r.f1));
  }
  return {
    substrates: [...substrates].sort((a, b) => substrateSortKey(a).localeCompare(substrateSortKey(b))),
    tasks: [...tasks].sort(),
    cells: finalize(acc),
    zeros: [...zeros.values()],
  };
}

export interface SemanticColumn {
  key: string;
  level: string;
  hop: string;
}

export interface SemanticPivot {
  substrates: string[];
  columns: SemanticColumn[];
  cells: Record<string, Record<string, AggCell>>;
  zeros: StructuralZero[];
}

export function semanticColKey(level: string | undefined, hop: string | undefined): string {
  return `${level ?? '?'}·${hop ?? '?'}`; // level·hop
}

export function pivotSemantic(facts: FactRow[]): SemanticPivot {
  const acc: Record<string, Record<string, { n: number; sum: number }>> = {};
  const zeros = new Map<string, StructuralZero>();
  const substrates = new Set<string>();
  const colMap = new Map<string, SemanticColumn>();

  for (const r of facts) {
    if (!r.substrate_id) continue;
    substrates.add(r.substrate_id);
    const key = semanticColKey(r.level_id, r.hop_kind_id);
    if (!colMap.has(key)) colMap.set(key, { key, level: r.level_id ?? '?', hop: r.hop_kind_id ?? '?' });
    accumulate(acc, zeros, r.substrate_id, key, r.capability, num(r.f1));
  }
  const columns = [...colMap.values()].sort((a, b) =>
    orderIndex(LEVEL_ORDER, a.level) - orderIndex(LEVEL_ORDER, b.level)
    || orderIndex(HOP_ORDER, a.hop) - orderIndex(HOP_ORDER, b.hop)
    || a.key.localeCompare(b.key));
  return {
    substrates: [...substrates].sort((a, b) => substrateSortKey(a).localeCompare(substrateSortKey(b))),
    columns,
    cells: finalize(acc),
    zeros: [...zeros.values()],
  };
}

export interface DriftPivot {
  rows: Array<{ substrate_id: string; task_id: string; key: string }>;
  snapshots: string[];
  cells: Record<string, Record<string, AggCell>>;
}

function parseRevTs(ts: string | null | undefined): number | undefined {
  if (!ts) return undefined;
  const ms = Date.parse(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : undefined;
}

/** Which revision of the actor was valid at the given moment (SCD2 window). */
export function resolveRevAt(
  chain: SubstrateRevAllRow[] | undefined,
  ts: string | null | undefined,
): string | undefined {
  const t = parseRevTs(ts);
  if (t === undefined || !chain?.length) return undefined;
  for (const r of chain) {
    const from = parseRevTs(r.valid_from);
    const to = parseRevTs(r.valid_to);
    if (from !== undefined && t >= from && (to === undefined || t < to)) {
      return r.config_rev ?? r.rev_id;
    }
  }
  return undefined;
}

export interface RevFilterResult {
  kept: DriftRow[];
  /** resolved revision per kept row (parallel to kept) — feeds the Д-3 series split */
  keptRev: Array<string | undefined>;
  /** fact label ≠ revision valid at the run's moment */
  staleExcluded: number;
  /** run has no started_ts — the fact's epoch label cannot be verified (Д-1) */
  unresolvedExcluded: number;
  /** human detail: "substrate: labelled rev ≠ rev at run × n" */
  detail: string[];
}

/**
 * Invariant I3, Д-2 form: a fact is honest for the revision that was VALID AT
 * THE MOMENT OF ITS RUN (SCD2 window vs ExpRun.started_ts) — never compare
 * against the substrate's CURRENT revision: promoting tierA to r2-neg made
 * the honest 562 r1 facts vanish from drift while keeping mislabelled ones.
 * Facts of runs without started_ts are excluded as unresolvable (Д-1).
 */
export function filterRevAtRunTime(
  rows: DriftRow[],
  runStarts: Map<string, string | null | undefined>,
  chains: Map<string, SubstrateRevAllRow[]>,
): RevFilterResult {
  const kept: DriftRow[] = [];
  const keptRev: Array<string | undefined> = [];
  const excl = new Map<string, number>();
  let stale = 0;
  let unresolved = 0;
  for (const r of rows) {
    const chain = chains.get(r.substrate_id);
    // no SCD2 register for this actor, or unlabelled fact — nothing to judge
    if (!chain?.length || r.config_rev === undefined || r.config_rev === null) {
      kept.push(r);
      keptRev.push(r.config_rev ?? undefined);
      continue;
    }
    const ts = r.run_id ? runStarts.get(r.run_id) : undefined;
    if (!ts) {
      unresolved += 1;
      const k = `${r.substrate_id}: ${r.config_rev} (run w/o started_ts)`;
      excl.set(k, (excl.get(k) ?? 0) + 1);
      continue;
    }
    const revAt = resolveRevAt(chain, ts);
    if (revAt === undefined || r.config_rev === revAt) {
      // run predates the register → trust the label; otherwise the label matches
      kept.push(r);
      keptRev.push(revAt ?? r.config_rev);
      continue;
    }
    stale += 1;
    const k = `${r.substrate_id}: ${r.config_rev} ≠ ${revAt}`;
    excl.set(k, (excl.get(k) ?? 0) + 1);
  }
  return {
    kept, keptRev, staleExcluded: stale, unresolvedExcluded: unresolved,
    detail: [...excl.entries()].map(([k, n]) => `${k} × ${n}`),
  };
}

/**
 * Д-3: a revision change is a legitimate axis — when an actor has facts from
 * MORE THAN ONE honest revision, split it into separate series instead of
 * collapsing the epochs into one row. Series ids are `substrate¦rev`
 * (the UI splits on ¦ for the label and the passport link).
 */
export const REV_SERIES_SEP = '¦';
export function splitRevSeries(kept: DriftRow[], keptRev: Array<string | undefined>): DriftRow[] {
  const revsBySub = new Map<string, Set<string>>();
  kept.forEach((r, i) => {
    const rev = keptRev[i];
    if (!rev) return;
    if (!revsBySub.has(r.substrate_id)) revsBySub.set(r.substrate_id, new Set());
    revsBySub.get(r.substrate_id)!.add(rev);
  });
  return kept.map((r, i) => {
    const rev = keptRev[i];
    return rev && (revsBySub.get(r.substrate_id)?.size ?? 0) > 1
      ? { ...r, substrate_id: `${r.substrate_id}${REV_SERIES_SEP}${rev}` }
      : r;
  });
}

/** snapshotOrder — chronological snapshot_id order (from the snapshots slice). */
export function pivotDrift(rows: DriftRow[], snapshotOrder: string[]): DriftPivot {
  const acc = new Map<string, Map<string, { n: number; sum: number }>>();
  const rowKeys = new Map<string, { substrate_id: string; task_id: string; key: string }>();
  const seenSnaps = new Set<string>();

  for (const r of rows) {
    if (!r.substrate_id || !r.task_id || !r.snapshot_id) continue;
    const key = `${r.substrate_id}|${r.task_id}`;
    if (!rowKeys.has(key)) rowKeys.set(key, { substrate_id: r.substrate_id, task_id: r.task_id, key });
    seenSnaps.add(r.snapshot_id);
    const f1 = num(r.f1);
    if (f1 === undefined) continue;
    if (!acc.has(key)) acc.set(key, new Map());
    const bySnap = acc.get(key)!;
    const cell = bySnap.get(r.snapshot_id) ?? { n: 0, sum: 0 };
    cell.n += 1;
    cell.sum += f1;
    bySnap.set(r.snapshot_id, cell);
  }
  const cells: Record<string, Record<string, AggCell>> = {};
  for (const [key, bySnap] of acc) {
    cells[key] = {};
    for (const [snap, { n, sum }] of bySnap) cells[key][snap] = { n, f1: sum / n };
  }
  const known = snapshotOrder.filter(s => seenSnaps.has(s));
  const unknown = [...seenSnaps].filter(s => !snapshotOrder.includes(s)).sort();
  return {
    rows: [...rowKeys.values()].sort((a, b) =>
      substrateSortKey(a.substrate_id).localeCompare(substrateSortKey(b.substrate_id))
      || a.task_id.localeCompare(b.task_id)),
    snapshots: [...known, ...unknown],
    cells,
  };
}

export interface DispersionGroup {
  substrate_id: string;
  points: Array<{ run_id: string; f1: number; n: number }>;
  min: number;
  max: number;
  spread: number;
}

export function groupDispersion(rows: DispersionRow[]): DispersionGroup[] {
  // raw facts in, one avg point per (substrate, run) out
  const acc = new Map<string, Map<string, { n: number; sum: number }>>();
  for (const r of rows) {
    if (!r.substrate_id || !r.run_id) continue;
    const f1 = num(r.f1);
    if (f1 === undefined) continue;
    if (!acc.has(r.substrate_id)) acc.set(r.substrate_id, new Map());
    const byRun = acc.get(r.substrate_id)!;
    const cell = byRun.get(r.run_id) ?? { n: 0, sum: 0 };
    cell.n += 1;
    cell.sum += f1;
    byRun.set(r.run_id, cell);
  }
  return [...acc.entries()]
    .map(([substrate_id, byRun]) => {
      const points = [...byRun.entries()]
        .map(([run_id, { n, sum }]) => ({ run_id, f1: sum / n, n }))
        .sort((a, b) => a.run_id.localeCompare(b.run_id));
      const f1s = points.map(p => p.f1);
      const min = Math.min(...f1s);
      const max = Math.max(...f1s);
      return { substrate_id, points, min, max, spread: max - min };
    })
    .sort((a, b) => b.spread - a.spread || substrateSortKey(a.substrate_id).localeCompare(substrateSortKey(b.substrate_id)));
}

export interface ParetoPoint {
  substrate_id: string;
  x: number;
  f1: number;
  n: number;
}

export function paretoPoints(facts: FactRow[], axis: 'tokens' | 'elapsed' | 'cost'): ParetoPoint[] {
  // raw facts in: sum cost, average f1 per substrate; structural zeros are not
  // "cheap wins" — capability='none' facts are excluded entirely
  const acc = new Map<string, { n: number; sumF1: number; x: number }>();
  for (const r of facts) {
    if (!r.substrate_id || r.capability === 'cap:none') continue;
    const f1 = num(r.f1);
    if (f1 === undefined) continue;
    const cost = axis === 'tokens'
      ? (num(r.tokens_in) ?? 0) + (num(r.tokens_out) ?? 0)
      : axis === 'cost'
        ? (num(r.cost_usd) ?? 0)
        : (num(r.elapsed_s) ?? 0);
    const cell = acc.get(r.substrate_id) ?? { n: 0, sumF1: 0, x: 0 };
    cell.n += 1;
    cell.sumF1 += f1;
    cell.x += cost;
    acc.set(r.substrate_id, cell);
  }
  return [...acc.entries()]
    .map(([substrate_id, { n, sumF1, x }]) => ({ substrate_id, x, f1: sumF1 / n, n }))
    .sort((a, b) => a.x - b.x);
}

export function joinCases(measures: CaseRow[], dim: CaseDimRow[]): CaseWithDim[] {
  const byId = new Map(dim.map(d => [d.case_id, d]));
  return measures.map(m => ({ ...m, dim: byId.get(m.case_id) }));
}

// ── generations: per-snapshot deltas tied to conclusions ─────────────────────

export interface GenerationDelta {
  substrate_id: string;
  task_id: string;
  prev: number;
  cur: number;
  delta: number;
}

/**
 * For each snapshot (chronological), the top F1 movements vs the PREVIOUS
 * generation — computed per (substrate, task) pair present in BOTH generations
 * (mixing task compositions across generations would lie; reading rule).
 * Input: raw drift facts pinned to one model+prompt.
 */
export function generationDeltas(
  rows: DriftRow[],
  snapshotOrder: string[],
  topN = 8,
): Map<string, GenerationDelta[]> {
  const pivot = pivotDrift(rows, snapshotOrder);
  const out = new Map<string, GenerationDelta[]>();

  for (let i = 1; i < pivot.snapshots.length; i++) {
    const prevSnap = pivot.snapshots[i - 1];
    const curSnap = pivot.snapshots[i];
    const deltas: GenerationDelta[] = [];
    for (const row of pivot.rows) {
      const prev = pivot.cells[row.key]?.[prevSnap];
      const cur = pivot.cells[row.key]?.[curSnap];
      if (!prev || !cur) continue; // pair must exist in BOTH generations
      deltas.push({
        substrate_id: row.substrate_id,
        task_id: row.task_id,
        prev: prev.f1,
        cur: cur.f1,
        delta: cur.f1 - prev.f1,
      });
    }
    deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    out.set(curSnap, deltas.slice(0, topN));
  }
  return out;
}

// ── substrate page aggregations (raw substrate_facts in) ──────────────────────

export interface SubstrateRunAgg {
  run_id: string;
  /** scored facts (capability != 'none') */
  n: number;
  f1: number;
  zeros: number;
  costUsd: number;
  tokens: number;
  elapsedS: number;
}

export function aggregateSubstrateRuns(rows: SubstrateFactRow[]): SubstrateRunAgg[] {
  const acc = new Map<string, { n: number; sum: number; zeros: number; cost: number; tok: number; sec: number }>();
  for (const r of rows) {
    if (!r.run_id) continue;
    const cell = acc.get(r.run_id) ?? { n: 0, sum: 0, zeros: 0, cost: 0, tok: 0, sec: 0 };
    if (r.capability === 'cap:none') {
      cell.zeros += 1;
    } else if (num(r.f1) !== undefined) {
      cell.n += 1;
      cell.sum += r.f1 as number;
      cell.cost += num(r.cost_usd) ?? 0;
      cell.tok += (num(r.tokens_in) ?? 0) + (num(r.tokens_out) ?? 0);
      cell.sec += num(r.elapsed_s) ?? 0;
    }
    acc.set(r.run_id, cell);
  }
  return [...acc.entries()]
    .map(([run_id, c]) => ({
      run_id, n: c.n, f1: c.n > 0 ? c.sum / c.n : NaN,
      zeros: c.zeros, costUsd: c.cost, tokens: c.tok, elapsedS: c.sec,
    }))
    .sort((a, b) => a.run_id.localeCompare(b.run_id));
}

export interface TaxonomySlice {
  taxonomy: string;
  n: number;
}

/**
 * Failure-taxonomy distribution (rule-based v0). Empty/null taxonomy = the
 * fact is not a failure ('ok'); structural_zero stays its own bucket — design,
 * not a failure (reading rule).
 */
export function taxonomyDistribution(rows: SubstrateFactRow[], runId?: string): TaxonomySlice[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (runId !== undefined && r.run_id !== runId) continue;
    const key = r.error_taxonomy != null && r.error_taxonomy !== '' ? r.error_taxonomy : 'ok';
    acc.set(key, (acc.get(key) ?? 0) + 1);
  }
  return [...acc.entries()]
    .map(([taxonomy, n]) => ({ taxonomy, n }))
    .sort((a, b) => b.n - a.n || a.taxonomy.localeCompare(b.taxonomy));
}

// ── gold vs predicted diff ────────────────────────────────────────────────────

export interface GoldPredictedDiff {
  /** in both gold and predicted */
  tp: string[];
  /** predicted only */
  fp: string[];
  /** gold only (missing) */
  fn: string[];
}

export function diffGoldPredicted(gold: string[], predicted: string[]): GoldPredictedDiff {
  const goldSet = new Set(gold);
  const predSet = new Set(predicted);
  return {
    tp: [...goldSet].filter(g => predSet.has(g)),
    fp: [...predSet].filter(p => !goldSet.has(p)),
    fn: [...goldSet].filter(g => !predSet.has(g)),
  };
}

// ── F1 color scale (theme-safe: tints of --suc / --wrn / --danger) ────────────

export type F1Band = 'suc' | 'warn' | 'err' | 'neutral';

export function f1Band(f1: number | undefined): F1Band {
  if (f1 === undefined || !Number.isFinite(f1)) return 'neutral';
  if (f1 >= 0.75) return 'suc';
  if (f1 >= 0.5) return 'warn';
  return 'err';
}

/**
 * Owner's UI register A — ONE discrete 5-step quality scale for F1 everywhere
 * (a continuous gradient made 0.541 and 0.785 look alike):
 * ≥0.95 solved · 0.80–0.95 working · 0.50–0.80 partial · 0.20–0.50 weak · <0.20 failure.
 */
export function f1CellBg(f1: number | undefined): string {
  if (f1 === undefined || !Number.isFinite(f1)) return 'transparent';
  if (f1 >= 0.95) return 'color-mix(in srgb, var(--suc) 32%, transparent)';
  if (f1 >= 0.8)  return 'color-mix(in srgb, var(--suc) 14%, transparent)';
  if (f1 >= 0.5)  return 'color-mix(in srgb, var(--wrn) 16%, transparent)';
  if (f1 >= 0.2)  return 'color-mix(in srgb, var(--danger) 12%, transparent)';
  return 'color-mix(in srgb, var(--danger) 30%, transparent)';
}

// ── misc formatting ───────────────────────────────────────────────────────────

export function fmtF1(f1: number | undefined): string {
  return f1 === undefined || !Number.isFinite(f1) ? '—' : f1.toFixed(3);
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatSeconds(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s)) return '—';
  if (s >= 3600) return `${(s / 3600).toFixed(1)}h`;
  if (s >= 60) return `${(s / 60).toFixed(1)}m`;
  return `${s.toFixed(1)}s`;
}

/** "2026-06-10 21:31:09" (local clock of the benchmark machine) → epoch ms. */
export function parseBenchTimestamp(s: string | undefined): number | null {
  if (!s) return null;
  const ms = new Date(s.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 11912s → "3h 18m"; 754s → "12m 34s"; 42s → "42s". */
export function humanizeSeconds(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function formatUsd(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

// ── C+D namespace-migrated dictionary types (2026-06-13) ─────────────────────

export interface AspectRow {
  aspect_id: string;   // asp:*
  label_ru?: string;
  label_en?: string;
  metric_default?: string;
  gold_shape?: string;
  status?: string;     // active | reserve | todo_future
  origin?: string;     // origin:ours | origin:beaver | origin:slice
  ord_rank?: number;
}

export interface CategoryRow {
  category_id: string; // cat:*
  label_ru?: string;
  label_en?: string;
}

export interface DetailedCategoryRow {
  dcat_id: string;     // dcat:*
  label_ru?: string;
  label_en?: string;
}

export interface GoldShapeRow {
  shape_id: string;    // shape:*
  label_ru?: string;
  label_en?: string;
}

export interface AspectOriginRow {
  origin_id: string;   // origin:*
  label_ru?: string;
  label_en?: string;
}
