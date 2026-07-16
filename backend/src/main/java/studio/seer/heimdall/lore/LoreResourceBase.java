package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartClient;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Shared infrastructure for the LORE REST resources (B2 God-class split). Holds
 * the ArcadeDB clients, config, the JSON error contract, and the small helpers
 * every domain resource needs. Concrete resources extend this so a per-domain
 * class (AidaLoreResource, LoreBragiResource, …) inherits them without changing
 * a single call site. All members are package-private — every LORE resource
 * lives in this package.
 */
public abstract class LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreResourceBase.class);

    // task_uid carries a '/' (e.g. SPRINT_X/SH-1); all values are bound as SQL params, never concatenated.
    static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9_./\\-]{1,100}");

    // Canonical source of truth for these vocabularies: shared/lore-statuses.json.
    // Drift between this mirror and the JSON is caught by LoreStatusesConsistencyTest
    // (JUnit). The MCP + frontend mirrors are guarded by scripts/check-lore-statuses.mjs.
    // Package-private (not private) so LoreStatusesConsistencyTest can assert them
    // against shared/lore-statuses.json. Shared here (not just the status dispatcher's
    // own resource) because sprint/task creation also validates against PLAN_STATUSES.
    static final Set<String> ENTITY_TYPES =
        Set.of("plan_item", "sprint", "task", "checkpoint", "adr", "phase");
    static final Set<String> PLAN_STATUSES =
        Set.of("todo", "active", "partial", "done", "blocked", "high", "cancelled",
               "planned", "backlog", "design", "ready_for_deploy");
    static final Set<String> ADR_STATUSES =
        Set.of("proposed", "accepted", "draft", "deferred", "superseded");

    // Canonical status token → status_raw string written on KnowSprintHist / KnowTaskHist.
    // Mirrors the leading-marker convention the frontend normalizer (LoreSprintDetail) reads back.
    // 🟡 PARTIAL is a distinct status from 🔄 IN PROGRESS — see lore-status.ts taskTick.
    static final Map<String, String> SCD2_STATUS_RAW = Map.ofEntries(
        Map.entry("done",             "✅ DONE"),
        Map.entry("active",           "🔄 IN PROGRESS"),
        Map.entry("partial",          "🟡 PARTIAL"),
        Map.entry("todo",             "⬜ TODO"),
        Map.entry("planned",          "📋 PLANNED"),
        Map.entry("blocked",          "🔴 BLOCKED"),
        Map.entry("high",             "🔴 P0"),
        Map.entry("cancelled",        "🚫 CANCELLED"),
        Map.entry("ready_for_deploy", "🚀 READY FOR DEPLOY"),
        Map.entry("backlog",          "🟣 BACKLOG"),
        Map.entry("design",           "🔬 DESIGN"));

    /** JSON error body returned by every LORE endpoint (and LoreExceptionMapper). */
    public record LoreError(String error, String detail) {}

    @ConfigProperty(name = "lore.enabled", defaultValue = "false")
    boolean enabled;

    @ConfigProperty(name = "lore.db", defaultValue = "system_aida_lore")
    String db;

    @ConfigProperty(name = "bench.mart.user", defaultValue = "root")
    String user;

    @ConfigProperty(name = "bench.mart.password", defaultValue = "")
    String password;

    @Inject
    @RestClient
    MartClient client;

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    // Shared by most write domains (task/phase/sprint/milestone/QG all read via
    // ingestService.queryPublic before deciding whether to create/skip an edge).
    @Inject
    LoreIngestService ingestService;

    // Throws LoreExceptions.Forbidden (→ 403 JSON via LoreExceptionMapper) when the
    // caller is not admin/superadmin. Call as a guard: `requireAdmin(role);`.
    void requireAdmin(String role) {
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            throw new LoreExceptions.Forbidden("admin role required");
        }
    }

    Response badParams(String msg) {
        return noStore(Response.status(Response.Status.BAD_REQUEST)
            .entity(new LoreError("BAD_PARAMS", msg)));
    }

    Response disabled() {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("LORE_DISABLED",
                "lore.enabled=false (lore is dev-only)")));
    }

    String basicAuth() {
        return "Basic " + Base64.getEncoder().encodeToString(
            (user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    /** Param map that tolerates null values (Map.of forbids them) — used for nullable note_md. */
    static Map<String, Object> mapOfNullable(Object... kv) {
        Map<String, Object> m = new java.util.HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /**
     * The HAS_STATE edge that links an entity vertex to its (new or initial) SCD2
     * history row. Byte-for-byte identical across every LORE type — only the
     * vertex/hist class and key field change (B1). Same SQL, same :id/:nsid params.
     */
    static LoreCommandClient.LoreCommand linkStateCmd(
            String vertexType, String histType, String keyField, String id, String nsid) {
        return new LoreCommandClient.LoreCommand("sql",
            "CREATE EDGE HAS_STATE FROM (SELECT FROM " + vertexType + " WHERE " + keyField + " = :id) " +
            "TO (SELECT FROM " + histType + " WHERE state_uid = :nsid)",
            Map.of("id", id, "nsid", nsid));
    }

    static Response noStore(Response.ResponseBuilder builder) {
        return builder.type(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").build();
    }

    /**
     * ADR-LORE-012 level B: component → area dictionary edge (IN_AREA). Keeps
     * the edge in sync with LoreComponent.area (dual-write: the string stays
     * for existing readers, the edge enables graph traversal). Shared between
     * LoreComponentResource (component/create, component/update) and
     * LoreDictResource (dict/backfill-area) — same rationale as linkStateCmd
     * (B1): identical logic, two call sites, belongs in the base. DELETE EDGE
     * is unreliable on ArcadeDB → remove by @rid, then create the new edge.
     * Best-effort: swallows its own failures so an edge-relink hiccup never
     * fails the caller's primary write.
     */
    void relinkAreaEdge(String cid, String area) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT outE('IN_AREA').@rid AS rids FROM LoreComponent WHERE component_id=:cid",
                Map.of("cid", cid));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM IN_AREA WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (area != null && !area.isBlank()) {
                // String.format (not named params) — matches the PARENT_OF edge path;
                // ArcadeDB CREATE EDGE does not bind named params in FROM/TO subqueries.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE IN_AREA FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM KnowDictEntry WHERE dict_type='area' AND code='%s')",
                    cid, area))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE IN_AREA] relink %s→%s failed: %s", cid, area, e.getMessage());
        }
    }

    /**
     * Keep the DOCUMENTED_IN edge in sync with a spec's component_id field.
     *
     * Same class of bug as T01/PARENT_OF: spec upsert wrote only the field, while
     * the component passport reads out('DOCUMENTED_IN').spec_id — so specs created
     * with component_id simply never appeared on their component (107 such vertices
     * against 135 edges, all of the latter left over from the old git-ETL).
     *
     * Direction is component → spec (the component documents itself in the spec),
     * matching how the `component` slice traverses it. Blank component detaches.
     */
    void relinkSpecComponentEdge(String specId, String componentId) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT inE('DOCUMENTED_IN').@rid AS rids FROM KnowSpec WHERE spec_id=:sid",
                Map.of("sid", specId));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM DOCUMENTED_IN WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (componentId != null && !componentId.isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE DOCUMENTED_IN FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM KnowSpec WHERE spec_id='%s')",
                    componentId, specId))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE DOCUMENTED_IN] relink spec %s→component %s failed: %s", specId, componentId, e.getMessage());
        }
    }

    /**
     * T01 (REC-QG-LORE-STORAGE-001): keep the PARENT_OF edge in sync with the
     * parent_id field. component/update used to write only the field, so the
     * component-tree UI (which reads in('PARENT_OF')) never saw the move — 9
     * drifted vertices. Mirror of relinkAreaEdge: drop the child's incoming
     * PARENT_OF, then create the new one (parent → child). Blank parent detaches.
     */
    void relinkParentEdge(String cid, String parentId) {
        try {
            // Convention (component/create): PARENT_OF goes child → parent, so the
            // child's parent link is its OUTgoing edge. Drop it, then recreate.
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT outE('PARENT_OF').@rid AS rids FROM LoreComponent WHERE component_id=:cid",
                Map.of("cid", cid));
            if (!rows.isEmpty() && rows.get(0).get("rids") instanceof List<?> rids) {
                for (Object rid : rids) {
                    if (rid == null) continue;
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM PARENT_OF WHERE @rid=" + rid)).await().indefinitely();
                }
            }
            if (parentId != null && !parentId.isBlank()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    String.format(
                    "CREATE EDGE PARENT_OF FROM (SELECT FROM LoreComponent WHERE component_id='%s') " +
                    "TO (SELECT FROM LoreComponent WHERE component_id='%s')",
                    cid, parentId))).await().indefinitely();
            }
        } catch (Exception e) {
            LOG.warnf("[LORE PARENT_OF] relink %s→parent %s failed: %s", cid, parentId, e.getMessage());
        }
    }

    static String str(Object o) {
        return o == null ? "" : o.toString().trim();
    }
}
