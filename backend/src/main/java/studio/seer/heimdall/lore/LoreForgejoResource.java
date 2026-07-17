package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Forgejo-мост REST (ADR-LORE-024, FJ-03): граф-контекстные git-операции —
 * PR с телом из KnowRelease, merge строго по гейту §10 (только GREEN),
 * авто-линк PR→релиз→спринт на merge (FJ-05). Операционный CI/CD (логи,
 * dispatch) сюда НЕ входит — это дом forgejo-mcp (§9); branch protection
 * читаем, никогда не пишем (решение 136).
 *
 * Pluggable: без FORGEJO_API_TOKEN все эндпоинты отвечают 503 — LORE без
 * self-hosted Forgejo работает как раньше. Токен живёт в SecretProvider и
 * не появляется ни в одном ответе или логе.
 */
@Path("/lore/forgejo")
public class LoreForgejoResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreForgejoResource.class);

    @Inject
    ForgejoBridge bridge;

    private Response notConfigured() {
        return noStore(Response.status(503).entity(new LoreError("FORGEJO_NOT_CONFIGURED",
            "forgejo bridge not configured (" + ForgejoBridge.FORGEJO_TOKEN_KEY + " unset) — fallback: tea CLI, §9")));
    }

    private Response projectNotResolvable(String slug) {
        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("PROJECT_NOT_RESOLVABLE",
                "KnowGitProject '" + slug + "' отсутствует или hosts[] без primary base_url — "
                + "зарегистрируйте проект (project_new) с hosts")));
    }

    /** Живость моста — для условной регистрации MCP-инструментов (FJ-04). */
    @GET
    @Path("health")
    @Produces(MediaType.APPLICATION_JSON)
    public Response health(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        return noStore(Response.ok(Map.of("configured", bridge.configured())));
    }

    // ── PR: создать с телом из KnowRelease ──────────────────────────────────

    public record PrCreateRequest(String git_project, String head, String base,
                                  String title, String release_id, String body_md) {}

    @POST
    @Path("pr")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createPr(PrCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!bridge.configured()) return notConfigured();
        if (req == null || str(req.git_project()).isEmpty() || str(req.head()).isEmpty())
            return badParams("git_project and head required");
        Optional<ForgejoBridge.Repo> repo = bridge.resolve(req.git_project());
        if (repo.isEmpty()) return projectNotResolvable(req.git_project());
        try {
            String base = str(req.base()).isEmpty() ? "develop" : req.base();
            String body = str(req.body_md());
            String title = str(req.title());
            if (!str(req.release_id()).isEmpty()) {
                // Тело PR из KnowRelease (ADR-024 §9: за этим мост и нужен).
                List<Map<String, Object>> rel = ingestService.queryPublic(
                    "SELECT description_md FROM KnowRelease WHERE release_uid=:ruid",
                    Map.of("ruid", req.git_project() + "#" + req.release_id()));
                if (rel.isEmpty())
                    return badParams("release " + req.release_id() + " not found for " + req.git_project()
                        + " — создайте KnowRelease (release_new) до PR или уберите release_id");
                if (body.isEmpty()) body = str(rel.get(0).get("description_md"));
                if (title.isEmpty()) title = "release " + req.release_id();
            }
            if (title.isEmpty()) title = req.head();
            HttpResponse<String> r = bridge.api(repo.get(), "POST",
                "/repos/" + repo.get().path() + "/pulls",
                JsonObject.of("title", title, "body", body, "head", req.head(), "base", base).encode());
            if (r.statusCode() >= 300)
                return noStore(Response.status(r.statusCode())
                    .entity(new LoreError("FORGEJO_UPSTREAM", r.body())));
            JsonObject pr = new JsonObject(r.body());
            return noStore(Response.ok(Map.of("ok", true,
                "number", pr.getLong("number"),
                "url", str(pr.getString("html_url")),
                "head", req.head(), "base", base, "title", title)));
        } catch (Exception e) { return upstream(e); }
    }

    // ── PR: статус для merge-решения (§10) ──────────────────────────────────

    @GET
    @Path("pr/{n}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response prStatus(@PathParam("n") long number, @QueryParam("git_project") String gitProject,
                             @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!bridge.configured()) return notConfigured();
        if (str(gitProject).isEmpty()) return badParams("git_project required");
        Optional<ForgejoBridge.Repo> repo = bridge.resolve(gitProject);
        if (repo.isEmpty()) return projectNotResolvable(gitProject);
        try {
            PrGate gate = evaluate(repo.get(), gitProject, number);
            if (gate.error() != null)
                return noStore(Response.status(gate.httpStatus())
                    .entity(new LoreError("FORGEJO_UPSTREAM", gate.error())));
            return noStore(Response.ok(gate.toJson()));
        } catch (Exception e) { return upstream(e); }
    }

    // ── PR: merge строго по гейту (409 из любого не-GREEN) ─────────────────

    public record MergeRequest(String git_project, String release_id, String sprint_id) {}

    @POST
    @Path("pr/{n}/merge")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response merge(@PathParam("n") long number, MergeRequest req,
                          @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!bridge.configured()) return notConfigured();
        if (req == null || str(req.git_project()).isEmpty()) return badParams("git_project required");
        Optional<ForgejoBridge.Repo> repo = bridge.resolve(req.git_project());
        if (repo.isEmpty()) return projectNotResolvable(req.git_project());
        try {
            PrGate gate = evaluate(repo.get(), req.git_project(), number);
            if (gate.error() != null)
                return noStore(Response.status(gate.httpStatus())
                    .entity(new LoreError("FORGEJO_UPSTREAM", gate.error())));
            // §10 (б): merge разрешён ТОЛЬКО из GREEN. Всё остальное — 409 с фактическим
            // статусом; UNKNOWN/STALLED — повод для forgejo-mcp диагностики, не ретраев.
            if (!ForgejoBridge.mergeAllowed(gate.status())) {
                Map<String, Object> body = gate.toJson();
                body.put("error", "MERGE_GATE");
                body.put("detail", "merge разрешён только из GREEN; сейчас " + gate.status()
                    + (ForgejoBridge.RED.equals(gate.status()) ? " — чините CI и повторяйте"
                       : " — диагностика через forgejo-mcp (§9), не повторные merge"));
                return noStore(Response.status(Response.Status.CONFLICT).entity(body));
            }
            HttpResponse<String> m = bridge.api(repo.get(), "POST",
                "/repos/" + repo.get().path() + "/pulls/" + number + "/merge",
                JsonObject.of("Do", "merge").encode());
            if (m.statusCode() >= 300)
                return noStore(Response.status(m.statusCode())
                    .entity(new LoreError("FORGEJO_UPSTREAM", m.body())));

            // FJ-05: замыкание релиз-цикла — авто-линк PR→релиз (SHIPPED_IN) и
            // спринт→релиз (IMPLEMENTED_IN_RELEASE). Валидируем существование целей:
            // тихий no-op здесь уже стоил релизов с prs_linked:0 (ADR-024, контекст).
            Map<String, Object> linked = autoLink(req.git_project(), number, req.release_id(), req.sprint_id());

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("merged", true);
            out.put("number", number);
            out.put("gate", gate.status());
            out.putAll(linked);
            return noStore(Response.ok(out));
        } catch (Exception e) { return upstream(e); }
    }

    // ── CI-статус произвольного ref (ветки) — §10 ───────────────────────────

    @GET
    @Path("ci")
    @Produces(MediaType.APPLICATION_JSON)
    public Response ciStatus(@QueryParam("git_project") String gitProject, @QueryParam("ref") String ref,
                             @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!bridge.configured()) return notConfigured();
        if (str(gitProject).isEmpty() || str(ref).isEmpty()) return badParams("git_project and ref required");
        Optional<ForgejoBridge.Repo> repo = bridge.resolve(gitProject);
        if (repo.isEmpty()) return projectNotResolvable(gitProject);
        try {
            CiProbe probe = ciProbe(repo.get(), ref, 0);
            String status = ForgejoBridge.gateStatus(probe.byContext(), bridge.requiredChecks(gitProject),
                probe.ageSeconds(), bridge.graceSeconds, probe.failed());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ref", ref);
            out.put("status", status);
            out.put("checks", probe.byContext());
            return noStore(Response.ok(out));
        } catch (Exception e) { return upstream(e); }
    }

    // ── Branch protection: ТОЛЬКО чтение (решение 136) ──────────────────────

    @GET
    @Path("branch-protection")
    @Produces(MediaType.APPLICATION_JSON)
    public Response branchProtection(@QueryParam("git_project") String gitProject,
                                     @QueryParam("branch") String branch,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!bridge.configured()) return notConfigured();
        if (str(gitProject).isEmpty()) return badParams("git_project required");
        Optional<ForgejoBridge.Repo> repo = bridge.resolve(gitProject);
        if (repo.isEmpty()) return projectNotResolvable(gitProject);
        try {
            String path = "/repos/" + repo.get().path() + "/branch_protections"
                + (str(branch).isEmpty() ? "" : "/" + branch);
            HttpResponse<String> r = bridge.api(repo.get(), "GET", path, null);
            if (r.statusCode() >= 300)
                return noStore(Response.status(r.statusCode())
                    .entity(new LoreError("FORGEJO_UPSTREAM", r.body())));
            return noStore(Response.ok(r.body()));
        } catch (Exception e) { return upstream(e); }
    }

    // ── внутренности ─────────────────────────────────────────────────────────

    /** Снимок PR + вычисленный статус §10. error!=null → upstream-ошибка (не UNKNOWN гейта:
     *  ошибка чтения самого PR — это 502/404 вызова, а не CI-статус). */
    record PrGate(long number, String title, String state, boolean mergedAlready, String headSha,
                  String status, Map<String, String> checks, String error, int httpStatus) {
        Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("number", number);
            m.put("title", title);
            m.put("state", state);
            m.put("merged", mergedAlready);
            m.put("head_sha", headSha);
            m.put("status", status);
            m.put("checks", checks);
            m.put("merge_allowed", ForgejoBridge.mergeAllowed(status));
            return m;
        }
    }

    private PrGate evaluate(ForgejoBridge.Repo repo, String gitProject, long number) throws Exception {
        HttpResponse<String> r = bridge.api(repo, "GET", "/repos/" + repo.path() + "/pulls/" + number, null);
        if (r.statusCode() >= 300)
            return new PrGate(number, null, null, false, null, null, Map.of(), r.body(), r.statusCode());
        JsonObject pr = new JsonObject(r.body());
        String headSha = pr.getJsonObject("head", new JsonObject()).getString("sha", "");
        long age = 0;
        String updated = pr.getString("updated_at");
        if (updated != null) {
            try { age = Instant.now().getEpochSecond() - OffsetDateTime.parse(updated).toInstant().getEpochSecond(); }
            catch (Exception ignore) { }
        }
        CiProbe probe = ciProbe(repo, headSha, age);
        String status = ForgejoBridge.gateStatus(probe.byContext(), bridge.requiredChecks(gitProject),
            probe.ageSeconds(), bridge.graceSeconds, probe.failed());
        return new PrGate(number, pr.getString("title"), pr.getString("state"),
            Boolean.TRUE.equals(pr.getBoolean("merged")), headSha, status, probe.byContext(), null, 200);
    }

    /** Комбинированный commit-status Forgejo по ref/sha → контекст→state. failed=true → UNKNOWN. */
    record CiProbe(Map<String, String> byContext, long ageSeconds, boolean failed) {}

    private CiProbe ciProbe(ForgejoBridge.Repo repo, String ref, long ageSeconds) {
        try {
            HttpResponse<String> r = bridge.api(repo, "GET",
                "/repos/" + repo.path() + "/commits/" + ref + "/status", null);
            if (r.statusCode() >= 300) return new CiProbe(Map.of(), ageSeconds, true);
            JsonObject combined = new JsonObject(r.body());
            JsonArray statuses = combined.getJsonArray("statuses", new JsonArray());
            // Forgejo кладёт статусы новее→старше; первый на контекст = актуальный.
            Map<String, String> byCtx = new HashMap<>();
            for (int i = 0; i < statuses.size(); i++) {
                JsonObject s = statuses.getJsonObject(i);
                byCtx.putIfAbsent(str(s.getString("context")), str(s.getString("status")));
            }
            return new CiProbe(byCtx, ageSeconds, false);
        } catch (Exception e) {
            LOG.warnf("[FORGEJO CI] %s@%s: %s", repo.path(), ref, e.getMessage());
            return new CiProbe(Map.of(), ageSeconds, true);
        }
    }

    /**
     * FJ-05: рёбра PR→релиз и спринт→релиз после успешного merge. release_id не
     * передан → берём текущий (is_current) релиз проекта; его нет → linked:false
     * с подсказкой, НЕ молча (урок feedback_release_link_sprint_and_pr).
     */
    private Map<String, Object> autoLink(String gitProject, long prNumber, String releaseId, String sprintId) {
        Map<String, Object> out = new LinkedHashMap<>();
        try {
            String rid = str(releaseId);
            if (rid.isEmpty()) {
                List<Map<String, Object>> cur = ingestService.queryPublic(
                    "SELECT release_id FROM KnowRelease WHERE git_project=:gp AND is_current=true LIMIT 1",
                    Map.of("gp", gitProject));
                if (!cur.isEmpty()) rid = str(cur.get(0).get("release_id"));
            }
            if (rid.isEmpty()) {
                out.put("linked", false);
                out.put("link_hint", "релиз не найден (ни release_id, ни is_current у " + gitProject
                    + ") — создайте KnowRelease и вызовите release_link rel:pr + rel:sprint");
                return out;
            }
            String ruid = gitProject + "#" + rid;
            List<Map<String, Object>> rel = ingestService.queryPublic(
                "SELECT release_uid FROM KnowRelease WHERE release_uid=:ruid", Map.of("ruid", ruid));
            if (rel.isEmpty()) {
                out.put("linked", false);
                out.put("link_hint", "KnowRelease " + ruid + " не существует — release_new до merge");
                return out;
            }
            String prUid = gitProject + "#" + prNumber;
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowPR SET pr_uid=:uid, pr_number=:n, git_project=:gp UPSERT WHERE pr_uid=:uid",
                Map.of("uid", prUid, "n", prNumber, "gp", gitProject))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE SHIPPED_IN FROM (SELECT FROM KnowPR WHERE pr_uid=:uid) " +
                "TO (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                Map.of("uid", prUid, "ruid", ruid))).await().indefinitely();
            out.put("linked", true);
            out.put("release_id", rid);
            if (!str(sprintId).isEmpty()) {
                // Оба ребра — разными вызовами, как учит feedback_release_link_sprint_and_pr.
                List<Map<String, Object>> sp = ingestService.queryPublic(
                    "SELECT sprint_id FROM KnowSprint WHERE sprint_id=:sid", Map.of("sid", sprintId));
                if (sp.isEmpty()) {
                    out.put("sprint_linked", false);
                    out.put("sprint_hint", "KnowSprint " + sprintId + " не найден");
                } else {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE IMPLEMENTED_IN_RELEASE FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO (SELECT FROM KnowRelease WHERE release_uid=:ruid)",
                        Map.of("sid", sprintId, "ruid", ruid))).await().indefinitely();
                    out.put("sprint_linked", true);
                }
            }
        } catch (Exception e) {
            LOG.warnf("[FORGEJO AUTOLINK] PR #%d: %s", prNumber, e.getMessage());
            out.put("linked", false);
            out.put("link_hint", "авто-линк упал (" + e.getMessage() + ") — release_link руками");
        }
        return out;
    }

    private Response upstream(Exception e) {
        LOG.warnf("[FORGEJO] %s", e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("FORGEJO_UPSTREAM", e.getMessage())));
    }
}
