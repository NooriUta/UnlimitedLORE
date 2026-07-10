package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;
import studio.seer.heimdall.bench.MartClient;
import studio.seer.heimdall.bench.MartQuery;
import jakarta.ws.rs.BeanParam;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Read-only viewer API over the system_aida_lore engineering knowledge base.
 *
 * GET /lore/slices          → available named slices with their params
 * GET /lore/slice/{id}      → {"rows": [...]} for a named slice (+query params)
 *
 * Disabled by default (lore.enabled=false) → 404 LORE_DISABLED.
 * Pattern: BenchMartResource.
 */
@Path("/lore")
public class AidaLoreResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(AidaLoreResource.class);

    public record SliceInfo(String id, List<String> required, List<String> optional) {}

    // SAFE_ID, ENTITY_TYPES/PLAN_STATUSES/ADR_STATUSES/SCD2_STATUS_RAW, the
    // ArcadeDB clients, config, and shared helpers all live in LoreResourceBase
    // now (B2 God-class split) — every write-path domain (release/adr/spec/
    // sprint/task/qg/status/...) has its own resource class; this one is left
    // holding the read-only slice API + the admin ingest endpoint.

    @GET
    @Path("slices")
    @Produces(MediaType.APPLICATION_JSON)
    public Response slices() {
        if (!enabled) return disabled();
        List<SliceInfo> infos = LoreSlices.ids().stream()
            .map(id -> {
                LoreSlices.SliceDef def = LoreSlices.get(id);
                return new SliceInfo(id, def.required(), List.copyOf(def.optionalFilters().keySet()));
            })
            .toList();
        return noStore(Response.ok(Map.of("slices", infos)));
    }

    // ── Analytics: pre-aggregated dashboard data ─────────────────────────────
    // Computed in Java from a handful of light queries (KnowTaskHist current rows
    // instead of per-task HAS_STATE traversal — fast). Tasks are mapped to sprints
    // by task_uid prefix; sprints to components by the explicit BELONGS_TO edge.

    private static String classifyStatus(String s) {
        if (s == null || s.isBlank()) return "none";   // status not set ≠ TODO
        String u = s.toUpperCase();
        if (u.contains("DONE") || u.contains("CLOSED") || u.contains("ЗАВЕРШ")) return "done";
        if (u.contains("PROGRESS") || u.contains("WIP"))                        return "in_progress";
        if (u.contains("PARTIAL") || u.contains("ЧАСТИЧ"))                      return "partial";
        if (u.contains("READY") || u.contains("ДЕПЛО"))                         return "ready_for_deploy";
        if (u.contains("BLOCK") || u.contains("ЗАБЛОК"))                        return "blocked";
        if (u.contains("CANCEL") || u.contains("ОТМЕН"))                        return "cancelled";
        if (u.contains("PLANNED"))                                             return "planned";
        if (u.contains("DESIGN"))                                              return "design";
        if (u.contains("BACKLOG"))                                             return "backlog";
        if (u.contains("DEFER") || u.contains("ОТЛОЖ"))                        return "deferred";
        return "todo";
    }

    @SuppressWarnings("unchecked")
    private static String firstStr(Object v) {
        if (v == null) return null;
        if (v instanceof List<?> l) return l.isEmpty() ? null : String.valueOf(l.get(0));
        return String.valueOf(v);
    }

    @GET
    @Path("analytics")
    @Produces(MediaType.APPLICATION_JSON)
    public Response analytics(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> comps = ingestService.queryPublic(
                "SELECT component_id, full_name, area FROM LoreComponent", Map.of());
            List<Map<String, Object>> links = ingestService.queryPublic(
                "SELECT @out.sprint_id AS s, @in.component_id AS c FROM BELONGS_TO WHERE @out.sprint_id IS NOT NULL", Map.of());
            List<Map<String, Object>> sprints = ingestService.queryPublic(
                "SELECT sprint_id, out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw FROM KnowSprint", Map.of());
            List<Map<String, Object>> taskRows = ingestService.queryPublic(
                "SELECT in('HAS_STATE').task_uid AS tuid, status_raw, effort_days FROM KnowTaskHist WHERE valid_to IS NULL", Map.of());
            List<Map<String, Object>> releases = ingestService.queryPublic(
                "SELECT git_tag, git_project, is_current FROM KnowRelease", Map.of());

            // ── Tasks: dedupe by task_uid (SCD2 may leave >1 open row), classify ──
            Map<String, String> taskStatus = new LinkedHashMap<>();
            Map<String, Double> taskEffortMap = new LinkedHashMap<>(); // task_uid -> effort_days
            for (Map<String, Object> r : taskRows) {
                String tuid = firstStr(r.get("tuid"));
                if (tuid == null) continue;
                String cls = classifyStatus((String) r.get("status_raw"));
                // prefer a "done" classification on collision
                String prev = taskStatus.get(tuid);
                if (prev == null || (!"done".equals(prev) && "done".equals(cls))) taskStatus.put(tuid, cls);
                // collect effort_days (first non-null wins)
                if (!taskEffortMap.containsKey(tuid)) {
                    Object ed = r.get("effort_days");
                    if (ed instanceof Number n) taskEffortMap.put(tuid, n.doubleValue());
                }
            }
            Map<String, Integer> tasksByStatus = new LinkedHashMap<>();
            Map<String, int[]> perSprint = new LinkedHashMap<>(); // sprint_id -> [total, done]
            Map<String, double[]> perSprintEffort = new LinkedHashMap<>(); // sprint_id -> [effort_sum]
            for (Map.Entry<String, String> e : taskStatus.entrySet()) {
                String tuid = e.getKey(), cls = e.getValue();
                tasksByStatus.merge(cls, 1, Integer::sum);
                int slash = tuid.indexOf('/');
                if (slash < 0) slash = tuid.indexOf(':');
                String sid = slash > 0 ? tuid.substring(0, slash) : tuid;
                int[] td = perSprint.computeIfAbsent(sid, k -> new int[2]);
                td[0]++;
                if ("done".equals(cls)) td[1]++;
                Double ef = taskEffortMap.get(tuid);
                if (ef != null) perSprintEffort.computeIfAbsent(sid, k -> new double[1])[0] += ef;
            }

            // ── Sprints by status ──
            Map<String, Integer> sprintsByStatus = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintsByStatus.merge(classifyStatus((String) sp.get("status_raw")), 1, Integer::sum);

            // ── Per-component rollup over explicitly linked sprints ──
            Map<String, List<String>> compSprints = new LinkedHashMap<>();
            for (Map<String, Object> lnk : links) {
                String s = (String) lnk.get("s"), c = (String) lnk.get("c");
                if (s == null || c == null) continue;
                compSprints.computeIfAbsent(c, k -> new ArrayList<>()).add(s);
            }
            Map<String, Map<String, Object>> compMeta = new LinkedHashMap<>();
            for (Map<String, Object> c : comps)
                compMeta.put((String) c.get("component_id"), c);

            List<Map<String, Object>> byComponent = new ArrayList<>();
            for (Map.Entry<String, List<String>> e : compSprints.entrySet()) {
                String cid = e.getKey();
                int total = 0, done = 0;
                for (String sid : e.getValue()) {
                    int[] td = perSprint.get(sid);
                    if (td != null) { total += td[0]; done += td[1]; }
                }
                Map<String, Object> meta = compMeta.getOrDefault(cid, Map.of());
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("component_id", cid);
                row.put("full_name", meta.get("full_name"));
                row.put("area", meta.get("area"));
                row.put("sprint_count", e.getValue().size());
                row.put("task_total", total);
                row.put("task_done", done);
                byComponent.add(row);
            }
            byComponent.sort((a, b) -> ((Integer) b.get("sprint_count")) - ((Integer) a.get("sprint_count")));

            // ── Per-sprint rows (only sprints that have tasks) ──
            Map<String, String> sprintStatusMap = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintStatusMap.put((String) sp.get("sprint_id"), (String) sp.get("status_raw"));
            List<Map<String, Object>> bySprint = new ArrayList<>();
            for (Map.Entry<String, int[]> e : perSprint.entrySet()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("sprint_id", e.getKey());
                row.put("status_raw", sprintStatusMap.get(e.getKey()));
                row.put("task_total", e.getValue()[0]);
                row.put("task_done", e.getValue()[1]);
                double[] ef = perSprintEffort.get(e.getKey());
                if (ef != null) row.put("effort_days_sum", Math.round(ef[0] * 10.0) / 10.0);
                bySprint.add(row);
            }
            bySprint.sort((a, b) -> ((Integer) b.get("task_total")) - ((Integer) a.get("task_total")));

            // ── Releases by project ──
            Map<String, Integer> relByProject = new LinkedHashMap<>();
            List<String> currentTags = new ArrayList<>();
            for (Map<String, Object> r : releases) {
                String p = (String) r.get("git_project");
                relByProject.merge(p == null ? "—" : p, 1, Integer::sum);
                if (Boolean.TRUE.equals(r.get("is_current"))) currentTags.add((String) r.get("git_tag"));
            }

            int taskTotal = taskStatus.size();
            int taskDone = tasksByStatus.getOrDefault("done", 0);
            Map<String, Object> totals = new LinkedHashMap<>();
            totals.put("sprints", sprints.size());
            totals.put("tasks", taskTotal);
            totals.put("tasks_done", taskDone);
            totals.put("releases", releases.size());
            totals.put("components", comps.size());

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("totals", totals);
            out.put("tasks_by_status", tasksByStatus);
            out.put("sprints_by_status", sprintsByStatus);
            out.put("by_component", byComponent);
            out.put("by_sprint", bySprint);
            out.put("releases_by_project", relByProject);
            out.put("current_releases", currentTags);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ANALYTICS] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @GET
    @Path("slice/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> slice(@PathParam("id") String id, @Context UriInfo uriInfo) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (LoreSlices.get(id) == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("UNKNOWN_SLICE", id))));
        }

        Map<String, String> given = new LinkedHashMap<>();
        uriInfo.getQueryParameters().forEach((k, v) -> {
            if (v != null && !v.isEmpty()) given.put(k, v.get(0));
        });

        LoreSlices.Composed composed;
        try {
            composed = LoreSlices.compose(id, given);
        } catch (IllegalArgumentException e) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", e.getMessage()))));
        }

        MartQuery body = new MartQuery("sql", composed.sql(),
            composed.params().isEmpty() ? null : composed.params(), -1);
        LOG.debugf("[LORE:%s] %s %s", db, id, composed.params());

        return client.query(db, basicAuth(), body)
            .map(res -> noStore(Response.ok(Map.of("rows",
                res.result() == null ? List.of() : res.result()))))
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE FAILED] slice=%s: %s", id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", String.valueOf(ex.getMessage()))));
            });
    }

    // ── Admin: ingest pipeline (Phase 2, LAL-13) ─────────────────────────────

    @POST
    @Path("/admin/lore/ingest")
    @Produces(MediaType.APPLICATION_JSON)
    public Response adminIngest(
            @HeaderParam("X-Seer-Role") String role,
            @QueryParam("docsRoot") String docsRoot) {
        if (!enabled) return disabled();
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required")));
        }
        LoreIngestService.IngestReport report = ingestService.ingest(docsRoot);
        java.util.LinkedHashMap<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("ok",           report.errors().isEmpty());
        result.put("adrs",         report.adrs());
        result.put("decisions",    report.decisions());
        result.put("sprints",      report.sprints());
        result.put("edges",        report.edges());
        result.put("runbooks",     report.runbooks());
        result.put("qualityGates", report.qualityGates());
        result.put("docs",         report.docs());
        result.put("tasks",        report.tasks());
        result.put("findings",     report.findings());
        result.put("releases",     report.releases());
        result.put("errors",       report.errors());
        return noStore(Response.ok(result));
    }

}
