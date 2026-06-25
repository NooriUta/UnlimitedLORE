package studio.seer.heimdall.lore;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Registry of named read-only slices over system_aida_lore (ArcadeDB).
 *
 * ArcadeDB constraints (verified against Ygg :2480):
 *  - No UNION support in /api/v1/query endpoint
 *  - No "FROM T a, out('E') b" multi-source join syntax
 *  - Traversal: out("EDGE").field returns array; out("EDGE").field[0] returns scalar
 *  - expand() not available in query endpoint
 *
 * Pattern: MartSlices. Contracts: LORE_SLICES_CONTRACTS.md v1.0.
 */
public final class LoreSlices {

    private LoreSlices() {}

    public record SliceDef(String baseSql, List<String> required,
                           Map<String, String> optionalFilters, String suffix) {}

    public record Composed(String sql, Map<String, Object> params) {}

    /** Conservative value whitelist — ids, dates, semver, module codes, LIKE wildcards. */
    static final Pattern VALUE_RE = Pattern.compile("[\\w@.,:+\\-/ %]{1,160}");

    private static final Map<String, SliceDef> SLICES = new LinkedHashMap<>();

    private static void slice(String id, String baseSql) {
        SLICES.put(id, new SliceDef(baseSql, List.of(), Map.of(), ""));
    }

    private static void slice(String id, String baseSql, List<String> required,
                              Map<String, String> optional, String suffix) {
        SLICES.put(id, new SliceDef(baseSql, required, optional, suffix));
    }

    static {
        // ── §1 Timeline — 3 separate slices, merged on frontend ──────────────
        // No UNION in ArcadeDB /api/v1/query. Frontend fetches all 3, merges by date.

        slice("timeline_adrs",
            "SELECT adr_id, date_created, " +
            "out('BELONGS_TO').component_id[0] AS component " +
            "FROM KnowADR WHERE date_created IS NOT NULL ORDER BY date_created DESC",
            List.of(), Map.of(), " LIMIT 150");

        slice("timeline_decisions",
            "SELECT decision_id, title, date_created FROM KnowDecision " +
            "WHERE date_created IS NOT NULL ORDER BY date_created DESC",
            List.of(), Map.of(), " LIMIT 200");

        slice("timeline_releases",
            "SELECT release_id, git_tag, release_date, is_current, git_project " +
            "FROM KnowRelease ORDER BY release_id DESC",
            List.of(), Map.of(), " LIMIT 100");

        slice("timeline_sprints",
            "SELECT sprint_id, name, " +
            "out('HAS_STATE').valid_from[0] AS valid_from, " +
            "out('HAS_STATE').status_raw[0] AS status_raw " +
            "FROM KnowSprint ORDER BY sprint_id",
            List.of(), Map.of(), " LIMIT 200");

        // ── §2 ADRs ──────────────────────────────────────────────────────────
        slice("adrs",
            "SELECT adr_id, date_created, " +
            "out('BELONGS_TO').component_id[0] AS component " +
            "FROM KnowADR",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE out('BELONGS_TO').component_id[0] = :component")),
            " ORDER BY adr_id");

        // ADR passport — full context with traversals
        slice("adr",
            "SELECT adr_id, file_path, date_created, " +
            "out('HAS_STATE').context_md[0]      AS context_md, " +
            "out('HAS_STATE').decision_md[0]     AS decision_md, " +
            "out('HAS_STATE').consequences_md[0] AS consequences_md, " +
            "out('HAS_STATE').sprint_id[0]       AS sprint_id, " +
            "out('HAS_STATE').valid_from[0]       AS hist_valid_from, " +
            "out('BELONGS_TO').component_id       AS components, " +
            "out('DEPENDS_ON').adr_id             AS depends_on_ids, " +
            "out('IMPLEMENTED_IN').sprint_id      AS implemented_in_ids, " +
            "out('IMPLEMENTED_IN_RELEASE').release_id AS release_ids, " +
            "out('SUPERSEDES').adr_id             AS supersedes_ids, " +
            "out('TAGGED_WITH').tag_id            AS tags " +
            "FROM KnowADR WHERE adr_id = :id",
            List.of("id"), Map.of(), "");

        // SCD2 history chain for one ADR
        slice("adr_history",
            "SELECT valid_from, valid_to, content_hash, source_commit " +
            "FROM KnowADRHist WHERE in('HAS_STATE').adr_id[0] = :id ORDER BY valid_from",
            List.of("id"), Map.of(), "");

        // ── §2 Decisions ─────────────────────────────────────────────────────
        slice("decisions",
            "SELECT decision_id, title, date_created, status_raw FROM KnowDecision ORDER BY decision_id",
            List.of(), Map.of(), " LIMIT 300");

        slice("decision",
            "SELECT decision_id, title, date_created, " +
            "body_md, rationale_md, refs_raw, " +
            "adr_refs, sprint_refs, pr_refs, release_refs, " +
            "out('SUPERSEDES').decision_id AS supersedes_ids " +
            "FROM KnowDecision WHERE decision_id = :id",
            List.of("id"), Map.of(), "");

        // ── §3 Sprints ───────────────────────────────────────────────────────
        // [field IS NOT NULL] filter: skip sparse hist entries where field absent
        slice("sprints",
            "SELECT sprint_id, name, " +
            "out('HAS_STATE')[priority IS NOT NULL].priority[0]     AS priority, " +
            "out('HAS_STATE')[valid_from IS NOT NULL].valid_from[0] AS valid_from, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('HAS_STATE')[pr_refs IS NOT NULL].pr_refs[0]       AS pr_refs, " +
            "out('IMPLEMENTED_IN_RELEASE').release_id   AS release_ids, " +
            "out('IMPLEMENTED_IN_RELEASE').release_date AS release_dates, " +
            "out('HAS_STATE')[status_raw LIKE '✅%' OR status_raw LIKE 'ЗАВЕРШЁН%'].valid_from[0] AS done_date, " +
            "out('BELONGS_TO_PROJECT').slug             AS git_projects " +
            "FROM KnowSprint",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "status", " WHERE out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] LIKE :status")),
            " ORDER BY sprint_id");

        slice("sprint_tree",
            "SELECT sprint_id, name, context_md, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('HAS_STATE')[pr_refs IS NOT NULL].pr_refs[0]       AS pr_refs, " +
            "out('IMPLEMENTED_IN_RELEASE').release_id              AS release_ids, " +
            "out('CONTRIBUTES_TO').milestone_id AS milestone_ids, " +
            "out('DEPENDS_ON').sprint_id AS depends_on, " +
            "out('BELONGS_TO_PROJECT').slug AS git_projects " +
            "FROM KnowSprint WHERE sprint_id = :id",
            List.of("id"), Map.of(), "");

        // Actual completion dates: valid_from of the first hist entry whose status
        // starts with a done marker. Prefix match ('✅%') avoids false positives from
        // TODO statuses that mention DONE in parentheses ("⬜ TODO — (V1 ✅ DONE…)").
        slice("sprint_done_dates",
            "SELECT sprint_id, " +
            "out('HAS_STATE')[status_raw LIKE '✅%' OR status_raw LIKE 'ЗАВЕРШЁН%'].valid_from[0] AS done_date " +
            "FROM KnowSprint " +
            "WHERE out('HAS_STATE')[status_raw LIKE '✅%' OR status_raw LIKE 'ЗАВЕРШЁН%'].size() > 0",
            List.of(), Map.of(), "");

        // Phases of a sprint (via PART_OF edges from phases). The phase title is
        // carried in KnowPhaseHist.status_raw; the latest ingest (4f032cd) left it
        // on the older hist row, so use a [field IS NOT NULL] traversal to recover it.
        slice("phases_of_sprint",
            "SELECT phase_uid, phase_id, order_index, " +
            "out('HAS_STATE')[valid_from IS NOT NULL].valid_from[0]  AS valid_from, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]  AS title, " +
            "out('HAS_STATE')[summary_md IS NOT NULL].summary_md[0]  AS summary_md " +
            "FROM KnowPhase WHERE out('PART_OF').sprint_id[0] = :sprint_id " +
            "ORDER BY order_index",
            List.of("sprint_id"), Map.of(), "");

        // Tasks of a phase
        slice("tasks_of_phase",
            "SELECT task_uid, task_id, title, order_index, " +
            "out('HAS_STATE').effort_days[0] AS effort_days, " +
            "out('HAS_STATE').commit_refs[0] AS commit_refs, " +
            // sparse: a later status flip inserts a note-less open row, so recover the
            // note from whichever hist row carries it — same form as tasks_of_sprint.
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0] AS note_md " +
            "FROM KnowTask WHERE out('IN_PHASE').phase_uid[0] = :phase_uid " +
            "ORDER BY order_index",
            List.of("phase_uid"), Map.of(), "");

        // All tasks of a sprint, directly via PART_OF (covers tasks not bound to a
        // phase — every KnowTask has PART_OF→Sprint, only some have IN_PHASE→Phase).
        // phase_uid is carried so the client can group by phase when present.
        slice("tasks_of_sprint",
            "SELECT task_uid, task_id, title, order_index, " +
            "out('IN_PHASE').phase_uid[0]                            AS phase_uid, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]   AS status_raw, " +
            "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, " +
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0]         AS note_md " +
            "FROM KnowTask WHERE out('PART_OF').sprint_id[0] = :sprint_id " +
            "ORDER BY order_index",
            List.of("sprint_id"), Map.of(), "");

        // ── §3 Milestones ────────────────────────────────────────────────────
        slice("milestones",
            "SELECT milestone_id, label, week, date_display, " +
            "out('HAS_STATE').goal_md[0]      AS goal_md, " +
            "out('HAS_STATE').decisions_md[0] AS decisions_md, " +
            "in('CONTRIBUTES_TO').sprint_id   AS sprint_ids " +
            "FROM KnowMilestone ORDER BY week",
            List.of(), Map.of(), "");

        // ── §4 Search — full-text index required ─────────────────────────────
        // Falls back gracefully if FT index is absent (returns empty)
        slice("search",
            "SELECT 'adr' AS type, adr_id AS ref_id, adr_id AS title " +
            "FROM KnowADR WHERE adr_id LIKE :pattern " +
            "LIMIT 20",
            List.of("pattern"), Map.of(), "");

        // ── §5 Plan ──────────────────────────────────────────────────────────
        slice("plan_config",
            "SELECT config_id, w0_date, weeks_total FROM PlanConfig WHERE config_id = 'default'");

        slice("plan_tracks",
            "SELECT track_id, label, out('OF_TYPE').type_id[0] AS type " +
            "FROM PlanTrack ORDER BY track_id",
            List.of(), Map.of(), "");

        slice("plan_sections",
            "SELECT section_id, label, start_week, end_week, color FROM PlanSection ORDER BY start_week");

        slice("plan_items",
            "SELECT item_id, label, " +
            "out('ON_TRACK').track_id[0]      AS track_id, " +
            "out('HAS_STATE').week_start[0]   AS week_start, " +
            "out('HAS_STATE').week_end[0]     AS week_end, " +
            "out('HAS_STATE').bar_color[0]    AS bar_color, " +
            "out('HAS_STATUS').status[0]      AS status, " +
            "out('REPRESENTS').sprint_id[0]        AS represents_sprint, " +
            "out('CONTRIBUTES_TO').milestone_id[0] AS milestone_id " +
            "FROM PlanItem ORDER BY item_id",
            List.of(), Map.of(), " LIMIT 300");

        slice("plan_checkpoints",
            "SELECT checkpoint_id, label, desc_md, " +
            "out('ON_MILESTONE').milestone_id[0] AS milestone " +
            "FROM PlanCheckpoint ORDER BY checkpoint_id");

        slice("plan_versions",
            "SELECT version_id, version_date, changelog_md FROM PlanVersion ORDER BY version_date DESC");

        // ── §6 Components ────────────────────────────────────────────────────
        slice("components",
            "SELECT component_id, full_name, area, parent_id, game_icon, " +
            "in('PARENT_OF').component_id AS children, " +
            "out('USES').tech_id AS tech " +
            "FROM LoreComponent",
            List.of(),
            new LinkedHashMap<>(Map.of("root", " WHERE parent_id = :root")),
            " ORDER BY full_name");

        slice("component",
            "SELECT component_id, full_name, area, parent_id, game_icon, " +
            "in('PARENT_OF').component_id  AS children, " +
            "out('USES').tech_id            AS tech, " +
            "in('BELONGS_TO').adr_id        AS adrs, " +
            "in('BELONGS_TO').spec_id       AS specs " +
            "FROM LoreComponent WHERE component_id = :id",
            List.of("id"), Map.of(), "");

        // ── §6b Specs (KnowSpec — technical articles, LAL-32) ────────────────
        // content_md/summary live on the SCD2 state row (KnowSpecHist), like ADRs.
        // The vertex `title` is backfilled from the content_md heading by
        // lore-backfill-spec-titles.mjs; until then the frontend falls back to spec_id.
        slice("specs",
            "SELECT spec_id, title, file_path, " +
            "out('BELONGS_TO').component_id[0] AS component_id " +
            "FROM KnowSpec",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE out('BELONGS_TO').component_id[0] = :component")),
            " ORDER BY spec_id LIMIT 400");

        slice("spec_by_id",
            "SELECT spec_id, title, file_path, " +
            "out('HAS_STATE').content_md[0]    AS content_md, " +
            "out('HAS_STATE').summary[0]       AS summary, " +
            "out('HAS_STATE').version[0]       AS version, " +
            "out('HAS_STATE').valid_from[0]    AS valid_from, " +
            "out('BELONGS_TO').component_id[0] AS component_id " +
            "FROM KnowSpec WHERE spec_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── §7 History (SCD2 chain) ───────────────────────────────────────────
        slice("history_sprint",
            "SELECT valid_from, valid_to, content_hash, source_commit, status_raw " +
            "FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id[0] = :id ORDER BY valid_from",
            List.of("id"), Map.of(), "");

        slice("history_plan_item",
            "SELECT valid_from, valid_to, week_start, week_end, content_hash " +
            "FROM PlanItemHist WHERE in('HAS_STATE').item_id[0] = :id ORDER BY valid_from",
            List.of("id"), Map.of(), "");

        // ── §8 KnowDoc — HTML/MD document fragments (Phase 5 LAL-30) ────────
        // Schema added in Phase 5; slices registered now so the frontend can
        // query gracefully (returns [] until KnowDoc vertices are ingested).
        slice("docs",
            "SELECT doc_id, title, kind, has_ext_deps, " +
            "out('BELONGS_TO').component_id[0] AS component_id " +
            "FROM KnowDoc",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE out('BELONGS_TO').component_id[0] = :component")),
            " ORDER BY doc_id LIMIT 200");

        slice("doc_by_id",
            "SELECT doc_id, title, kind, has_ext_deps, content_html, " +
            "out('HAS_HIST').valid_from[0] AS valid_from " +
            "FROM KnowDoc WHERE doc_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── §9 KnowRunbook (Phase 5 LAL-29) ─────────────────────────────────
        slice("runbooks",
            "SELECT runbook_id, name, area, date_created FROM KnowRunbook",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "area", " WHERE area = :area")),
            " ORDER BY runbook_id LIMIT 100");

        slice("runbook_by_id",
            "SELECT runbook_id, name, area, date_created, content_md " +
            "FROM KnowRunbook WHERE runbook_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── §10 QualityGate (Phase 5 LAL-28) ─────────────────────────────────
        slice("quality_gates",
            "SELECT qg_id, name, description, component_id, status, date_created " +
            "FROM QualityGate",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE component_id = :component")),
            " ORDER BY qg_id LIMIT 100");

        slice("quality_gate_by_id",
            "SELECT qg_id, name, description, component_id, status, date_created, content_md " +
            "FROM QualityGate WHERE qg_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        slice("qg_metrics",
            "SELECT metric_id, name, threshold " +
            "FROM QGMetric WHERE in('MEASURED_BY').qg_id[0] = :qg_id",
            List.of("qg_id"), Map.of(), " LIMIT 100");

        // ── §11 KnowTask standalone (Phase 5 LAL-31) ─────────────────────────
        slice("backlog_tasks",
            "SELECT task_uid, task_id, title, status_raw, priority, component_id " +
            "FROM KnowTask WHERE in('PART_OF') IS NULL",
            List.of(), Map.of(), " ORDER BY task_uid LIMIT 200");

        // ── §12 KnowFinding (Phase 5 LAL-31) ─────────────────────────────────
        slice("findings",
            "SELECT finding_id, type, verified, source_sprint " +
            "FROM KnowFinding",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "type", " WHERE type = :type")),
            " ORDER BY finding_id LIMIT 100");

        slice("finding_by_id",
            "SELECT finding_id, type, verified, source_sprint, summary_md, evidence_md " +
            "FROM KnowFinding WHERE finding_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── Releases ─────────────────────────────────────────────────────────
        slice("releases",
            "SELECT release_id, release_uid, git_tag, version, week, type, " +
            "release_date, is_current, description_md, git_project, " +
            "in('IMPLEMENTED_IN_RELEASE').size() AS sprint_count, " +
            "in('SHIPPED_IN').size() AS pr_count " +
            "FROM KnowRelease ORDER BY release_id DESC",
            List.of(), Map.of(), " LIMIT 200");

        slice("release_decisions",
            "SELECT decision_id, title, status_raw FROM KnowDecision " +
            "WHERE release_refs CONTAINS :tag ORDER BY decision_id",
            List.of("tag"), Map.of(), "");

        // Sprints linked to a given release via IMPLEMENTED_IN_RELEASE edge.
        // Prefer ruid (release_uid, e.g. "NooriUta/AIDA#v1.0.0") for multi-project safety.
        // Falls back to tag (release_id) when ruid is absent (legacy callers).
        slice("release_sprints",
            "SELECT sprint_id, name, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw " +
            "FROM KnowSprint WHERE out('IMPLEMENTED_IN_RELEASE').release_uid CONTAINS :ruid",
            List.of("ruid"), Map.of(), " LIMIT 50");

        slice("release_sprints_by_tag",
            "SELECT sprint_id, name, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw " +
            "FROM KnowSprint WHERE out('IMPLEMENTED_IN_RELEASE').release_id CONTAINS :tag",
            List.of("tag"), Map.of(), " LIMIT 50");

        // PRs shipped in a given release via the SHIPPED_IN edge (KnowPR → KnowRelease).
        // Prefer ruid for multi-project safety.
        slice("release_prs",
            "SELECT pr_number, pr_uid, git_project, title, merged_at, url " +
            "FROM KnowPR WHERE out('SHIPPED_IN').release_uid CONTAINS :ruid ORDER BY pr_number",
            List.of("ruid"), Map.of(), " LIMIT 100");

        slice("release_prs_by_tag",
            "SELECT pr_number, pr_uid, git_project, title, merged_at, url " +
            "FROM KnowPR WHERE out('SHIPPED_IN').release_id CONTAINS :tag ORDER BY pr_number",
            List.of("tag"), Map.of(), " LIMIT 100");
    }

    public static Set<String> ids() { return SLICES.keySet(); }

    public static SliceDef get(String id) { return SLICES.get(id); }

    public static Composed compose(String id, Map<String, String> given) {
        SliceDef def = SLICES.get(id);
        if (def == null) throw new IllegalArgumentException("unknown slice: " + id);

        for (String key : given.keySet()) {
            if (!def.required().contains(key) && !def.optionalFilters().containsKey(key))
                throw new IllegalArgumentException("unknown param: " + key);
        }
        for (String key : def.required()) {
            if (given.get(key) == null || given.get(key).isBlank())
                throw new IllegalArgumentException("missing required param: " + key);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : given.entrySet()) {
            String value = e.getValue();
            if (value == null || !VALUE_RE.matcher(value).matches())
                throw new IllegalArgumentException("bad value for param: " + e.getKey());
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
