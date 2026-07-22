package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * KnowSpec write endpoints (upsert, delete), split out of AidaLoreResource
 * (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreSpecResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreSpecResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

    public record SpecUpsertRequest(String spec_id, String title, String version,
        String component_id, String content_md, String file_path, String summary,
        // LH-02: true = a body edit opens a new hist version (SCD2 close-open) instead
        // of amending the open row in place, preserving the previous edition.
        Boolean checkpoint) {}
    public record SpecDeleteRequest(String spec_id) {}

    /**
     * PL-34: привязка спеки к компоненту/проекту РЕБРОМ.
     *
     * `mode`: add | remove | replace. По умолчанию — replace, потому что
     * запрос «перепривязать» звучит именно так; add копил бы вторую привязку
     * молча, и спека числилась бы сразу у двух компонентов.
     */
    public record SpecLinkRequest(String spec_id, String rel, String target_id, String mode) {}

    @POST
    @Path("spec")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertSpec(SpecUpsertRequest req,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.spec_id() == null || req.spec_id().isBlank())
            return badParams("spec_id required");
        if (!SAFE_ID.matcher(req.spec_id()).matches())
            return badParams("spec_id contains illegal characters");
        try {
            // LH-44: only SET fields actually provided — a partial amend call (e.g. only
            // content_md to bump a spec's body) must not wipe version/component_id/file_path
            // to null. Same class of bug found and fixed on /lore/adr, 2026-07-02.
            //
            // SCD2 write contract: spec_by_id reads content_md/version/summary through
            // COALESCE(out('HAS_STATE')...[0], <vertex>) — the hist row WINS whenever one
            // exists (164 KnowSpecHist rows do). A vertex-only write is therefore invisible
            // for every ingested spec. Body fields go to the open hist row (created here
            // when missing); the vertex keeps title/file_path/component_id + a fallback copy.
            StringBuilder sql = new StringBuilder("UPDATE KnowSpec SET spec_id=:id");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("id", req.spec_id());
            if (req.title() != null)        { sql.append(", title=:title");             p.put("title", req.title()); }
            if (req.version() != null)      { sql.append(", version=:version");         p.put("version", req.version()); }
            if (req.component_id() != null) { sql.append(", component_id=:cid");        p.put("cid", req.component_id()); }
            if (req.content_md() != null)   { sql.append(", content_md=:content");      p.put("content", req.content_md()); }
            if (req.file_path() != null)    { sql.append(", file_path=:fp");            p.put("fp", req.file_path()); }
            sql.append(" UPSERT WHERE spec_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();

            boolean bodyProvided = req.content_md() != null || req.version() != null || req.summary() != null;
            boolean histWritten = false;
            if (bodyProvided) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT @rid as rid, content_md, version, summary FROM KnowSpecHist " +
                        "WHERE in('HAS_STATE').spec_id[0] = :id AND valid_to IS NULL LIMIT 1",
                        Map.of("id", req.spec_id())))
                    .await().indefinitely().result();
                if (histRows != null && !histRows.isEmpty() && Boolean.TRUE.equals(req.checkpoint())) {
                    // LH-02: close the open row + open a fresh one, carrying forward fields
                    // not being changed — the previous edition survives as a closed row.
                    String nsid = UUID.randomUUID().toString();
                    Map<String, Object> hp = new java.util.HashMap<>();
                    hp.put("id", req.spec_id()); hp.put("nsid", nsid); hp.put("now", Instant.now().toString());
                    hp.put("rid", histRows.get(0).get("rid"));
                    hp.put("content", req.content_md() != null ? req.content_md() : histRows.get(0).get("content_md"));
                    hp.put("version", req.version()    != null ? req.version()    : histRows.get(0).get("version"));
                    hp.put("summary", req.summary()    != null ? req.summary()    : histRows.get(0).get("summary"));
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                        "UPDATE KnowSpecHist SET valid_to=:now WHERE @rid=:rid;" +
                        "INSERT INTO KnowSpecHist SET spec_id=:id, state_uid=:nsid, valid_from=:now, " +
                        "content_md=:content, version=:version, summary=:summary;" +
                        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSpec WHERE spec_id=:id) " +
                        "TO (SELECT FROM KnowSpecHist WHERE state_uid=:nsid);", hp)).await().indefinitely();
                } else if (histRows != null && !histRows.isEmpty()) {
                    // Match by @rid — state_uid can be null on legacy rows (same silent
                    // no-op class as the ADR fix, 162cc18).
                    StringBuilder hsql = new StringBuilder("UPDATE KnowSpecHist SET spec_id=:id");
                    Map<String, Object> hp = new java.util.HashMap<>();
                    hp.put("id", req.spec_id());
                    hp.put("rid", histRows.get(0).get("rid"));
                    if (req.content_md() != null) { hsql.append(", content_md=:content"); hp.put("content", req.content_md()); }
                    if (req.version() != null)    { hsql.append(", version=:version");    hp.put("version", req.version()); }
                    if (req.summary() != null)    { hsql.append(", summary=:summary");    hp.put("summary", req.summary()); }
                    hsql.append(" WHERE @rid=:rid");
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        hsql.toString(), hp)).await().indefinitely();
                } else {
                    String nsid = UUID.randomUUID().toString();
                    Map<String, Object> hp = mapOfNullable(
                        "content", req.content_md(), "version", req.version(), "summary", req.summary());
                    hp.put("id", req.spec_id());
                    hp.put("nsid", nsid);
                    hp.put("now", Instant.now().toString());
                    // A1: hist INSERT + HAS_STATE edge as one atomic sqlscript.
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                        "INSERT INTO KnowSpecHist SET spec_id=:id, state_uid=:nsid, valid_from=:now, " +
                        "content_md=:content, version=:version, summary=:summary;" +
                        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSpec WHERE spec_id=:id) " +
                        "TO (SELECT FROM KnowSpecHist WHERE state_uid=:nsid);", hp)).await().indefinitely();
                }
                histWritten = true;
            }
            // Поле component_id само по себе невидимо: паспорт компонента читает
            // ребро out('DOCUMENTED_IN'). Раньше писалось только поле — спека не
            // появлялась на своём компоненте (107 таких вершин). Держим ребро в
            // синхроне, как T01 сделал для PARENT_OF.
            if (req.component_id() != null) relinkSpecComponentEdge(req.spec_id(), req.component_id());
            hashStamper.stampOpenHist("KnowSpecHist", "KnowSpec", "spec_id", req.spec_id());
            return noStore(Response.ok(Map.of("ok", true, "spec_id", req.spec_id(),
                "body_written", histWritten)));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC UPSERT] %s: %s", req.spec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /**
     * PL-34 — {@code POST /lore/spec/link}: сменить компонент или проект у спеки.
     *
     * <p><b>Зачем понадобилось.</b> {@code /lore/spec} пишет {@code component_id}
     * ПОЛЕМ ВЕРШИНЫ, а слайс {@code specs} читает привязку через ребро
     * {@code BELONGS_TO}. Поэтому «смена компонента» через upsert возвращала
     * {@code ok: true} и не меняла ничего видимого: поле новое, ребро старое,
     * спека в прежнем списке. Инструмента для ребра не было вовсе.
     *
     * <p><b>Проверяем ФАКТ, а не код возврата.</b> {@code CREATE EDGE … TO
     * (SELECT …)} с пустой выборкой создаёт ноль рёбер и НЕ падает — ровно так
     * молча промахивались {@code project_new} и {@code decision_new}. Поэтому
     * после записи считаем рёбра и при нуле отвечаем ошибкой: несуществующий
     * компонент обязан выглядеть отказом, а не успехом.
     */
    @POST
    @Path("spec/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSpec(SpecLinkRequest req,
                             @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.spec_id() == null || req.spec_id().isBlank())
            return badParams("spec_id required");
        if (!SAFE_ID.matcher(req.spec_id()).matches())
            return badParams("spec_id contains illegal characters");
        if (req.target_id() == null || req.target_id().isBlank())
            return badParams("target_id required");
        if (!SAFE_ID.matcher(req.target_id()).matches())
            return badParams("target_id contains illegal characters");

        String rel = req.rel() == null ? "component" : req.rel();
        String mode = req.mode() == null ? "replace" : req.mode();
        if (!Set.of("add", "remove", "replace").contains(mode))
            return badParams("mode must be add|remove|replace");

        final String edge, toSql, targetField;
        switch (rel) {
            case "component" -> {
                edge = "BELONGS_TO";
                toSql = "(SELECT FROM LoreComponent WHERE component_id=:tid)";
                targetField = "component_id";
            }
            case "project" -> {
                edge = "BELONGS_TO_PROJECT";
                toSql = "(SELECT FROM KnowGitProject WHERE slug=:tid)";
                targetField = "slug";
            }
            default -> { return badParams("rel must be component|project"); }
        }

        Map<String, Object> p = new java.util.HashMap<>();
        p.put("sid", req.spec_id());
        p.put("tid", req.target_id());

        try {
            // replace и remove снимают существующие рёбра этого типа. Удаление —
            // через DELETE FROM по выбранным рёбрам: DELETE EDGE в грамматике
            // ArcadeDB 26.7.2 отсутствует (AKI, проверено).
            if ("replace".equals(mode) || "remove".equals(mode)) {
                String where = "remove".equals(mode) ? " WHERE @in." + targetField + "=:tid" : "";
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowSpec WHERE spec_id=:sid)" + where,
                    p)).await().indefinitely();
            }

            if (!"remove".equals(mode)) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM (SELECT FROM KnowSpec WHERE spec_id=:sid) TO " + toSql,
                    p)).await().indefinitely();

                @SuppressWarnings("unchecked")
                List<Map<String, Object>> check = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT count(*) AS n FROM (SELECT expand(outE('" + edge + "')) FROM KnowSpec "
                        + "WHERE spec_id=:sid) WHERE @in." + targetField + "=:tid", p))
                    .await().indefinitely().result();
                long n = check == null || check.isEmpty() ? 0
                    : ((Number) check.get(0).getOrDefault("n", 0)).longValue();
                if (n == 0)
                    return noStore(Response.status(Response.Status.NOT_FOUND).entity(new LoreError(
                        "TARGET_NOT_FOUND",
                        rel + " '" + req.target_id() + "' не существует — ребро не создано. "
                        + "Заведите его сначала (component_new / project_new).")));
            }

            // Поле вершины держим в согласии с ребром: слайсы читают ребро, но
            // component_id на вершине остаётся запасным путём и был бы стухшим.
            if ("component".equals(rel) && !"remove".equals(mode)) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowSpec SET component_id=:tid WHERE spec_id=:sid", p))
                    .await().indefinitely();
            }

            return noStore(Response.ok(Map.of("ok", true, "spec_id", req.spec_id(),
                "rel", rel, "target_id", req.target_id(), "mode", mode)));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC LINK] %s %s %s: %s", req.spec_id(), rel, req.target_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    @POST
    @Path("spec/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteSpec(SpecDeleteRequest req,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.spec_id() == null || req.spec_id().isBlank())
            return badParams("spec_id required");
        if (!SAFE_ID.matcher(req.spec_id()).matches())
            return badParams("spec_id contains illegal characters");
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowSpec WHERE spec_id=:id",
                Map.of("id", req.spec_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "spec_id", req.spec_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC DELETE] %s: %s", req.spec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
