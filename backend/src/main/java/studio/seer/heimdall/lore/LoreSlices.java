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

    /**
     * Conservative value whitelist — ids, dates, semver, module codes, LIKE wildcards,
     * release_uid (contains #), а также ПОИСКОВЫЕ ЗАПРОСЫ пользователя.
     *
     * UNICODE_CHARACTER_CLASS обязателен: без него java-шный `\w` — это ASCII-только
     * [a-zA-Z_0-9], поэтому любой запрос на кириллице отбивался как BAD_PARAMS (400),
     * и сквозной поиск по русскоязычной базе не работал в принципе. Флаг расширяет
     * \w до юникодных букв/цифр; набор пунктуации и лимит длины НЕ меняются — кавычек,
     * точки с запятой и скобок в whitelist по-прежнему нет, так что поверхность
     * инъекции та же (плюс значения уходят связанными параметрами, не конкатенацией).
     */
    static final Pattern VALUE_RE =
        Pattern.compile("[\\w@.,:+\\-/ %#]{1,160}", Pattern.UNICODE_CHARACTER_CLASS);

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
            "SELECT adr_id, name, status, date_created, " +
            "out('BELONGS_TO').component_id[0] AS component, " +
            "out('BELONGS_TO').component_id    AS components, " +
            "out('TAGGED_WITH').tag_id         AS tags, " +
            "out('BELONGS_TO_PROJECT').slug    AS git_projects, " + // ADRPROJ-01
            "in('DECIDED_IN').size()           AS decision_count " +
            "FROM KnowADR",
            List.of(),
            new LinkedHashMap<>(Map.of(
                // CONTAINS, не [0]: у сущности может быть несколько BELONGS_TO, а
                // порядок рёбер — это порядок вставки, не приоритет. Сравнение с [0]
                // делало сущность видимой только под одним произвольным компонентом.
                "component", " WHERE out('BELONGS_TO').component_id CONTAINS :component")),
            " ORDER BY adr_id");

        // ADR passport — full context with traversals
        slice("adr",
            "SELECT adr_id, name, status, file_path, date_created, " +
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
            "out('TAGGED_WITH').tag_id            AS tags, " +
            "out('BELONGS_TO_PROJECT').slug       AS git_projects " + // ADRPROJ-01
            "FROM KnowADR WHERE adr_id = :id",
            List.of("id"), Map.of(), "");

        // SCD2 history chain for one ADR. AL-30: ревизия версионирует ВСЁ — слайс
        // обязан отдавать тела, а не только хэш; иначе история из 200 ревизий тел
        // показывала прочерки. content_hash (SV-10) = дешёвый «менялось ли», тела =
        // «что именно» для пополевого диффа в UI.
        slice("adr_history",
            "SELECT valid_from, valid_to, content_hash, source_commit, " +
            "context_md, decision_md, consequences_md " +
            "FROM KnowADRHist WHERE in('HAS_STATE').adr_id[0] = :id ORDER BY valid_from",
            List.of("id"), Map.of(), "");

        // ── §2 Decisions ─────────────────────────────────────────────────────
        // ADR-019: KnowDecision as child of ADR. component_id/tags are filter axes,
        // parent_adr (out DECIDED_IN) is the "rule → why" link. ORDER BY/LIMIT live
        // in the suffix so a future optional WHERE lands before them.
        slice("decisions",
            "SELECT decision_id, title, date_created, status_raw, component_id, " +
            "out('BELONGS_TO').component_id     AS components, " +
            "out('BELONGS_TO_PROJECT').slug     AS projects, " +
            "out('TAGGED_WITH').tag_id  AS tags, " +
            "out('DECIDED_IN').adr_id[0] AS parent_adr " +
            "FROM KnowDecision",
            List.of(), Map.of(), " ORDER BY decision_id LIMIT 300");

        // Decisions that belong to one ADR (in('DECIDED_IN') from the ADR side).
        slice("decisions_of_adr",
            "SELECT decision_id, title, date_created, status_raw, component_id, " +
            "out('BELONGS_TO').component_id AS components, " +
            "out('BELONGS_TO_PROJECT').slug AS projects, " +
            "out('TAGGED_WITH').tag_id AS tags " +
            "FROM KnowDecision WHERE out('DECIDED_IN').adr_id[0] = :id ORDER BY decision_id",
            List.of("id"), Map.of(), "");

        slice("decision",
            "SELECT decision_id, title, date_created, " +
            "body_md, rationale_md, refs_raw, " +
            "adr_refs, sprint_refs, pr_refs, release_refs, " +
            "out('SUPERSEDES').decision_id AS supersedes_ids " +
            "FROM KnowDecision WHERE decision_id = :id",
            List.of("id"), Map.of(), "");

        // ── ADR-LORE-018 T21: files referenced (EDITED_IN) by a task ──────────
        // Returns the project's hosts[]/default_branch alongside, so the client
        // composes file URLs (+ "open in mirror") in one fetch, no second call.
        slice("files_of_task",
            "SELECT project, file_path, summary_md, " +
            "out('BELONGS_TO_PROJECT').hosts[0]          AS project_hosts, " +
            "out('BELONGS_TO_PROJECT').default_branch[0] AS project_default_branch " +
            "FROM KnowFile WHERE out('EDITED_IN').task_uid CONTAINS :id ORDER BY file_path",
            List.of("id"), Map.of(), "");

        // ── ADR-020/021 T25: open-questions register (ОВ) ─────────────────────
        // Derived overdue/blocking/age are computed on the client from the raw
        // fields (status/due_date + gating_tasks) — never stored.
        slice("open_questions",
            // `trigger` В ОБРАТНЫХ КАВЫЧКАХ — зарезервированное слово SQL ArcadeDB
            // (голое имя даёт CommandSQLParsingException, тот же капкан, что в
            // write-path LoreQuestionResource).
            // Поле выдаётся, потому что по ADR-LORE-021-D3 условие возврата — это
            // ВЕСЬ смысл deferred: без него отложенный вопрос неотличим от
            // забытого, и реестр гниёт в свалку отложенного.
            "SELECT question_id, title, body_md, status, `trigger`, component_id, due_date, priority, owner, " +
            "raised_by, opened_date, closed_date, " +
            "out('BELONGS_TO').component_id AS components, " +
            "out('BELONGS_TO_PROJECT').slug AS projects, " +
            "out('GATES').task_uid      AS gating_tasks, " +
            "out('RAISED_IN').adr_id    AS raised_adr, " +
            "out('RAISED_IN').sprint_id AS raised_sprint, " +
            "in('ANSWERS').decision_id  AS answered_by " +
            "FROM KnowQuestion",
            List.of(), Map.of(), " ORDER BY question_id");

        slice("questions_of_adr",
            "SELECT question_id, title, status, component_id, due_date, priority, " +
            "out('BELONGS_TO').component_id AS components, " +
            "out('BELONGS_TO_PROJECT').slug AS projects " +
            "FROM KnowQuestion WHERE out('RAISED_IN').adr_id CONTAINS :id ORDER BY question_id",
            List.of("id"), Map.of(), "");

        slice("questions_of_sprint",
            "SELECT question_id, title, status, component_id, due_date, priority " +
            "FROM KnowQuestion WHERE out('RAISED_IN').sprint_id CONTAINS :id ORDER BY question_id",
            List.of("id"), Map.of(), "");

        slice("gating_questions_of_task",
            "SELECT question_id, title, status, priority " +
            "FROM KnowQuestion WHERE out('GATES').task_uid CONTAINS :id AND status <> 'closed' ORDER BY question_id",
            List.of("id"), Map.of(), "");

        // ── §3 Sprints ───────────────────────────────────────────────────────
        // [field IS NOT NULL] filter: skip sparse hist entries where field absent
        slice("sprints",
            "SELECT sprint_id, name, created_date, no_release_required, " +
            "out('HAS_STATE')[priority IS NOT NULL].priority[0]     AS priority, " +
            "out('HAS_STATE')[valid_from IS NOT NULL].valid_from[0] AS valid_from, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('HAS_STATE')[pr_refs IS NOT NULL].pr_refs[0]       AS pr_refs, " +
            "out('IMPLEMENTED_IN_RELEASE').release_id   AS release_ids, " +
            "out('IMPLEMENTED_IN_RELEASE').release_date AS release_dates, " +
            "out('HAS_STATE')[status_raw LIKE '✅%' OR status_raw LIKE 'ЗАВЕРШЁН%'].valid_from[0] AS done_date, " +
            "out('BELONGS_TO_PROJECT').slug             AS git_projects, " +
            "out('BELONGS_TO')[component_id IS NOT NULL].component_id AS components, " +
            "out('TARGETS_MILESTONE').milestone_id AS milestone_ids, " +
            // SPRINT_PLANITEM_RETIRE: planned_start_date/planned_end_date/track_id
            // are plain SCD2-tracked fields on KnowSprintHist (set via
            // /lore/sprint/plan) — no more PlanItem hop. planned_milestone_id
            // retired (drifted vs. milestone_ids above on 62+ sprints) — the
            // TARGETS_MILESTONE edge is the sole source of truth now.
            "out('HAS_STATE')[planned_start_date IS NOT NULL].planned_start_date[0]     AS planned_start_date, " +
            "out('HAS_STATE')[planned_end_date IS NOT NULL].planned_end_date[0]         AS planned_end_date, " +
            "out('HAS_STATE')[track_id IS NOT NULL].track_id[0]                         AS track_id, " +
            "context_md " +
            "FROM KnowSprint",
            List.of(),
            // ADR-LORE-017 (T16): optional `project` filter — Tier 1 (Sprint has a direct
            // BELONGS_TO_PROJECT edge) read-scoping. KNOWN LIMITATION: compose() appends
            // every supplied optional filter's raw SQL fragment in registration order with
            // no AND-joining (see LoreSlices.compose()) — every slice in this file has
            // exactly one active optional filter by convention, so this has never mattered
            // before. Passing BOTH status AND project on this slice in the same call would
            // concatenate two "WHERE" clauses into invalid SQL. Not fixed here (would touch
            // all 10 existing optionalFilters registrations); flagged for whoever adds a
            // second simultaneously-usable filter to any slice.
            new LinkedHashMap<>(Map.of(
                "status", " WHERE out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] LIKE :status",
                "project", " WHERE out('BELONGS_TO_PROJECT').slug CONTAINS :project")),
            " ORDER BY sprint_id");

        slice("sprint_tree",
            "SELECT sprint_id, name, context_md, created_date, no_release_required, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('HAS_STATE')[pr_refs IS NOT NULL].pr_refs[0]       AS pr_refs, " +
            "out('HAS_STATE')[priority IS NOT NULL].priority[0]     AS priority, " +
            "out('IMPLEMENTED_IN_RELEASE').release_id              AS release_ids, " +
            "out('TARGETS_MILESTONE').milestone_id AS milestone_ids, " +
            "out('HAS_STATE')[planned_start_date IS NOT NULL].planned_start_date[0]     AS planned_start_date, " +
            "out('HAS_STATE')[planned_end_date IS NOT NULL].planned_end_date[0]         AS planned_end_date, " +
            "out('DEPENDS_ON').sprint_id   AS depends_on, " +
            "in('DEPENDS_ON').sprint_id    AS blocks, " +
            "out('BELONGS_TO').component_id AS components, " +
            "out('BELONGS_TO_PROJECT').slug AS git_projects, " +
            // reverse of ADR's IMPLEMENTED_IN (ADR → Sprint) — which ADRs this
            // sprint implements. Was missing entirely; sprint detail had no way
            // to surface the link even though adr_link(rel:"sprint") has always
            // been able to create it.
            "in('IMPLEMENTED_IN').adr_id   AS adr_ids, " +
            "out('HAS_STATE')[track_id IS NOT NULL].track_id[0] AS track_id " +
            "FROM KnowSprint WHERE sprint_id = :id",
            List.of("id"), Map.of(), "");

        // Sprint dependency graph — all DEPENDS_ON edges with metadata
        slice("sprint_deps",
            "SELECT @out.sprint_id AS from_sprint, @in.sprint_id AS to_sprint, kind, reason " +
            "FROM DEPENDS_ON WHERE @out.sprint_id IS NOT NULL",
            List.of(), Map.of(), "");

        // Focused dep view for a single sprint (depends_on + blocks)
        slice("sprint_deps_of",
            "SELECT out('DEPENDS_ON').sprint_id AS depends_on, in('DEPENDS_ON').sprint_id AS blocks " +
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
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0] AS note_md, " +
            "out('TAGGED_WITH').component_id AS component_ids, " +
            // author/executor/reviewer_agent (ADR-LORE-014 §4) and task_type
            // (ADR-LORE-015, T14) are plain KnowTask vertex fields — no traversal
            // needed, unlike note_md/effort_days above.
            "author_agent, executor_agent, reviewer_agent, task_type " +
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
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0]         AS note_md, " +
            "out('TAGGED_WITH').component_id                          AS component_ids, " +
            // author/executor/reviewer_agent (ADR-LORE-014 §4) and task_type
            // (ADR-LORE-015, T14) — plain vertex fields.
            "author_agent, executor_agent, reviewer_agent, task_type, " +
            // ADR-LORE-022: ЗАЧЕМ-ось + какой UC задача реализует (REALIZES).
            "work_class, out('REALIZES').uc_id AS realizes_uc " +
            "FROM KnowTask WHERE out('PART_OF').sprint_id[0] = :sprint_id " +
            "ORDER BY order_index",
            List.of("sprint_id"), Map.of(), "");

        // ── ADR-LORE-022: продуктовый слой ───────────────────────────────────
        // «Фича целиком» — вычисляемый факт (D4): shipped ⇔ все UC shipped.
        // Слайс отдаёт счётчики, вывод статуса — на клиенте/потребителе.
        slice("features",
            "SELECT feature_id, title, body_md, context_md, status, component_id, date_created, " +
            "goal_level, shipped_at, " +
            "out('DECOMPOSES_INTO').uc_id AS uc_ids, " +
            "out('DECOMPOSES_INTO').size() AS uc_total, " +
            "out('DECOMPOSES_INTO')[status = 'shipped'].size() AS uc_shipped, " +
            // VP-профиль фичи (ADR-032 D5): что она ЗАЯВЛЯЕТ (ADDRESSES/PROMISES) —
            // замкнутость на UC (RELIEVES/DELIVERS) считает слайс feature_vp (AN-01).
            "out('ADDRESSES').pain_id AS pain_ids, " +
            "out('PROMISES').gain_id  AS gain_ids, " +
            "out('HELPS_WITH').job_id AS job_ids, " + // Остервальдер: третья ось профиля
            "out('TARGETS_MILESTONE').milestone_id[0] AS milestone_id " +
            "FROM KnowFeature",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE component_id = :component")),
            " ORDER BY feature_id");

        slice("use_cases_of_feature",
            "SELECT uc_id, title, scenario_md, acceptance_md, status, feature_id, date_created, " +
            // ADR-027 (D1/§2): классификация Коберна — уровень цели, вес оформления,
            // приоритет; shipped_at ставит система (ADR-029 §2).
            "goal_level, rigor, priority, shipped_at, " +
            // ADR-032 D5: что этот UC реально снимает/создаёт — правая половина VP-канвы.
            "out('RELIEVES').pain_id AS relieves_pain_ids, " +
            "out('DELIVERS').gain_id AS delivers_gain_ids, " +
            "out('PERFORMS').job_id  AS performs_job_ids, " +
            "in('REALIZES').task_uid AS task_uids, " +
            "out('TRACED_TO').adr_id AS traced_adr_ids, " +
            "out('TRACED_TO').decision_id AS traced_decision_ids, " +
            // D12/D13: акторы (multi) и поперечные связи графа UC.
            "out('HAS_ACTOR').actor_id AS actor_ids, " +
            "out('HAS_ACTOR').name     AS actor_names, " +
            "out('UC_INCLUDES').uc_id  AS includes_uc, " +
            "out('UC_EXTENDS').uc_id   AS extends_uc, " +
            "in('UC_INCLUDES').uc_id   AS included_by, " +
            "in('UC_EXTENDS').uc_id    AS extended_by " +
            "FROM KnowUseCase WHERE feature_id = :id ORDER BY uc_id",
            List.of("id"), Map.of(), "");

        // ADR-LORE-032 §2 (D5): реестры болей и выгод. Боль/выгода переиспользуются
        // НЕСКОЛЬКИМИ фичами — потому реестр проектный, а не «внутри фичи»; отсюда же
        // растёт кросс-фичевая канва по актору и «самая горячая боль» (AN-01/AN-07).
        slice("pains",
            "SELECT pain_id, title, body_md, severity, date_created, " +
            "out('FELT_BY').actor_id       AS actor_ids, " +   // чья боль
            "out('BLOCKS').job_id          AS blocks_job_ids, " + // Остервальдер: какой работе мешает
            "in('ADDRESSES').feature_id    AS feature_ids, " + // кто заявил, что адресует
            "in('ADDRESSES').size()        AS addressed_by, " +
            "in('RELIEVES').uc_id          AS relieved_by_ucs, " + // кто РЕАЛЬНО снимает
            "in('RELIEVES').size()         AS relieved_by " +
            "FROM KnowPain",
            List.of(), new LinkedHashMap<>(Map.of("severity", " WHERE severity = :severity")),
            " ORDER BY pain_id");

        slice("gains",
            "SELECT gain_id, title, body_md, metric_md, rank, date_created, " +
            "out('DESIRED_BY').actor_id    AS actor_ids, " +
            "out('SUCCESS_OF').job_id      AS success_of_job_ids, " + // успех в какой работе
            "in('PROMISES').feature_id     AS feature_ids, " +
            "in('PROMISES').size()         AS promised_by, " +
            "in('DELIVERS').uc_id          AS delivered_by_ucs, " +
            "in('DELIVERS').size()         AS delivered_by " +
            "FROM KnowGain",
            List.of(), new LinkedHashMap<>(Map.of("rank", " WHERE rank = :rank")), " ORDER BY gain_id");

        // Остервальдер VPC: РАБОТЫ — третий столп профиля клиента. Боли и выгоды
        // производны от работы («боль мешает работе», «выгода — успех в работе»),
        // поэтому реестр работ отдаёт и то, и другое: вокруг чего вообще всё крутится.
        slice("jobs",
            "SELECT job_id, title, body_md, kind, importance, date_created, " +
            "out('PERFORMED_BY').actor_id AS actor_ids, " +       // чья работа
            "in('BLOCKS').pain_id         AS blocking_pain_ids, " + // что мешает
            "in('BLOCKS').size()          AS blocked_by, " +
            "in('SUCCESS_OF').gain_id     AS gain_ids, " +        // что значит успех
            "in('HELPS_WITH').feature_id  AS feature_ids, " +     // кто ЗАЯВИЛ помощь
            "in('HELPS_WITH').size()      AS helped_by, " +
            "in('PERFORMS').uc_id         AS performed_by_ucs, " + // кто РЕАЛЬНО выполняет
            "in('PERFORMS').size()        AS performed_by " +
            "FROM KnowJob",
            List.of(), new LinkedHashMap<>(Map.of("kind", " WHERE kind = :kind")), " ORDER BY job_id");

        // D12: реестр проектируемых ролей/акторов + карта «сценарии роли».
        slice("actors",
            "SELECT actor_id, name, kind, body_md, " +
            "in('HAS_ACTOR').uc_id AS uc_ids, " +
            "in('HAS_ACTOR').size() AS uc_count " +
            "FROM KnowActor",
            List.of(),
            new LinkedHashMap<>(Map.of("kind", " WHERE kind = :kind")),
            " ORDER BY actor_id");

        // ADR-LORE-031 §3: ассеты, потерявшие вход ATTACHED_TO (сущность удалена) —
        // кормит двухшаговый GC в Админке. По построению upload сироту создать
        // не может, так что непустой срез = следы удалённых сущностей.
        slice("asset_orphans",
            "SELECT asset_key, entity_type, entity_id, mime, size_bytes, created_at " +
            "FROM KnowAsset WHERE inE('ATTACHED_TO').size() = 0",
            List.of(), new LinkedHashMap<>(), " ORDER BY created_at");

        slice("tasks_of_uc",
            "SELECT task_uid, task_id, title, task_type, work_class, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('PART_OF').sprint_id[0] AS sprint_id " +
            "FROM KnowTask WHERE out('REALIZES').uc_id CONTAINS :id ORDER BY task_uid",
            List.of("id"), Map.of(), "");

        // Обзор дисциплины (D3): uc-задачи без REALIZES — advisory, не ошибка.
        slice("unlinked_uc_tasks",
            "SELECT task_uid, task_id, title, work_class, out('PART_OF').sprint_id[0] AS sprint_id " +
            "FROM KnowTask WHERE work_class = 'uc' AND out('REALIZES').size() = 0 " +
            "ORDER BY task_uid",
            List.of(), Map.of(), "");

        // Batch variant: fetch tasks for multiple sprints in one query.
        // sprint_ids is a comma-separated string that the slice layer splits into a list.
        slice("tasks_of_sprints_batch",
            "SELECT task_uid, task_id, title, order_index, " +
            "out('PART_OF').sprint_id[0]                              AS sprint_id, " +
            "out('IN_PHASE').phase_uid[0]                            AS phase_uid, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]   AS status_raw, " +
            "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, " +
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0]         AS note_md, " +
            "out('TAGGED_WITH').component_id                          AS component_ids, " +
            // author/executor/reviewer_agent (ADR-LORE-014 §4) and task_type
            // (ADR-LORE-015, T14) — plain vertex fields.
            "author_agent, executor_agent, reviewer_agent, task_type " +
            "FROM KnowTask WHERE out('PART_OF').sprint_id[0] IN :sprint_ids " +
            "ORDER BY out('PART_OF').sprint_id[0], order_index",
            List.of("sprint_ids"), Map.of(), "");

        // ── §3 Milestones ────────────────────────────────────────────────────
        slice("milestones",
            "SELECT milestone_id, label, week, date_display, priority, " +
            "out('HAS_STATE').goal_md[0]      AS goal_md, " +
            "out('HAS_STATE').decisions_md[0] AS decisions_md, " +
            // SPRINT_PLANITEM_RETIRE (T-21) had briefly split this into a "planned"
            // bucket (KnowSprintHist.planned_milestone_id, a plain property) vs.
            // this "actual" bucket (TARGETS_MILESTONE edge). The property drifted
            // out of sync with the edge on 62+ sprints and was retired — the edge
            // is now the sole source of truth for sprint↔milestone membership.
            "in('TARGETS_MILESTONE').sprint_id AS direct_sprint_ids " +
            "FROM KnowMilestone ORDER BY week",
            List.of(), Map.of(), "");

        // ── §4 Search — cross-entity, case-insensitive substring ─────────────
        // pattern is wrapped in %…% server-side (callers pass a bare term, e.g. "geoid").
        // Matches id + title/name; for ADRs also the body sections on the OPEN hist row.
        // Сквозной поиск единого окна (SRCH-01). Продуктовый слой ищется по
        // FULL_TEXT-индексам через SEARCH_FIELDS + '*' (префикс: иначе поиск-как-
        // набираешь не работает — токенный поиск не ловит незавершённое слово).
        // ВАЖНО: SEARCH_FIELDS требует индекс РОВНО на перечисленные поля, а у нас
        // индексы по одному полю → OR однополевых вызовов. Схлопывание в
        // мультиполевые + русская морфология — SRCH-03 (миграция V11).
        // Замеры и ловушки: SPEC-TECH-LORE-ARCADEDB §Полнотекстовый поиск.
        slice("search",
            "SELECT expand(unionall($a, $s, $p, $t, $q, $r, $d, $c, $f, $u, $pn, $gn, $jb, $ac)) LET " +
            "$a = (SELECT 'adr' AS type, adr_id AS ref_id, name AS title FROM KnowADR " +
            "      WHERE adr_id ILIKE ('%' + :pattern + '%') OR name ILIKE ('%' + :pattern + '%') " +
            "      OR out('HAS_STATE')[valid_to IS NULL].context_md[0] ILIKE ('%' + :pattern + '%') " +
            "      OR out('HAS_STATE')[valid_to IS NULL].decision_md[0] ILIKE ('%' + :pattern + '%') LIMIT 15), " +
            "$s = (SELECT 'spec' AS type, spec_id AS ref_id, title FROM KnowSpec " +
            "      WHERE spec_id ILIKE ('%' + :pattern + '%') OR title ILIKE ('%' + :pattern + '%') " +
            "      OR COALESCE(out('HAS_STATE').content_md[0], content_md) ILIKE ('%' + :pattern + '%') LIMIT 15), " +
            "$p = (SELECT 'sprint' AS type, sprint_id AS ref_id, name AS title FROM KnowSprint " +
            "      WHERE sprint_id ILIKE ('%' + :pattern + '%') OR name ILIKE ('%' + :pattern + '%') LIMIT 15), " +
            "$t = (SELECT 'task' AS type, task_uid AS ref_id, title FROM KnowTask " +
            "      WHERE task_uid ILIKE ('%' + :pattern + '%') OR title ILIKE ('%' + :pattern + '%') LIMIT 15), " +
            "$q = (SELECT 'quality_gate' AS type, qg_id AS ref_id, name AS title FROM QualityGate " +
            "      WHERE qg_id ILIKE ('%' + :pattern + '%') OR name ILIKE ('%' + :pattern + '%') " +
            "      OR content_md ILIKE ('%' + :pattern + '%') LIMIT 10), " +
            "$r = (SELECT 'runbook' AS type, runbook_id AS ref_id, name AS title FROM KnowRunbook " +
            "      WHERE runbook_id ILIKE ('%' + :pattern + '%') OR name ILIKE ('%' + :pattern + '%') LIMIT 10), " +
            "$d = (SELECT 'doc' AS type, doc_id AS ref_id, title FROM KnowDoc " +
            "      WHERE doc_id ILIKE ('%' + :pattern + '%') OR title ILIKE ('%' + :pattern + '%') LIMIT 10), " +
            "$c = (SELECT 'decision' AS type, decision_id AS ref_id, title FROM KnowDecision " +
            "      WHERE decision_id ILIKE ('%' + :pattern + '%') OR title ILIKE ('%' + :pattern + '%') " +
            "      OR body_md ILIKE ('%' + :pattern + '%') LIMIT 10), " +
            // ── продуктовый слой (ADR-LORE-022/032) — по FULL_TEXT-индексам ──
            "$f = (SELECT 'feature' AS type, feature_id AS ref_id, title FROM KnowFeature " +
            "      WHERE feature_id ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['title'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['body_md'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['context_md'], :pattern + '*') = true LIMIT 10), " +
            "$u = (SELECT 'use_case' AS type, uc_id AS ref_id, title FROM KnowUseCase " +
            "      WHERE uc_id ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['title'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['scenario_md'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['acceptance_md'], :pattern + '*') = true LIMIT 10), " +
            "$pn = (SELECT 'pain' AS type, pain_id AS ref_id, title FROM KnowPain " +
            "      WHERE pain_id ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['title'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['body_md'], :pattern + '*') = true LIMIT 10), " +
            "$gn = (SELECT 'gain' AS type, gain_id AS ref_id, title FROM KnowGain " +
            "      WHERE gain_id ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['title'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['body_md'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['metric_md'], :pattern + '*') = true LIMIT 10), " +
            "$jb = (SELECT 'job' AS type, job_id AS ref_id, title FROM KnowJob " +
            "      WHERE job_id ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['title'], :pattern + '*') = true " +
            "      OR SEARCH_FIELDS(['body_md'], :pattern + '*') = true LIMIT 10), " +
            "$ac = (SELECT 'actor' AS type, actor_id AS ref_id, name AS title FROM KnowActor " +
            "      WHERE actor_id ILIKE ('%' + :pattern + '%') OR name ILIKE ('%' + :pattern + '%') " +
            "      OR SEARCH_FIELDS(['body_md'], :pattern + '*') = true LIMIT 10)",
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

        // SPRINT_PLANITEM_RETIRE/T-14: plan_items removed — PlanItem is retired
        // (LorePlanBoard.tsx now reads the `sprints` slice directly, T-12/T-13).
        // Historical PlanItem/PlanItemHist/StatusPlanItem data archived to
        // docs/archive/planitem_archive_20260704.json before the type drop.

        slice("plan_checkpoints",
            "SELECT checkpoint_id, label, desc_md, " +
            "out('ON_MILESTONE').milestone_id[0] AS milestone " +
            "FROM PlanCheckpoint ORDER BY checkpoint_id");

        slice("plan_versions",
            "SELECT version_id, version_date, changelog_md FROM PlanVersion ORDER BY version_date DESC");

        // Git projects — for the T43 multi-project picker (question/decision forms).
        slice("git_projects",
            "SELECT slug, name, default_branch, is_private, hosts FROM KnowGitProject ORDER BY slug");

        // ── §6 Components ────────────────────────────────────────────────────
        slice("components",
            "SELECT component_id, full_name, area, parent_id, game_icon, owner, team, " +
            "in('PARENT_OF').component_id AS children, " +
            "out('USES').tech_id AS tech, " +
            "in('BELONGS_TO')[adr_id IS NOT NULL].size()    AS adr_count, " +
            "out('DOCUMENTED_IN').size()                    AS spec_count, " +
            "in('BELONGS_TO')[qg_id IS NOT NULL].size()     AS qg_count, " +
            "in('BELONGS_TO')[sprint_id IS NOT NULL].size() AS sprint_count, " +
            // Git projects this component touches, via its sprints
            // (Component ← BELONGS_TO ← KnowSprint → BELONGS_TO_PROJECT → KnowGitProject).
            "in('BELONGS_TO')[@this INSTANCEOF 'KnowSprint'].out('BELONGS_TO_PROJECT').slug AS git_projects " +
            "FROM LoreComponent",
            List.of(),
            new LinkedHashMap<>(Map.of("root", " WHERE parent_id = :root")),
            " ORDER BY full_name");

        slice("component",
            "SELECT component_id, full_name, area, parent_id, game_icon, owner, team, " +
            "in('PARENT_OF').component_id   AS sub_components, " +
            "out('USES').tech_id            AS tech, " +
            "in('BELONGS_TO')[adr_id IS NOT NULL].adr_id  AS adrs, " +
            "out('DOCUMENTED_IN').spec_id   AS specs " +
            "FROM LoreComponent WHERE component_id = :id",
            List.of("id"), Map.of(), "");

        // LCX-02: sprints related to a component. Two sources, explicit wins:
        //   1. Explicit BELONGS_TO edge (sprint→component) — authoritative re-link.
        //   2. Naming convention (sprint_id LIKE '%<key>%') — fuzzy fallback, but ONLY
        //      for sprints that carry NO explicit component link (so a re-linked sprint
        //      stops showing under the component its name happens to match).
        // :pattern is the naming key (frontend-derived); :cid is the component_id.
        slice("component_sprints",
            "SELECT sprint_id, name, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('BELONGS_TO').component_id AS components, " +
            "in('IMPLEMENTED_IN_RELEASE').release_id AS release_ids " +
            "FROM KnowSprint WHERE " +
            "(out('BELONGS_TO').component_id CONTAINS :cid) " +
            "OR (sprint_id LIKE :pattern AND out('BELONGS_TO').size() = 0) " +
            "ORDER BY sprint_id DESC",
            List.of("pattern", "cid"), Map.of(), " LIMIT 30");

        // ── §6b Specs (KnowSpec — technical articles, LAL-32) ────────────────
        // content_md/summary live on the SCD2 state row (KnowSpecHist), like ADRs.
        // The vertex `title` is backfilled from the content_md heading by
        // lore-backfill-spec-titles.mjs; until then the frontend falls back to spec_id.
        slice("specs",
            "SELECT spec_id, title, file_path, " +
            "COALESCE(out('BELONGS_TO').component_id[0], component_id) AS component_id " +
            "FROM KnowSpec",
            List.of(),
            new LinkedHashMap<>(Map.of(
                // CONTAINS, не [0]: у сущности может быть несколько BELONGS_TO, а
                // порядок рёбер — это порядок вставки, не приоритет. Сравнение с [0]
                // делало сущность видимой только под одним произвольным компонентом.
                "component", " WHERE out('BELONGS_TO').component_id CONTAINS :component")),
            " ORDER BY spec_id LIMIT 400");

        slice("spec_by_id",
            "SELECT spec_id, title, file_path, " +
            "COALESCE(out('HAS_STATE').content_md[0], content_md) AS content_md, " +
            "out('HAS_STATE').summary[0]                          AS summary, " +
            "COALESCE(out('HAS_STATE').version[0], version)       AS version, " +
            "out('HAS_STATE').valid_from[0]                       AS valid_from, " +
            "COALESCE(out('BELONGS_TO').component_id[0], component_id) AS component_id " +
            "FROM KnowSpec WHERE spec_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // SPRINT_TECH_REGISTRY / TR-06+08: version+date+license registry per
        // component tech, stored as one KnowSpec per (component, tech) —
        // spec_id "SPEC-TECH-<COMPONENT>-<TECH>", title=tech name, version=tech
        // version, content_md=small bullet list (release_date/license/source/
        // checked_at). Piggybacks the existing /lore/spec upsert path (no new
        // backend write endpoint needed) — this slice is the read side.
        slice("tech_registry",
            "SELECT spec_id, title AS tech_name, " +
            "COALESCE(out('HAS_STATE').version[0], version) AS version, " +
            "COALESCE(out('HAS_STATE').content_md[0], content_md) AS content_md, " +
            "out('HAS_STATE').valid_from[0] AS checked_at, " +
            "COALESCE(out('BELONGS_TO').component_id[0], component_id) AS component_id " +
            "FROM KnowSpec WHERE spec_id LIKE 'SPEC-TECH-%'",
            List.of(),
            new LinkedHashMap<>(Map.of(
                // CONTAINS, не [0] — см. комментарий в слайсе adrs.
                "component", " AND (out('BELONGS_TO').component_id CONTAINS :component OR component_id = :component)")),
            " ORDER BY spec_id LIMIT 200");

        // ── §7 History (SCD2 chain) ───────────────────────────────────────────
        // AL-30: + все версионируемые поля ревизии (тела, план, pr_refs) — история
        // перестаёт показывать «только статус» при полных данных под ней.
        slice("history_sprint",
            "SELECT valid_from, valid_to, content_hash, source_commit, status_raw, " +
            "priority, planned_start_date, planned_end_date, track_id, pr_refs, " +
            "context_md, outcome_md " +
            "FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id[0] = :id ORDER BY valid_from",
            List.of("id"), Map.of(), "");

        // Bulk: every sprint state row (scalar valid_from). Frontend takes the min
        // valid_from per sprint_id = real sprint start, for lead/cycle time.
        slice("sprint_starts",
            "SELECT in('HAS_STATE').sprint_id[0] AS sprint_id, valid_from " +
            "FROM KnowSprintHist WHERE valid_from IS NOT NULL ORDER BY valid_from",
            List.of(), Map.of(), "");

        // Sprints that ever passed through a BLOCKED state — for blocked/reopen rate.
        // Frontend dedups by sprint_id and divides by total sprints.
        slice("blocked_sprints",
            "SELECT in('HAS_STATE').sprint_id[0] AS sprint_id " +
            "FROM KnowSprintHist WHERE status_raw LIKE '%BLOCK%'",
            List.of(), Map.of(), "");

        // Task done-transitions for throughput. valid_from = when task became DONE.
        // states = total HAS_STATE rows of the task: states>1 means real progression
        // (vs archived "born done" dump). Frontend also cuts pre-LORE import dates.
        slice("task_done_dates",
            "SELECT in('HAS_STATE').task_id[0] AS task_id, valid_from, " +
            "in('HAS_STATE').out('HAS_STATE').size() AS states, " +
            "in('HAS_STATE').effort_days[0] AS effort_days " +
            "FROM KnowTaskHist WHERE valid_to IS NULL AND status_raw LIKE '%DONE%' AND valid_from IS NOT NULL",
            List.of(), Map.of(), "");

        // Every task state row (scalar valid_from). Frontend takes min per task = created date,
        // for calendar duration (proxy «потраченного» в effort accuracy).
        slice("task_starts",
            "SELECT in('HAS_STATE').task_id[0] AS task_id, valid_from " +
            "FROM KnowTaskHist WHERE valid_from IS NOT NULL",
            List.of(), Map.of(), "");

        // SPRINT_PLANITEM_RETIRE/T-23: history_plan_item removed — PlanItem is
        // deprecated (T-14) and this slice's only consumer (LoreEvolutionView.tsx)
        // was removed in T-22. Sprint plan-field history now lives on
        // KnowSprintHist, queryable via history_sprint.

        // ── §8 KnowDoc — HTML/MD document fragments (Phase 5 LAL-30) ────────
        // Schema added in Phase 5; slices registered now so the frontend can
        // query gracefully (returns [] until KnowDoc vertices are ingested).
        slice("docs",
            // parent_doc_id/sort_order/child_ids: DeepWiki-style page tree
            // (DOC_CHILD_OF edge, child→parent) — frontend builds the tree +
            // prev/next sequence client-side from these three fields, same
            // pattern as component/milestone facets elsewhere in this app.
            "SELECT doc_id, title, kind, has_ext_deps, sort_order, " +
            "out('DOC_CHILD_OF').doc_id[0] AS parent_doc_id, " +
            "in('DOC_CHILD_OF').doc_id     AS child_ids, " +
            "COALESCE(out('BELONGS_TO').component_id[0], component_id) AS component_id, " +
            "out('IMPLEMENTED_IN').sprint_id AS sprint_ids " +
            "FROM KnowDoc",
            List.of(),
            new LinkedHashMap<>(Map.of(
                // CONTAINS, не [0]: у сущности может быть несколько BELONGS_TO, а
                // порядок рёбер — это порядок вставки, не приоритет. Сравнение с [0]
                // делало сущность видимой только под одним произвольным компонентом.
                "component", " WHERE out('BELONGS_TO').component_id CONTAINS :component")),
            " ORDER BY doc_id LIMIT 200");

        slice("doc_by_id",
            // NB: KnowDoc has no SCD2 write path (flat vertex, see KnowDocParser
            // comment) — no HAS_STATE edge is ever created, so valid_from is
            // always null today regardless of edge name. Named HAS_STATE for
            // consistency with every other *_by_id slice (was HAS_HIST, a type
            // never declared in the schema) in case doc history is added later.
            "SELECT doc_id, title, kind, has_ext_deps, content_html, content_md_en, content_md_ru, " +
            "sort_order, " +
            "out('DOC_CHILD_OF').doc_id[0] AS parent_doc_id, " +
            "in('DOC_CHILD_OF').doc_id     AS child_ids, " +
            "COALESCE(out('BELONGS_TO').component_id[0], component_id) AS component_id, " +
            "out('IMPLEMENTED_IN').sprint_id AS sprint_ids, " +
            "out('HAS_STATE').valid_from[0] AS valid_from " +
            "FROM KnowDoc WHERE doc_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── §9 KnowRunbook (Phase 5 LAL-29) ─────────────────────────────────
        slice("runbooks",
            "SELECT runbook_id, name, area, date_created, " +
            "out('REFERENCES_ADR').adr_id AS adr_ids " +
            "FROM KnowRunbook",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "area", " WHERE area = :area")),
            " ORDER BY runbook_id LIMIT 100");

        slice("runbook_by_id",
            "SELECT runbook_id, name, area, date_created, " +
            "COALESCE(out('HAS_STATE').content_md[0], content_md) AS content_md, " +
            "out('HAS_STATE').valid_from[0] AS valid_from, " +
            "out('REFERENCES_ADR').adr_id AS adr_ids " +
            "FROM KnowRunbook WHERE runbook_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        // ── §10 QualityGate (Phase 5 LAL-28) ─────────────────────────────────
        slice("quality_gates",
            "SELECT qg_id, name, description, component_id, status, last_run_status, date_created, sprint_id, content_md " +
            "FROM QualityGate",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "component", " WHERE component_id = :component")),
            " ORDER BY qg_id LIMIT 100");

        slice("quality_gate_by_id",
            "SELECT qg_id, name, description, component_id, status, last_run_status, date_created, content_md, sprint_id " +
            "FROM QualityGate WHERE qg_id = :id LIMIT 1",
            List.of("id"), Map.of(), "");

        slice("qg_metrics",
            "SELECT metric_id, name, threshold " +
            "FROM QGMetric WHERE in('MEASURED_BY').qg_id[0] = :qg_id",
            List.of("qg_id"), Map.of(), " LIMIT 100");

        slice("qg_job_tasks",
            "SELECT job_id, inv_id, severity, status, run_date, note_md " +
            "FROM QGJobTask WHERE qg_id = :qg_id ORDER BY run_date DESC",
            List.of("qg_id"), Map.of(), " LIMIT 200");

        slice("qg_recommendations",
            "SELECT rec_id, title, body_md, status, " +
            "in('PRODUCED').inv_id[0] AS inv_id, in('PRODUCED').severity[0] AS severity, " +
            "in('PRODUCED').qg_id[0] AS qg_id, " +
            "out('PROMOTED_TO').task_uid[0]                     AS promoted_task_uid, " +
            "out('PROMOTED_TO').out('PART_OF').sprint_id[0]     AS promoted_sprint_id " +
            "FROM QGRecommendation WHERE in('PRODUCED').qg_id CONTAINS :qg_id " +
            "ORDER BY status",
            List.of("qg_id"), Map.of(), " LIMIT 100");

        // ── §10b QG dashboard slices (no required params) ─────────────────────
        slice("qg_violations",
            "SELECT job_id, inv_id, severity, status, run_date, note_md, qg_id, component_id " +
            "FROM QGJobTask WHERE status = 'open' ORDER BY run_date DESC",
            List.of(), Map.of(), " LIMIT 300");

        slice("qg_pending_recs",
            "SELECT rec_id, title, body_md, status, priority, severity, effort_days, " +
            "tags, component_id, qg_id, inv_id, fix_cmd, how_to_verify " +
            "FROM QGRecommendation WHERE status = 'pending' ORDER BY priority ASC",
            List.of(), Map.of(), " LIMIT 200");

        // All QG routine runs (latest first). Includes run_id for metric join.
        slice("qg_routine_runs",
            "SELECT run_id, routine_name, run_date, status, flags, started_at, finished_at " +
            "FROM ClRoutineRun WHERE routine_name LIKE 'qg-%' ORDER BY run_date DESC",
            List.of(), Map.of(), " LIMIT 200");

        // Latest metric snapshot per routine — one row per metric_key.
        slice("qg_metrics_latest",
            "SELECT routine_name, run_date, metric_key, value, unit, target, status " +
            "FROM ClRoutineMetric WHERE routine_name LIKE 'qg-%' ORDER BY routine_name, metric_key",
            List.of(), Map.of(), " LIMIT 500");

        // All metrics for a specific run (detail panel).
        slice("qg_run_metrics",
            "SELECT metric_id, metric_key, value, unit, target, status, source " +
            "FROM ClRoutineMetric WHERE run_id = :run_id ORDER BY metric_key",
            List.of("run_id"), Map.of(), " LIMIT 100");

        // ── §11 KnowTask standalone (Phase 5 LAL-31) ─────────────────────────
        slice("git_projects",
            "SELECT slug, name, hosts, default_branch FROM KnowGitProject",
            List.of(), Map.of(), " ORDER BY slug");

        // Fixed 2026-07-02: PART_OF is Task --PART_OF--> Sprint (out from the task), so
        // in('PART_OF') on KnowTask always returns empty — the old query classified EVERY
        // task as backlog regardless of sprint membership.
        slice("backlog_tasks",
            "SELECT task_uid, task_id, title, status_raw, priority, component_id, task_type " +
            "FROM KnowTask WHERE out('PART_OF').size() = 0",
            List.of(), Map.of(), " ORDER BY task_uid LIMIT 200");

        slice("all_tasks",
            // author/executor/reviewer_agent (ADR-LORE-014 §4) выбираются наравне
            // с остальными слайсами задач (tasks_of_sprint, tasks_of_phase). Без
            // них таблица показывала роли пустыми ДАЖЕ когда они заданы — то есть
            // «нет роли» в UI не означало отсутствие роли, а означало, что слайс её
            // не отдал. Ровно тот класс, что ловили весь спринт: данные есть, путь
            // их не доносит.
            "SELECT task_uid, task_id, title, status_raw, priority, component_id, task_type, " +
            "author_agent, executor_agent, reviewer_agent, " +
            "out('PART_OF').sprint_id[0]    AS sprint_id, " +
            "out('PART_OF').title[0]        AS sprint_title, " +
            "out('HAS_STATE')[note_md IS NOT NULL].note_md[0] AS note_md, " +
            "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days " +
            "FROM KnowTask",
            // No frontend consumer as of this writing (grep-confirmed) — LIMIT is a
            // defensive cap, not a UX pagination boundary. Raised 500→5000 so a full
            // task-effort export (e.g. the fractional-hours migration) doesn't
            // silently truncate; still bounded to avoid an unbounded query.
            List.of(), Map.of("q", ""), " ORDER BY sprint_id, task_uid LIMIT 5000");

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

        // ── §13 ClRoutine* slices (Phase 6 v1.3) ─────────────────────────────
        slice("routine_latest",
            "SELECT metric_key, value, unit, status, run_date " +
            "FROM ClRoutineMetric WHERE routine_name = :routine_name " +
            "AND run_date = (SELECT max(run_date) FROM ClRoutineMetric " +
            "WHERE routine_name = :routine_name) ORDER BY metric_key LIMIT 50",
            List.of("routine_name"), Map.of(), "");

        slice("routine_last_run",
            "SELECT routine_name, run_date, status, flags, detail_md, gates_failed_ids " +
            "FROM ClRoutineRun WHERE routine_name = :routine_name " +
            "ORDER BY run_date DESC LIMIT 1",
            List.of("routine_name"), Map.of(), "");

        slice("routine_outputs",
            "SELECT output_type, title, run_date " +
            "FROM ClRoutineOutput WHERE routine_name = :routine_name " +
            "ORDER BY run_date DESC LIMIT 50",
            List.of("routine_name"), Map.of(), "");

        slice("routine_output_by_type",
            "SELECT output_type, title, run_date, content_md " +
            "FROM ClRoutineOutput WHERE routine_name = :routine_name " +
            "AND output_type = :output_type ORDER BY run_date DESC LIMIT 1",
            List.of("routine_name", "output_type"), Map.of(), "");

        slice("qg_run_history",
            "SELECT run_id, routine_name, run_date, status, flags, started_at, finished_at " +
            "FROM ClRoutineRun WHERE routine_name = :routine_name " +
            "ORDER BY started_at DESC, run_date DESC",
            List.of("routine_name"), Map.of(), " LIMIT 20");

        // ── MCP-05: BRAGI content archive read slices (SPEC-BRAGI-ARCHIVE-001) ──
        slice("bragi_overview",
            "SELECT status_general, count(*) AS n FROM BragiPublication GROUP BY status_general",
            List.of(), Map.of(), "");

        slice("bragi_publications",
            "SELECT publication_id, title, topic, main_text_md, type, status_general, source_file_path, " +
            // V2-02: annotation_md (permanent editorial meta) / todo_md (transient
            // "- [ ]" checklist) — editor-only fields, deliberately never fed into
            // BragiSkinPreview. Publication + per-variant (parallel arrays, same
            // index convention as variant_texts/variant_channels below).
            "annotation_md, todo_md, " +
            "out('HAS_ASSET').file_url AS cover_asset_urls, " +
            "out('HAS_VARIANT').variant_id AS variant_ids, " +
            "out('HAS_VARIANT').status AS variant_statuses, " +
            "out('HAS_VARIANT').url AS variant_urls, " +
            "out('HAS_VARIANT').text_md AS variant_texts, " +
            "out('HAS_VARIANT').annotation_md AS variant_annotation_texts, " +
            "out('HAS_VARIANT').todo_md AS variant_todo_texts, " +
            "out('HAS_VARIANT').out('IN_CHANNEL').channel_id AS variant_channels, " +
            "out('HAS_VARIANT').out('HAS_ASSET').file_url AS variant_asset_urls, " +
            "out('TARGETS_KEY').keyword_id AS keyword_ids, " +
            "out('IN_RUBRIC').rubric_id AS rubric_ids, " +
            "out('IN_RUBRIC').name AS rubric_names, " +
            "out('PRODUCED_BY').task_uid AS produced_by_task_ids, " +
            "out('PRODUCED_BY').sprint_id AS produced_by_sprint_ids, " +
            "out('SHIPPED_IN').release_id AS shipped_in_release_ids " +
            "FROM BragiPublication",
            List.of(), Map.of(), " ORDER BY publication_id");

        // Calendar: variants that have a published_at date. No distinct "planned
        // date" field exists yet (v0.4 spec only has published_at on Variant) —
        // planned-but-undated variants are visible via bragi_publications instead.
        slice("bragi_calendar",
            "SELECT variant_id, status, published_at, url, " +
            "in('HAS_VARIANT').publication_id AS publication_id, " +
            "in('HAS_VARIANT').title AS title, " +
            "out('IN_CHANNEL').channel_id AS channel_id " +
            "FROM BragiVariant WHERE published_at IS NOT NULL",
            List.of(), Map.of(), " ORDER BY published_at");

        slice("bragi_keys",
            "SELECT keyword_id, phrase, cluster, freq_exact, freq_broad, intent, source, measured_at, " +
            "out('TARGETS_PAGE').page_id AS page_id, " +
            "out('TARGETS_PAGE').url AS page_url, " +
            "out('IN_RUBRIC').rubric_id AS rubric_ids, " +
            "out('IN_RUBRIC').name AS rubric_names " +
            "FROM BragiKeyword",
            List.of(), Map.of(), " ORDER BY freq_exact DESC");

        slice("bragi_rubrics",
            "SELECT rubric_id, name, description, order_index FROM BragiRubric",
            List.of(), Map.of(), " ORDER BY order_index, name");

        // Recent metric feed — for filtered/aggregated queries use metric_get
        // (POST /lore/bragi/metric/query) instead; this slice is a flat recent-points
        // feed for dashboard cards. object_type='probe' is a schema-verification
        // artifact (ARC-02/ARC-03), always excluded. The remaining exclusions
        // (V2-01, SPRINT_BRAGI_ARCHIVE_V2) mirror queryBragiMetric's filter —
        // MetricSnapshot is TIMESERIES/sealed, so pre-policy seed/test points can't
        // be physically deleted and are filtered at every read path instead.
        slice("bragi_analytics",
            "SELECT object_type, object_id, metric, value, ts, source, segment " +
            "FROM MetricSnapshot WHERE object_type != 'probe' " +
            "AND object_id != 'PUB-QA-E2E' AND source NOT IN ['qa-e2e', 'test-mcp03'] " +
            "AND NOT (ts = '2026-06-27 12:00:00' AND object_id IN ['PUB-04', 'PUB-04-VC', 'PUB-04-TG', 'PUB-05', 'PUB-05-HABR']) " +
            "AND NOT (ts = '2026-07-02 09:00:00' AND (object_type = 'competitor' OR object_id = 'KW-08'))",
            List.of(), Map.of(), " ORDER BY ts DESC LIMIT 100");

        slice("bragi_competitors",
            "SELECT competitor_id, name FROM BragiCompetitor",
            List.of(), Map.of(), " ORDER BY competitor_id");

        // FE-05: was missed in the original MCP-05 pass — Insights need a read
        // slice too. out('LED_TO') fans out to both KnowTask and KnowADR; ArcadeDB
        // returns whatever field exists on the target (adr_id null on a task row
        // and vice versa), so both arrays below are safe to project together.
        slice("bragi_insights",
            "SELECT insight_id, statement_md, insight_date, evidence_ref, " +
            "out('LED_TO').task_uid AS led_tasks, " +
            "out('LED_TO').adr_id AS led_adrs " +
            "FROM BragiInsight",
            List.of(), Map.of(), " ORDER BY insight_date DESC");

        slice("bragi_integrations",
            "SELECT integration_id, service, purpose, endpoint, scope, secret_ref, status, last_called_at " +
            "FROM BragiIntegration",
            List.of(), Map.of(), " ORDER BY integration_id");

        // FE-06: another gap found while building the create-forms — channel/page
        // pickers need lookup slices too, not just the content-display ones.
        slice("bragi_channels",
            "SELECT channel_id, channel_type, url_handle, funnel_role, rules_md FROM BragiChannel",
            List.of(), Map.of(), " ORDER BY channel_id");

        slice("bragi_pages",
            "SELECT page_id, url, title FROM BragiPage",
            List.of(), Map.of(), " ORDER BY page_id");

        // ── ADR-LORE-012: dictionary (KnowDictEntry) ─────────────────────────
        // Without dict_type — весь справочник; с dict_type — один домен.
        // Читается фронтом (useDictionary), бэкендом и MCP как единый канон.
        // Admin LORE (ADR-LORE-025): tag usage counts for the read-only «Теги» tab.
        slice("tags_usage",
            "SELECT tag_id, in('TAGGED_WITH').size() AS uses FROM KnowTag",
            List.of(), Map.of(), " ORDER BY uses DESC, tag_id LIMIT 500");
        slice("lore_tags_usage",
            "SELECT tag_id, in('TAGGED_WITH').size() AS uses FROM LoreTag",
            List.of(), Map.of(), " ORDER BY uses DESC, tag_id LIMIT 500");

        slice("dictionary",
            // ifnull() masks the brief NULL-flag window on a freshly-upserted row
            // (defaults are set in a second, IS NULL-gated statement) — readers
            // always see the effective defaults, never NULL.
            "SELECT dict_type, code, label_ru, label_en, color, icon, sort_order, " +
            "ifnull(is_active, true) AS is_active, ifnull(is_extensible, false) AS is_extensible FROM KnowDictEntry",
            List.of(),
            new LinkedHashMap<>(Map.of(
                "dict_type", " WHERE dict_type = :dict_type")),
            " ORDER BY dict_type, sort_order");

        // ADR-LORE-012 level B: components linked to an area via the IN_AREA edge
        // (graph traversal, not the string field) — «all components in area X».
        slice("components_in_area",
            "SELECT component_id, full_name, area, game_icon FROM LoreComponent " +
            "WHERE out('IN_AREA').code CONTAINS :code",
            List.of("code"), Map.of(), " ORDER BY component_id");
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
