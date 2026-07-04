package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Orchestrates Phase 2 ingest: scans docs root, parses markdown files, upserts
 * KnowADR / KnowDecision / KnowSprint vertices + BELONGS_TO / DEPENDS_ON edges.
 *
 * All DML uses UPDATE ... UPSERT WHERE — idempotent, re-runnable.
 * Dev-only by construction: docsRoot must exist on the local filesystem.
 */
@ApplicationScoped
public class LoreIngestService {

    private static final Logger LOG = Logger.getLogger(LoreIngestService.class);

    @Inject
    @RestClient
    LoreCommandClient client;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @ConfigProperty(name = "team-docs.root", defaultValue = "C:/AIDA/docs")
    String defaultDocsRoot;

    // ── Public API ────────────────────────────────────────────────────────────

    public record IngestReport(
        int adrs, int decisions, int sprints, int edges,
        int runbooks, int qualityGates, int docs,
        int tasks, int findings, int releases,
        List<String> errors) {}

    public record CreateSprintResult(String sprintId, boolean created) {}

    // Canonical status token → status_raw, mirrors AidaLoreResource.SCD2_STATUS_RAW.
    private static final Map<String, String> SPRINT_STATUS_RAW = Map.of(
        "done", "✅ DONE", "active", "🔄 IN PROGRESS", "partial", "🟡 PARTIAL",
        "todo", "📋 PLANNED", "blocked", "🔴 BLOCKED", "high", "🔴 P0",
        "cancelled", "🚫 CANCELLED");

    /**
     * Create a KnowSprint directly — no plan-item involved (SPRINT_PLANITEM_RETIRE/T-14:
     * this used to also upsert a PlanItem + REPRESENTS edge "so the sprint appears on
     * the Gantt", but LorePlanBoard reads the sprints slice directly since T-12/T-13,
     * so that side effect only kept growing PlanItem's row count for no reason).
     * Idempotent — if the sprint already exists its fields are updated but no
     * duplicate HAS_STATE row is created.
     */
    public CreateSprintResult createSprint(String sprintId, String name, String status,
                                           String planId,
                                           String priority, String outcomeMd, String contextMd) {
        String statusRaw = SPRINT_STATUS_RAW.getOrDefault(status == null ? "todo" : status, "📋 PLANNED");
        String nm = (name != null && !name.isBlank()) ? name : sprintId;

        // 1. Upsert KnowSprint
        StringBuilder set = new StringBuilder(
            "UPDATE KnowSprint SET sprint_id=:sid, name=:nm, status_raw=:sraw");
        java.util.Map<String, Object> p = new java.util.LinkedHashMap<>(
            Map.of("sid", sprintId, "nm", nm, "sraw", statusRaw));
        if (planId    != null) { set.append(", plan_id=:pid");     p.put("pid", planId); }
        if (priority  != null) { set.append(", priority=:pri");    p.put("pri", priority); }
        if (outcomeMd != null) { set.append(", outcome_md=:omd");  p.put("omd", outcomeMd); }
        if (contextMd != null) { set.append(", context_md=:ctx");  p.put("ctx", contextMd); }
        set.append(" UPSERT WHERE sprint_id=:sid");
        exec(set.toString(), p);

        // 2. Seed HAS_STATE if none yet
        List<Map<String, Object>> st = queryRows(
            "SELECT out('HAS_STATE').size() AS n FROM KnowSprint WHERE sprint_id=:sid",
            Map.of("sid", sprintId));
        long stateN = (!st.isEmpty() && st.get(0).get("n") instanceof Number num) ? num.longValue() : 0;
        boolean created = stateN == 0;
        if (created) {
            String stateUid = java.util.UUID.randomUUID().toString();
            String now = java.time.Instant.now().toString();
            exec("INSERT INTO KnowSprintHist SET state_uid=:su, status_raw=:sraw, valid_from=:now",
                Map.of("su", stateUid, "sraw", statusRaw, "now", now));
            exec("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id=:sp) " +
                    "TO (SELECT FROM KnowSprintHist WHERE state_uid=:su)",
                Map.of("sp", sprintId, "su", stateUid));
            // created_date: stamped exactly once, here — unlike valid_from (which
            // moves on every SCD2 transition), this must survive untouched so
            // lead/cycle-time analytics have a real creation timestamp to anchor on.
            exec("UPDATE KnowSprint SET created_date=:now WHERE sprint_id=:sp",
                Map.of("now", now, "sp", sprintId));
        }

        LOG.infof("[LORE] created sprint %s (new=%b)", sprintId, created);
        return new CreateSprintResult(sprintId, created);
    }

    public List<Map<String, Object>> queryPublic(String sql, Map<String, Object> params) {
        return queryRows(sql, params);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> queryRows(String sql, Map<String, Object> params) {
        LoreCommandClient.LoreCommandResult r = client.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql, params)).await().indefinitely();
        return r.result() instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    public IngestReport ingest(String docsRootOverride) {
        // team-docs.root is the trusted base; an override may only point INSIDE it.
        // Canonicalise + containment guard defeats path traversal in the override
        // (CodeQL java/path-injection — dev-only admin endpoint, hardened as defence-in-depth).
        Path base = Paths.get(defaultDocsRoot).toAbsolutePath().normalize();
        Path root = (docsRootOverride == null || docsRootOverride.isBlank())
                ? base
                : Paths.get(docsRootOverride).toAbsolutePath().normalize();
        if (!root.startsWith(base)) {
            return new IngestReport(0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    List.of("docs root must stay within " + base + ": " + root));
        }
        if (!Files.isDirectory(root)) {
            return new IngestReport(0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    List.of("docs root not found: " + root));
        }
        LOG.infof("[LORE INGEST] Starting from %s", root);
        List<String> errors = new java.util.ArrayList<>();

        int adrs         = ingestAdrs(root, errors);
        int decisions    = ingestDecisions(root, errors);
        int sprints      = ingestSprints(root, errors);
        int edges        = buildEdges(root, errors);
        int runbooks     = ingestRunbooks(root, errors);
        int qualityGates = ingestQualityGates(root, errors);
        int docs         = ingestKnowDocs(root, errors);
        int tasks        = ingestBacklogTasks(root, errors);
        int findings     = ingestFindings(root, errors);
        int releases     = ingestReleases(root, errors);

        LOG.infof("[LORE INGEST] Complete: adrs=%d decisions=%d sprints=%d edges=%d " +
                "runbooks=%d qgs=%d docs=%d tasks=%d findings=%d releases=%d errors=%d",
                adrs, decisions, sprints, edges, runbooks, qualityGates,
                docs, tasks, findings, releases, errors.size());
        return new IngestReport(adrs, decisions, sprints, edges,
                runbooks, qualityGates, docs, tasks, findings, releases, errors);
    }

    // ── ADR ingest ────────────────────────────────────────────────────────────

    private int ingestAdrs(Path root, List<String> errors) {
        Path adrDir = root.resolve("engine/specs/adr");
        if (!Files.isDirectory(adrDir)) {
            LOG.warnf("[LORE INGEST] ADR dir not found: %s", adrDir);
            return 0;
        }
        int count = 0;
        try (Stream<Path> files = Files.list(adrDir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    AdrMarkdownParser.ParsedAdr adr = AdrMarkdownParser.parse(file);
                    upsertAdr(adr);
                    count++;
                } catch (Exception e) {
                    errors.add("ADR " + file.getFileName() + ": " + e.getMessage());
                    LOG.warnf("[LORE INGEST] ADR parse error %s: %s", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("ADR dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] ADRs upserted: %d", count);
        return count;
    }

    private void upsertAdr(AdrMarkdownParser.ParsedAdr adr) {
        Map<String, Object> params = new HashMap<>();
        params.put("adr_id",       adr.adrId());
        params.put("name",         nullToEmpty(adr.name()));
        params.put("status",       nullToEmpty(adr.status()));
        params.put("date_created", nullToEmpty(adr.dateCreated()));
        params.put("component_id", nullToEmpty(adr.componentId()));
        params.put("file_path",    nullToEmpty(adr.filePath()));
        params.put("context_md",   nullToEmpty(adr.contextMd()));
        params.put("decision_md",  nullToEmpty(adr.decisionMd()));
        params.put("consequences_md", nullToEmpty(adr.consequencesMd()));

        exec("UPDATE KnowADR SET " +
                "adr_id=:adr_id, name=:name, status=:status, date_created=:date_created, " +
                "component_id=:component_id, file_path=:file_path, " +
                "context_md=:context_md, decision_md=:decision_md, " +
                "consequences_md=:consequences_md " +
                "UPSERT WHERE adr_id=:adr_id", params);
    }

    // ── Decisions ingest ──────────────────────────────────────────────────────

    private int ingestDecisions(Path root, List<String> errors) {
        Path log = root.resolve("DECISIONS_LOG.md");
        if (!Files.isRegularFile(log)) {
            // Try change/ subdirectory
            log = root.resolve("change/DECISIONS_LOG.md");
        }
        if (!Files.isRegularFile(log)) {
            LOG.warnf("[LORE INGEST] DECISIONS_LOG.md not found under %s", root);
            return 0;
        }
        try {
            List<DecisionsLogParser.ParsedDecision> decisions = DecisionsLogParser.parse(log);
            for (DecisionsLogParser.ParsedDecision d : decisions) {
                try {
                    upsertDecision(d);
                } catch (Exception e) {
                    errors.add("Decision #" + d.decisionId() + ": " + e.getMessage());
                }
            }
            LOG.infof("[LORE INGEST] Decisions upserted: %d", decisions.size());
            return decisions.size();
        } catch (IOException e) {
            errors.add("DECISIONS_LOG parse: " + e.getMessage());
            return 0;
        }
    }

    private void upsertDecision(DecisionsLogParser.ParsedDecision d) {
        Map<String, Object> params = new HashMap<>();
        params.put("decision_id", d.decisionId());
        params.put("title",       LoreMarkdownParser.truncate(d.title(), 200));
        params.put("body_md",     LoreMarkdownParser.truncate(d.title(), 5000));

        exec("UPDATE KnowDecision SET decision_id=:decision_id, title=:title, body_md=:body_md " +
                "UPSERT WHERE decision_id=:decision_id", params);
    }

    // ── Sprint ingest ─────────────────────────────────────────────────────────

    private int ingestSprints(Path root, List<String> errors) {
        Path sprintsDir = root.resolve("change/sprints");
        if (!Files.isDirectory(sprintsDir)) {
            LOG.warnf("[LORE INGEST] Sprints dir not found: %s", sprintsDir);
            return 0;
        }
        int count = 0;
        try (Stream<Path> files = Files.list(sprintsDir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    SprintMarkdownParser.ParsedSprint sprint = SprintMarkdownParser.parse(file);
                    upsertSprint(sprint);
                    count++;
                } catch (Exception e) {
                    errors.add("Sprint " + file.getFileName() + ": " + e.getMessage());
                    LOG.warnf("[LORE INGEST] Sprint parse error %s: %s", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("Sprints dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] Sprints upserted: %d", count);
        return count;
    }

    private void upsertSprint(SprintMarkdownParser.ParsedSprint s) {
        Map<String, Object> params = new HashMap<>();
        params.put("sprint_id",    s.sprintId());
        params.put("name",         nullToEmpty(s.name()));
        params.put("status_raw",   nullToEmpty(s.statusRaw()));
        params.put("priority",     nullToEmpty(s.priority()));
        params.put("date_created", nullToEmpty(s.dateCreated()));
        params.put("plan_id",      nullToEmpty(s.planId()));
        params.put("outcome_md",   nullToEmpty(s.outcomeMd()));

        exec("UPDATE KnowSprint SET " +
                "sprint_id=:sprint_id, name=:name, status_raw=:status_raw, " +
                "priority=:priority, date_created=:date_created, " +
                "plan_id=:plan_id, outcome_md=:outcome_md " +
                "UPSERT WHERE sprint_id=:sprint_id", params);
    }

    // ── Edge building ─────────────────────────────────────────────────────────

    private int buildEdges(Path root, List<String> errors) {
        int edgeCount = 0;
        // BELONGS_TO: KnowADR → LoreComponent (by component_id prefix)
        Path adrDir = root.resolve("engine/specs/adr");
        if (Files.isDirectory(adrDir)) {
            try (Stream<Path> files = Files.list(adrDir)) {
                for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                    try {
                        AdrMarkdownParser.ParsedAdr adr = AdrMarkdownParser.parse(file);
                        if (adr.componentId() != null) {
                            edgeCount += createEdgeIfVerticesExist(
                                    "BELONGS_TO",
                                    "KnowADR", "adr_id", adr.adrId(),
                                    "LoreComponent", "component_id", adr.componentId(),
                                    errors);
                        }
                        // DEPENDS_ON edges
                        for (String dep : adr.dependsOnIds()) {
                            edgeCount += createEdgeIfVerticesExist(
                                    "DEPENDS_ON",
                                    "KnowADR", "adr_id", adr.adrId(),
                                    "KnowADR", "adr_id", dep,
                                    errors);
                        }
                    } catch (Exception e) {
                        // already logged in ingestAdrs
                    }
                }
            } catch (IOException e) {
                errors.add("Edge build ADR walk: " + e.getMessage());
            }
        }
        LOG.infof("[LORE INGEST] Edges created: %d", edgeCount);
        return edgeCount;
    }

    /**
     * Creates an edge FROM (source) TO (target) only if both vertices exist.
     * Uses IF NOT EXISTS to avoid duplicates on re-run.
     */
    private int createEdgeIfVerticesExist(
            String edgeType,
            String fromType, String fromField, String fromVal,
            String toType,   String toField,   String toVal,
            List<String> errors) {
        try {
            exec("CREATE EDGE " + edgeType +
                    " FROM (SELECT FROM " + fromType + " WHERE " + fromField + "=:from_val)" +
                    " TO   (SELECT FROM " + toType   + " WHERE " + toField   + "=:to_val)" +
                    " IF NOT EXISTS",
                    Map.of("from_val", fromVal, "to_val", toVal));
            return 1;
        } catch (Exception e) {
            // Not an error if one vertex doesn't exist yet — skip silently
            LOG.tracef("[LORE INGEST] Edge %s %s→%s skipped: %s",
                    edgeType, fromVal, toVal, e.getMessage());
            return 0;
        }
    }

    // ── KnowRunbook ingest (LAL-29) ───────────────────────────────────────────

    private int ingestRunbooks(Path root, List<String> errors) {
        Path dir = root.resolve("run/runbooks");
        if (!Files.isDirectory(dir)) {
            LOG.warnf("[LORE INGEST] Runbooks dir not found: %s", dir);
            return 0;
        }
        int count = 0;
        try (Stream<Path> files = Files.list(dir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    KnowRunbookParser.ParsedRunbook rb = KnowRunbookParser.parse(file);
                    upsertRunbook(rb);
                    count++;
                } catch (Exception e) {
                    errors.add("Runbook " + file.getFileName() + ": " + e.getMessage());
                    LOG.warnf("[LORE INGEST] Runbook parse error %s: %s", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("Runbooks dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] Runbooks upserted: %d", count);
        return count;
    }

    private void upsertRunbook(KnowRunbookParser.ParsedRunbook rb) {
        Map<String, Object> params = new HashMap<>();
        params.put("runbook_id",  rb.runbookId());
        params.put("name",        nullToEmpty(rb.name()));
        params.put("area",        nullToEmpty(rb.area()));
        params.put("date_created", nullToEmpty(rb.dateCreated()));
        params.put("content_md",  nullToEmpty(rb.contentMd()));

        exec("UPDATE KnowRunbook SET " +
                "runbook_id=:runbook_id, name=:name, area=:area, " +
                "date_created=:date_created, content_md=:content_md " +
                "UPSERT WHERE runbook_id=:runbook_id", params);
    }

    // ── QualityGate + QGMetric ingest (LAL-28) ────────────────────────────────

    private int ingestQualityGates(Path root, List<String> errors) {
        Path dir = root.resolve("engine/quality-gates");
        if (!Files.isDirectory(dir)) {
            LOG.warnf("[LORE INGEST] Quality-gates dir not found: %s", dir);
            return 0;
        }
        int count = 0;
        try (Stream<Path> files = Files.list(dir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    QualityGateParser.ParsedQualityGate qg = QualityGateParser.parse(file);
                    upsertQualityGate(qg);
                    for (QualityGateParser.ParsedMetric metric : qg.metrics()) {
                        upsertQGMetric(qg.qgId(), metric);
                    }
                    count++;
                } catch (Exception e) {
                    errors.add("QG " + file.getFileName() + ": " + e.getMessage());
                    LOG.warnf("[LORE INGEST] QG parse error %s: %s", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("QG dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] QualityGates upserted: %d", count);
        return count;
    }

    private void upsertQualityGate(QualityGateParser.ParsedQualityGate qg) {
        Map<String, Object> params = new HashMap<>();
        params.put("qg_id",        qg.qgId());
        params.put("name",         nullToEmpty(qg.name()));
        params.put("description",  nullToEmpty(qg.description()));
        params.put("component_id", nullToEmpty(qg.componentId()));
        params.put("status",       nullToEmpty(qg.status()));
        params.put("date_created", nullToEmpty(qg.dateCreated()));
        params.put("content_md",   nullToEmpty(qg.contentMd()));

        exec("UPDATE QualityGate SET " +
                "qg_id=:qg_id, name=:name, description=:description, " +
                "component_id=:component_id, status=:status, " +
                "date_created=:date_created, content_md=:content_md " +
                "UPSERT WHERE qg_id=:qg_id", params);
    }

    private void upsertQGMetric(String qgId, QualityGateParser.ParsedMetric metric) {
        Map<String, Object> params = new HashMap<>();
        params.put("metric_id",  metric.metricId());
        params.put("name",       LoreMarkdownParser.truncate(metric.name(), 500));
        params.put("threshold",  LoreMarkdownParser.truncate(metric.threshold(), 200));

        exec("UPDATE QGMetric SET metric_id=:metric_id, name=:name, threshold=:threshold " +
                "UPSERT WHERE metric_id=:metric_id", params);

        // MEASURED_BY edge QualityGate → QGMetric
        createEdgeIfVerticesExist("MEASURED_BY",
                "QualityGate", "qg_id",     qgId,
                "QGMetric",    "metric_id", metric.metricId(),
                new java.util.ArrayList<>());
    }

    // ── KnowTask standalone ingest (LAL-31) ──────────────────────────────────

    private int ingestBacklogTasks(Path root, List<String> errors) {
        Path dir = root.resolve("backlog");
        if (!Files.isDirectory(dir)) return 0;
        int count = 0;
        try (Stream<Path> files = Files.list(dir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    String content = Files.readString(file, java.nio.charset.StandardCharsets.UTF_8);
                    Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);
                    String taskUid = file.getFileName().toString().replace(".md", "");
                    String title = null;
                    for (String line : content.split("\n", 10)) {
                        if (line.startsWith("# ")) { title = line.substring(2).strip(); break; }
                    }
                    if (title == null) title = taskUid;

                    Map<String, Object> params = new HashMap<>();
                    params.put("task_uid",   taskUid);
                    params.put("task_id",    taskUid);
                    params.put("title",      LoreMarkdownParser.truncate(title, 500));
                    params.put("status_raw", nullToEmpty(kv.get("Статус")));
                    params.put("priority",   nullToEmpty(kv.get("Приоритет")));
                    params.put("summary_md", LoreMarkdownParser.truncate(content, 20_000));

                    exec("UPDATE KnowTask SET task_uid=:task_uid, task_id=:task_id, " +
                            "title=:title, status_raw=:status_raw, priority=:priority, " +
                            "summary_md=:summary_md " +
                            "UPSERT WHERE task_uid=:task_uid", params);
                    count++;
                } catch (Exception e) {
                    errors.add("BacklogTask " + file.getFileName() + ": " + e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("Backlog dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] Backlog tasks upserted: %d", count);
        return count;
    }

    // ── KnowFinding ingest (LAL-31) ───────────────────────────────────────────

    private int ingestFindings(Path root, List<String> errors) {
        Path dir = root.resolve("craft/research");
        if (!Files.isDirectory(dir)) return 0;
        int count = 0;
        try (Stream<Path> files = Files.list(dir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".md")).toList()) {
                try {
                    String content = Files.readString(file, java.nio.charset.StandardCharsets.UTF_8);
                    Map<String, String> kv = LoreMarkdownParser.parseHeaderKV(content);
                    String findingId = nullToEmpty(kv.get("Документ")).replace("`", "").trim();
                    if (findingId.isBlank())
                        findingId = file.getFileName().toString().replace(".md", "");

                    String sourceSprint = nullToEmpty(kv.get("Связано"));
                    String status = nullToEmpty(kv.get("Статус"));

                    Map<String, Object> params = new HashMap<>();
                    params.put("finding_id",    findingId);
                    params.put("type",          "research");
                    params.put("verified",      status.toLowerCase().contains("done")
                                                 || status.contains("✅"));
                    params.put("source_sprint", LoreMarkdownParser.truncate(sourceSprint, 200));
                    params.put("summary_md",    LoreMarkdownParser.truncate(content, 20_000));

                    exec("UPDATE KnowFinding SET finding_id=:finding_id, type=:type, " +
                            "verified=:verified, source_sprint=:source_sprint, " +
                            "summary_md=:summary_md " +
                            "UPSERT WHERE finding_id=:finding_id", params);
                    count++;
                } catch (Exception e) {
                    errors.add("Finding " + file.getFileName() + ": " + e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("Findings dir walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] Findings upserted: %d", count);
        return count;
    }

    // ── KnowDoc ingest (LAL-30) ───────────────────────────────────────────────

    private int ingestKnowDocs(Path root, List<String> errors) {
        Path engineDir = root.resolve("engine");
        if (!Files.isDirectory(engineDir)) {
            LOG.warnf("[LORE INGEST] Engine dir not found: %s", engineDir);
            return 0;
        }
        int count = 0;
        try (Stream<Path> files = Files.walk(engineDir)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".html")).toList()) {
                try {
                    KnowDocParser.ParsedKnowDoc doc = KnowDocParser.parse(file, root);
                    upsertKnowDoc(doc);
                    count++;
                } catch (Exception e) {
                    errors.add("KnowDoc " + file.getFileName() + ": " + e.getMessage());
                    LOG.warnf("[LORE INGEST] KnowDoc parse error %s: %s", file.getFileName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            errors.add("KnowDoc walk: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] KnowDocs upserted: %d", count);
        return count;
    }

    private void upsertKnowDoc(KnowDocParser.ParsedKnowDoc doc) {
        Map<String, Object> params = new HashMap<>();
        params.put("doc_id",       doc.docId());
        params.put("title",        nullToEmpty(doc.title()));
        params.put("kind",         nullToEmpty(doc.kind()));
        params.put("has_ext_deps", doc.hasExtDeps());
        params.put("component_id", nullToEmpty(doc.componentId()));
        params.put("file_path",    nullToEmpty(doc.filePath()));
        params.put("content_html", nullToEmpty(doc.contentHtml()));

        exec("UPDATE KnowDoc SET " +
                "doc_id=:doc_id, title=:title, kind=:kind, " +
                "has_ext_deps=:has_ext_deps, component_id=:component_id, " +
                "file_path=:file_path, content_html=:content_html " +
                "UPSERT WHERE doc_id=:doc_id", params);
    }

    // ── Infrastructure ────────────────────────────────────────────────────────

    // ── Releases ingest (RELEASE_PROD_INDEX.md → KnowRelease) ───────────────────
    // Mirrors scripts/lore-sync-releases.mjs: parse the release index and UPDATE
    // existing KnowRelease with release_date / is_current / description_md. No
    // UPSERT — new releases are seeded elsewhere; a non-existent id updates 0 rows.
    private static final Pattern RELEASE_HEADER = Pattern.compile(
        "^## (v[\\d.]+(?:\\s*/\\s*v[\\d.]+)?)\\s*[—–-]\\s*(\\d{4}-\\d{2}-\\d{2})(.*)");
    private static final Pattern REL_CURRENT  = Pattern.compile("⭐\\s*CURRENT", Pattern.CASE_INSENSITIVE);
    private static final Pattern REL_PREV      = Pattern.compile("(ранее|previously)\\s+CURRENT", Pattern.CASE_INSENSITIVE);
    private static final Pattern REL_DESC      = Pattern.compile("\\(([^)]{4,})\\)\\s*$");

    private int ingestReleases(Path root, List<String> errors) {
        Path md = root.resolve("RELEASE_PROD_INDEX.md");
        if (!Files.isRegularFile(md)) {
            LOG.warnf("[LORE INGEST] RELEASE_PROD_INDEX.md not found under %s", root);
            return 0;
        }
        int count = 0;
        java.util.Set<String> seen = new java.util.HashSet<>();
        try {
            for (String line : Files.readAllLines(md, StandardCharsets.UTF_8)) {
                Matcher m = RELEASE_HEADER.matcher(line);
                if (!m.find()) continue;
                String versionPart = m.group(1).trim();
                String date        = m.group(2);
                String rest        = m.group(3) == null ? "" : m.group(3);

                boolean isCurrent = REL_CURRENT.matcher(rest).find() && !REL_PREV.matcher(rest).find();

                String description = null;
                Matcher dm = REL_DESC.matcher(rest);
                if (dm.find()) {
                    String d = dm.group(1).trim();
                    if (!d.matches("(?i)^(ранее|previously)\\s+CURRENT$")) {
                        description = d.length() > 400 ? d.substring(0, 400) : d;
                    }
                }

                for (String v : versionPart.split("\\s*/\\s*")) {
                    String rid = v.trim();
                    if (rid.isEmpty() || !seen.add(rid)) continue;
                    Map<String, Object> params = new HashMap<>();
                    params.put("release_id",     rid);
                    params.put("release_date",   date);
                    params.put("description_md", nullToEmpty(description));
                    // is_current is a boolean literal — ArcadeDB rejects boolean params in SET.
                    exec("UPDATE KnowRelease SET release_date=:release_date, " +
                            "is_current=" + isCurrent + ", description_md=:description_md " +
                            "WHERE release_id=:release_id", params);
                    count++;
                }
            }
        } catch (IOException e) {
            errors.add("RELEASE_PROD_INDEX parse: " + e.getMessage());
        }
        LOG.infof("[LORE INGEST] Releases processed: %d", count);
        return count;
    }

    private void exec(String sql, Map<String, Object> params) {
        client.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql, params))
              .await().indefinitely();
    }

    private String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
                (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    private static String nullToEmpty(String s) {
        return s != null ? s : "";
    }
}
