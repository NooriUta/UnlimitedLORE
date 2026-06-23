package studio.seer.heimdall.bench;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Registry of NAMED read-only slices over the RAGVSDL experiment mart.
 *
 * The browser never sends SQL — only a slice id + whitelisted parameter values.
 * SQL templates live here; values are forwarded via the ArcadeDB {@code params}
 * map (no string concatenation), the value regex below is defence-in-depth.
 *
 * Reading rules baked into the templates (see rag-vs-parse experiment-mart skill):
 * - drift MUST pin model+prompt (otherwise the four Round2 cells mix);
 * - aggregate slices exclude or expose {@code capability} so the client can
 *   keep structural zeros (capability='none') out of averages;
 * - matrix/semantic group BY capability — the client splits zeros into their own row.
 */
public final class MartSlices {

    private MartSlices() {}

    public record SliceDef(String baseSql, List<String> required,
                           Map<String, String> optionalFilters, String suffix) {}

    public record Composed(String sql, Map<String, Object> params) {}

    /** Conservative value whitelist: ids, dates, model names, spaces.
     *  Parentheses are allowed for the namespaced substrate_id form
     *  ({@code Sub:graph(edges)}, {@code Sub:vec(schema:qwen3-rr)}) — safe
     *  because values are bound as ArcadeDB params, never concatenated. */
    static final Pattern VALUE_RE = Pattern.compile("[\\w@.,:+\\-() ]{1,160}");

    private static final Map<String, SliceDef> SLICES = new LinkedHashMap<>();

    private static void slice(String id, String baseSql) {
        SLICES.put(id, new SliceDef(baseSql, List.of(), Map.of(), ""));
    }

    private static void slice(String id, String baseSql, List<String> required,
                              Map<String, String> optional, String suffix) {
        SLICES.put(id, new SliceDef(baseSql, required, optional, suffix));
    }

    static {
        // ── dimensions / navigation ──────────────────────────────────────────
        slice("campaigns",
            "SELECT campaign_id, title, goal, goal_ru_sci, goal_ru, goal_en, " +
            "contrast_axis, contrast_axis_ru_sci, contrast_axis_ru, contrast_axis_en, " +
            "shared_snapshot_id, shared_corpus_id, " +
            "shared_gold_epoch, task_scope, n_cycles, status, started_ts, closed_ts, conclusions, " +
            "conclusions_ru_sci, conclusions_ru, conclusions_en, " +
            "in('RUN_IN_CAMPAIGN').run_id AS run_ids, " +
            "out('CAMPAIGN_IN_PHASE').phase_id AS phase_ids FROM ExpCampaign ORDER BY campaign_id");
        slice("hypotheses",
            "SELECT hyp_id, statement, statement_ru_sci, statement_ru, statement_en, " +
            "metric, threshold, status, evidence, evidence_ru_sci, evidence_ru, evidence_en, " +
            "registered_ts, decided_ts, " +
            "decided_on, rationale, rationale_ru_sci, rationale_ru, rationale_en, " +
            "mechanism, mechanism_ru_sci, mechanism_ru, mechanism_en, " +
            "interpretation, interpretation_ru_sci, interpretation_ru, interpretation_en, " +
            "out('TESTS').campaign_id AS campaigns FROM ExpHypothesis ORDER BY hyp_id");
        slice("findings",
            "SELECT finding_id, title, finding_class_id, finding_status_id, side, snapshot_id, " +
            "evidence, evidence_ru_sci, evidence_ru, evidence_en, " +
            "found_ts, resolved_ts, narrative, narrative_ru_sci, narrative_ru, narrative_en, " +
            "out('YIELDED_BY').campaign_id AS campaigns, " +
            "out('FINDING_DEMONSTRATED_BY').case_id AS demo_cases FROM ExpFinding ORDER BY finding_id");
        slice("runs",
            "SELECT run_id, model, prompt, snapshot_id, corpus_read, started_ts, finished_ts, duration_s, " +
            "n_records, note, cost_usd, tokens_in_total, tokens_out_total FROM ExpRun ORDER BY started_ts DESC");
        // one LLM trace per fact (v6): question + raw_output is the primary
        // verification tool for a model answer (number -> case -> trace)
        slice("trace",
            "SELECT question, raw_output, latency_s, temperature, seed, model, cost_usd, " +
            "tokens_in, tokens_out, prompt_template_id, error_type " +
            "FROM ExpLLMTrace WHERE run_id = :run AND case_id = :case_id AND substrate_id = :substrate",
            List.of("run", "case_id", "substrate"), Map.of(), " LIMIT 5");
        slice("substrates",
            "SELECT substrate_id, short_name, family, status, description, " +
            "description_ru_sci, description_ru, description_en, " +
            "data_layer_id, retrieval_id, " +
            "text_gran_id, reasoner_id, config_rev, builder, code_file, long_description, " +
            "label_ru, label_en, long_description_ru_sci, long_description_ru, long_description_en " +
            "FROM ExpSubstrate ORDER BY substrate_id");
        // v8.1: relevance = how the source shaped OUR method (markdown),
        // group_overview = MD intro of the whole ref_group (same value on
        // every row of the group — the UI takes the first one)
        slice("references",
            "SELECT ref_id, citation, year, venue, link, ref_group, " +
            "takeaway, takeaway_ru_sci, takeaway_ru, takeaway_en, " +
            "relevance, relevance_ru_sci, relevance_ru, relevance_en, " +
            "group_overview, group_overview_ru_sci, group_overview_ru, group_overview_en " +
            "FROM ExpReference ORDER BY ref_group, ref_id");
        // Source links per reference (ExpSource: git/HF/arXiv/doi/…, SRC_OF → ExpReference).
        slice("sources",
            "SELECT source_id, ref_id, kind, url, annotation FROM ExpSource ORDER BY ref_id, kind");
        // ── bibliography graph (BiblioScreen) — references + harmonization map ──
        // These replace the screen's former direct-to-ArcadeDB SQL: the browser
        // now sends NO SQL and NO credentials, going through the mart like the
        // rest of the bench panel.
        slice("biblio_refs",
            "SELECT ref_id, citation, source_role, ref_group, year, link, " +
            "relevance_ru, relevance_ru_sci, relevance_en, relevance, " +
            "takeaway_ru, takeaway_ru_sci, takeaway_en, takeaway, " +
            "group_overview_ru, group_overview_ru_sci, group_overview_en, group_overview " +
            "FROM ExpReference ORDER BY year DESC");
        slice("biblio_nodes",
            "SELECT node_id, kind, title, label_ru, label_en, summary_ru, summary_en, " +
            "description_ru_sci, description_en FROM ExpHarmonizationNode ORDER BY kind DESC, node_id");
        slice("biblio_node_refs",
            "SELECT node_id, outE().@type AS edge_types, outE().inV().ref_id AS to_refs " +
            "FROM ExpHarmonizationNode");
        slice("biblio_topics",
            "SELECT topic_id, label_ru, label_en FROM ExpTopic");
        slice("biblio_ref_topics",
            "SELECT ref_id, out('REF_TOPIC').topic_id AS topics FROM ExpReference");
        slice("biblio_node_edges",
            "SELECT node_id AS from_node, " +
            "outE('HAS_CHILD','GROUNDS','EXTENDS','PARALLELS','INSTRUMENTS').@type AS edge_types, " +
            "outE('HAS_CHILD','GROUNDS','EXTENDS','PARALLELS','INSTRUMENTS').inV().node_id AS to_nodes " +
            "FROM ExpHarmonizationNode");
        // literature grounding of one substrate — edge idiom per the mart skill:
        // expand(out('EDGE')) is the reliable traversal form in ArcadeDB
        slice("substrate_refs",
            "SELECT expand(out('GROUNDED_IN')) FROM ExpSubstrate WHERE substrate_id = :substrate",
            List.of("substrate"), Map.of(), "");
        // v8: SCD2 revision history of one actor — architecture prose snapshot
        // per config_rev with validity window and why it changed
        slice("substrate_revs",
            "SELECT rev_id, config_rev, valid_from, valid_to, is_current, " +
            "change_why, change_why_ru_sci, change_why_ru, change_why_en, " +
            "architecture, architecture_ru_sci, architecture_ru, architecture_en " +
            "FROM ExpSubstrateRev WHERE substrate_id = :substrate ORDER BY valid_from",
            List.of("substrate"), Map.of(), "");
        // v8: revision chains for ALL actors at once — drives the substrates
        // registry (current config_rev comes from SCD2, not the stale dim
        // field). No architecture prose here: the registry stays light, the
        // passport loads the heavy MD per substrate.
        slice("substrate_revs_all",
            "SELECT substrate_id, rev_id, config_rev, valid_from, valid_to, is_current, " +
            "change_why, change_why_ru_sci, change_why_ru, change_why_en " +
            "FROM ExpSubstrateRev ORDER BY substrate_id, valid_from");
        // all measurements of one substrate across runs (substrate page: per-run
        // aggregates + failure taxonomy are computed client-side from raw rows)
        slice("substrate_facts",
            "SELECT run_id, task_id, level_id, hop_kind_id, capability, f1, " +
            "tokens_in, tokens_out, elapsed_s, cost_usd, error_taxonomy, config_rev " +
            "FROM ExpMeasure WHERE substrate_id = :substrate AND metric_applied = 'metric:exact_set'",
            List.of("substrate"), Map.of(), " LIMIT 30000");
        // v8.4 design narrative rides along (N4): cognitive_load ladder,
        // gold_source_type and the MD design_rationale per role
        slice("tasks",
            "SELECT task_id, n_cases, metric_default, what_tests, what_tests_ru_sci, what_tests_ru, what_tests_en, " +
            "label_ru, label_en, status, gated_on, " +
            "cognitive_load, gold_source_type, design_rationale, " +
            "design_rationale_ru_sci, design_rationale_ru, design_rationale_en FROM ExpTask ORDER BY task_id");
        slice("levels",
            "SELECT level_id, gold_graph, description FROM ExpLevel ORDER BY level_id");
        slice("hop_kinds",
            "SELECT hop_kind_id, definition, walk_function, metric_recommended, label_ru, label_en FROM ExpHopKind ORDER BY hop_kind_id");
        slice("snapshots",
            "SELECT snapshot_id, corpus_id, parse_date, col_edges, tbl_edges, " +
            "corpus_condition, corpus_condition_ru_sci, corpus_condition_ru, corpus_condition_en, " +
            "commit_baseline, summary, summary_ru_sci, summary_ru, summary_en " +
            "FROM ExpSnapshot ORDER BY parse_date");
        slice("capabilities",
            "SELECT substrate_id, hop_kind_id, capability, rationale FROM ExpCapability");
        slice("cases_dim",
            "SELECT case_id, task_id, subtype, question, target, target_schema, level_id, hop_kind_id, " +
            "metric_declared, gold_size, depth FROM ExpCase ORDER BY case_id");

        // ── v7 science layer ─────────────────────────────────────────────────
        slice("phases",
            "SELECT phase_id, label, label_ru, label_en, goal, goal_ru_sci, goal_ru, goal_en, summary, " +
            "summary_ru_sci, summary_ru, summary_en, status, started_ts, closed_ts, " +
            "in('CAMPAIGN_IN_PHASE').campaign_id AS campaigns FROM ExpPhase ORDER BY phase_id");
        slice("decisions",
            "SELECT decision_id, decision, decision_ru_sci, decision_ru, decision_en, " +
            "topic, phase_id, rationale, " +
            "rationale_ru_sci, rationale_ru, rationale_en, status, created_ts " +
            "FROM ExpMethodDecision ORDER BY decision_id");
        // gold revisions (SCD2 by snapshot) with the circularity disclaimer —
        // 262 of 296 revisions are graph-extracted with circularity risk and
        // must be visible wherever a verdict can be disputed
        slice("golds",
            "SELECT gold_id, case_id, snapshot_id, gold_count, circularity_risk, " +
            "circularity_rationale, circularity_rationale_ru_sci, circularity_rationale_ru, circularity_rationale_en, " +
            "provenance_type, revised_ts FROM ExpGold ORDER BY case_id");
        slice("gold_verdicts",
            "SELECT verdict_id, gold_id, kind, generated_by, evidence, decided_ts, campaign_id " +
            "FROM ExpGoldVerdict ORDER BY gold_id");

        // ── v8.2 finance layer ───────────────────────────────────────────────
        // Fin-1: prices live ONLY in the mart (ExpPriceEpoch SCD2), never in
        // page code — the V3-tariff incident ($73 -> $37) is the reason
        slice("models",
            "SELECT model_id, provider, endpoint, tier, context_len, max_output, note " +
            "FROM ExpModel ORDER BY model_id");
        slice("price_epochs",
            "SELECT price_id, model_id, price_epoch, in_per_1m, out_per_1m, cache_hit_in_per_1m, " +
            "valid_from, valid_to, as_of, source, is_promo, superseded " +
            "FROM ExpPriceEpoch ORDER BY model_id, valid_from");

        // ── v8.4–8.6 narrative layer (HBR-11, HEIMDALL_NARRATIVE_PAGES.md) ──
        // N1: project header — singleton; every field is MD prose. N-source:
        // not a single narrative string lives in page code.
        slice("project",
            "SELECT project_id, title, " +
            "problem_statement, problem_statement_ru_sci, problem_statement_ru, problem_statement_en, " +
            "central_question, central_question_ru_sci, central_question_ru, central_question_en, " +
            "contribution_gap, contribution_gap_ru_sci, contribution_gap_ru, contribution_gap_en, " +
            "axes_overview, axes_overview_ru_sci, axes_overview_ru, axes_overview_en, " +
            "reproducibility, reproducibility_ru_sci, reproducibility_ru, reproducibility_en " +
            "FROM ExpProject WHERE project_id = 'the'");
        // N2: metric definitions — metric_id is part of every fact's key, this
        // is the legend behind any F1/path_match number on the dashboards
        slice("metrics",
            "SELECT metric_id, name, formula, aggregation, order_sensitive, vs_slice, " +
            "definition, definition_ru_sci, definition_ru, definition_en, label_ru, label_en " +
            "FROM ExpMetric ORDER BY metric_id");
        // N3: risk register; the hyp/finding link edges may be empty until the
        // design loads them — the UI renders an honest empty state (N-source)
        slice("risks",
            "SELECT risk_id, title, label_ru, label_en, category, severity, status, " +
            "description, description_ru_sci, description_ru, description_en, " +
            "mitigation, mitigation_ru_sci, mitigation_ru, mitigation_en, " +
            "out('RISK_AFFECTS_HYP').hyp_id AS affects_hyps, " +
            "out('RISK_FROM_FINDING').finding_id AS from_findings FROM ExpRisk ORDER BY risk_id");
        // N4: subtype axes under each role (level×hop_kind is the honest grain;
        // r2 is heterogeneous — the MIXED flag must stay visible)
        slice("subtypes",
            "SELECT subtype_id, task_id, level_id, hop_kind_id FROM ExpSubtype ORDER BY task_id, subtype_id");
        slice("corpora",
            "SELECT corpus_id, name, corpus_role, files, duplicates, sql_lines, corpus_date, " +
            "description, description_ru, description_en, " +
            "design_rationale, design_rationale_ru_sci, design_rationale_ru, design_rationale_en, " +
            "note, note_ru_sci, note_ru, note_en FROM ExpCorpus ORDER BY corpus_id");

        // ── analytics over the fact table ────────────────────────────────────
        // ArcadeDB quirk (experiment-mart skill, learned 2026-06-11): multi-key
        // GROUP BY silently mis-groups. Analytics therefore ship RAW slim fact
        // rows (no GROUP BY at all) and the client aggregates — matrix, semantic
        // and pareto all derive from the single `facts` slice.
        //
        // Invariant I5 (v7): the mart now carries 5742 SECONDARY facts
        // (metric_applied = path_match / lineage_path, offline re-scoring of the
        // same cases). Every aggregate slice pins metric_applied = 'metric:exact_set' —
        // without the pin every average double-counts cases. Secondary metrics
        // get their own explicit switch when a screen needs them.
        slice("facts",
            "SELECT substrate_id, task_id, level_id, hop_kind_id, capability, f1, " +
            "tokens_in, tokens_out, elapsed_s, cost_usd " +
            "FROM ExpMeasure WHERE run_id = :run AND metric_applied = 'metric:exact_set'",
            List.of("run"), Map.of(), " LIMIT 8000");
        slice("drift",
            // config_rev + run_id ride along: invariant I3 (Д-2 fix) — the client
            // keeps a fact only if its config_rev matches the revision VALID AT
            // THE RUN's started_ts (SCD2 join against substrate_revs_all), not
            // the current one; runs without started_ts are excluded as
            // unresolvable until the Д-1 backfill
            "SELECT substrate_id, task_id, snapshot_id, f1, config_rev, run_id " +
            "FROM ExpMeasure WHERE model = :model AND prompt = :prompt AND capability != 'cap:none' " +
            "AND metric_applied = 'metric:exact_set'",
            List.of("model", "prompt"), Map.of(), " LIMIT 30000");
        slice("dispersion",
            "SELECT substrate_id, run_id, f1 " +
            "FROM ExpMeasure WHERE snapshot_id = :snapshot AND task_id = :task AND capability != 'cap:none' " +
            "AND metric_applied = 'metric:exact_set'",
            List.of("snapshot", "task"), Map.of(), " LIMIT 8000");
        slice("cases",
            "SELECT case_id, substrate_id, task_id, level_id, hop_kind_id, capability, f1, tp, fp, fn, " +
            "abstained, predicted, gold_at_run, tokens_in, tokens_out, elapsed_s, " +
            "cost_usd, error_taxonomy, gold_epoch, llm_called, config_rev " +
            "FROM ExpMeasure WHERE run_id = :run AND metric_applied = 'metric:exact_set'",
            List.of("run"),
            new LinkedHashMap<>(Map.of(
                "substrate", " AND substrate_id = :substrate",
                "task",      " AND task_id = :task",
                "hop_kind",  " AND hop_kind_id = :hop_kind",
                "case_id",   " AND case_id = :case_id")),
            " ORDER BY f1 ASC, case_id ASC LIMIT 5000");

        // ── C+D namespace-migrated dictionaries (2026-06-13) ─────────────────
        slice("aspects",
            "SELECT aspect_id, label_ru, label_en, metric_default, gold_shape, status, origin, ord_rank " +
            "FROM ExpAspect ORDER BY ord_rank, aspect_id");
        slice("categories",
            "SELECT category_id, label_ru, label_en FROM ExpCategory ORDER BY category_id");
        slice("detailed_categories",
            "SELECT dcat_id, label_ru, label_en FROM ExpDetailedCategory ORDER BY dcat_id");
        slice("gold_shapes",
            "SELECT shape_id, label_ru, label_en FROM ExpGoldShape ORDER BY shape_id");
        slice("aspect_origins",
            "SELECT origin_id, label_ru, label_en FROM ExpAspectOrigin ORDER BY origin_id");
    }

    public static Set<String> ids() {
        return SLICES.keySet();
    }

    public static SliceDef get(String id) {
        return SLICES.get(id);
    }

    /**
     * Compose the final SQL + params map for a slice from client-supplied values.
     * @throws IllegalArgumentException on unknown/missing params or bad values
     */
    public static Composed compose(String id, Map<String, String> given) {
        SliceDef def = SLICES.get(id);
        if (def == null) throw new IllegalArgumentException("unknown slice: " + id);

        for (String key : given.keySet()) {
            if (!def.required().contains(key) && !def.optionalFilters().containsKey(key)) {
                throw new IllegalArgumentException("unknown param: " + key);
            }
        }
        for (String key : def.required()) {
            if (given.get(key) == null || given.get(key).isBlank()) {
                throw new IllegalArgumentException("missing required param: " + key);
            }
        }
        Map<String, Object> params = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : given.entrySet()) {
            String value = e.getValue();
            if (value == null || !VALUE_RE.matcher(value).matches()) {
                throw new IllegalArgumentException("bad value for param: " + e.getKey());
            }
            params.put(e.getKey(), value);
        }

        StringBuilder sql = new StringBuilder(def.baseSql());
        for (Map.Entry<String, String> opt : def.optionalFilters().entrySet()) {
            if (given.containsKey(opt.getKey())) sql.append(opt.getValue());
        }
        sql.append(def.suffix());
        return new Composed(sql.toString(), params);
    }
}
