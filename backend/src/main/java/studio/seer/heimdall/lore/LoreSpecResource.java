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
        Boolean checkpoint,
        // DS-4: статус спеки — код словаря spec_status (V50), на открытой ревизии.
        String status) {}

    /** DS-4: страховка на пустой словарь — канон в spec_status (V50). */
    static final List<String> SPEC_STATUSES_FALLBACK =
        List.of("proposed", "accepted", "deprecated", "superseded");
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
        // DS-4: только значение словаря — свободный текст снова растащил бы статус
        // по написаниям («Предложение», «proposal», «draft»), как было у решений.
        if (req.status() != null && !req.status().isBlank()) {
            List<String> allowed = activeDictCodes("spec_status", SPEC_STATUSES_FALLBACK);
            if (!allowed.contains(req.status()))
                return badParams("status must be one of: " + allowed
                    + " (словарь spec_status, правится в админке)");
        }
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

            boolean bodyProvided = req.content_md() != null || req.version() != null
                || req.summary() != null || req.status() != null;
            boolean histWritten = false;
            if (bodyProvided) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> histRows = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "SELECT @rid as rid, content_md, version, summary, status FROM KnowSpecHist " +
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
                    hp.put("status",  req.status()     != null ? req.status()     : histRows.get(0).get("status"));
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                        "UPDATE KnowSpecHist SET valid_to=:now WHERE @rid=:rid;" +
                        "INSERT INTO KnowSpecHist SET spec_id=:id, state_uid=:nsid, valid_from=:now, " +
                        "content_md=:content, version=:version, summary=:summary, status=:status;" +
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
                    if (req.status() != null)     { hsql.append(", status=:status");      hp.put("status",  req.status()); }
                    hsql.append(" WHERE @rid=:rid");
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        hsql.toString(), hp)).await().indefinitely();
                } else {
                    String nsid = UUID.randomUUID().toString();
                    Map<String, Object> hp = mapOfNullable(
                        "content", req.content_md(), "version", req.version(), "summary", req.summary(),
                        "status", req.status());
                    hp.put("id", req.spec_id());
                    hp.put("nsid", nsid);
                    hp.put("now", Instant.now().toString());
                    // A1: hist INSERT + HAS_STATE edge as one atomic sqlscript.
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sqlscript",
                        "INSERT INTO KnowSpecHist SET spec_id=:id, state_uid=:nsid, valid_from=:now, " +
                        "content_md=:content, version=:version, summary=:summary, status=:status;" +
                        "CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSpec WHERE spec_id=:id) " +
                        "TO (SELECT FROM KnowSpecHist WHERE state_uid=:nsid);", hp)).await().indefinitely();
                }
                histWritten = true;
            }
            // Поле component_id само по себе невидимо: паспорт компонента читает
            // ребро out('DOCUMENTED_IN'). Раньше писалось только поле — спека не
            // появлялась на своём компоненте (107 таких вершин). Держим ребро в
            // синхроне, как T01 сделал для PARENT_OF.
            if (req.component_id() != null) syncSpecComponent(req.spec_id(), req.component_id());
            hashStamper.stampOpenHist("KnowSpecHist", "KnowSpec", "spec_id", req.spec_id());
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("spec_id", req.spec_id());
            out.put("body_written", histWritten);
            // Вердикт полноты (ADR-LORE-039): спека без содержания — заглушка,
            // она занимает место в реестре знаний и создаёт впечатление, что
            // тема покрыта. Advisory, на запись не влияет.
            WorkQuality.Result quality = specQuality(req.spec_id());
            if (quality != null) out.put("quality", WorkQuality.compact(quality));
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC UPSERT] %s: %s", req.spec_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /**
     * Вердикт полноты спеки (ADR-LORE-039). Факты — из графа ПОСЛЕ записи рёбер:
     * судится сохранённое состояние, а не присланный запрос. Тело и версия живут
     * на ОТКРЫТОЙ Hist-строке, компонент — на ребре DOCUMENTED_IN (поле
     * component_id само по себе невидимо, см. комментарий на записи выше).
     */
    // Факты собирает LoreQualityFacts — один источник на путь записи и
    // батч-API. Своя копия проекции здесь была причиной трёх разошедшихся
    // прочтений за один день (status vs status_raw, поле не из модели,
    // release_id вместо release_uid).
    @jakarta.inject.Inject
    LoreQualityFacts qualityFacts;

    private WorkQuality.Result specQuality(String specId) {
        return qualityFacts.forOne(LoreQualityFacts.Kind.SPEC, specId);
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

        final String edge, targetType, targetField;
        switch (rel) {
            case "component" -> {
                edge = "BELONGS_TO";
                targetType = "LoreComponent";
                targetField = "component_id";
            }
            case "project" -> {
                edge = "BELONGS_TO_PROJECT";
                targetType = "KnowGitProject";
                targetField = "slug";
            }
            default -> { return badParams("rel must be component|project"); }
        }
        final String toSql = "(SELECT FROM " + targetType + " WHERE " + targetField + "=:tid)";
        boolean remove = "remove".equals(mode);
        // Компонент у спеки один (syncSpecComponent снимает остальные), поэтому
        // для него и add, и replace вытесняют прежнюю привязку.
        boolean displacesOthers = "replace".equals(mode) || "component".equals(rel);

        Map<String, Object> p = new java.util.HashMap<>();
        p.put("sid", req.spec_id());
        p.put("tid", req.target_id());

        try {
            // DBR-17 (ADR-LORE-043): пробы ДО записи — исход выводится из факта.
            boolean had = edgeExists(edge, "spec_id", req.spec_id(), targetField, req.target_id());
            long others = countLong(ingestService.queryPublic(
                "SELECT count(*) AS n FROM " + edge + " WHERE @out.spec_id=:sid AND @in." + targetField + "<>:tid", p));

            // Цель проверяется ДО сноса. Раньше replace сначала снимал текущие
            // рёбра и лишь потом замечал, что цели нет: запрос отклонён 404, а
            // спека уже без компонента — отказ, изменивший состояние.
            if (!remove && !had && countLong(ingestService.queryPublic(
                    "SELECT count(*) AS n FROM " + targetType + " WHERE " + targetField + "=:tid", p)) == 0)
                return noStore(Response.status(Response.Status.NOT_FOUND).entity(new LoreError(
                    "TARGET_NOT_FOUND",
                    rel + " '" + req.target_id() + "' не существует — ребро не создано. "
                    + "Заведите его сначала (component_new / project_new).")));

            // replace снимает рёбра этого типа КРОМЕ целевого, remove — только
            // целевое. Удаление — через DELETE FROM по выбранным рёбрам: DELETE
            // EDGE в грамматике ArcadeDB 26.7.2 отсутствует (AKI, проверено).
            if ("replace".equals(mode) || remove) {
                String where = remove ? " WHERE @in." + targetField + "=:tid" : " WHERE @in." + targetField + "<>:tid";
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowSpec WHERE spec_id=:sid)" + where,
                    p)).await().indefinitely();
            }

            // IF NOT EXISTS: без него повтор add создавал второе такое же ребро.
            if (!remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM (SELECT FROM KnowSpec WHERE spec_id=:sid) TO " + toSql
                        + " IF NOT EXISTS",
                    p)).await().indefinitely();
            }

            // FIX-9: компонент выражен тремя способами, и раньше этот путь писал
            // ДРУГОЕ ребро, чем upsert спеки. Перенос отвечал успехом и не был
            // виден в чтении: старое ребро другого типа выигрывало в COALESCE.
            // Теперь оба пути зовут одну точку, которая приводит к одному
            // значению все три представления.
            //
            // remove синхронизирует ТОЛЬКО когда снятая привязка была: пустой
            // компонент в sync снимает все рёбра, и remove непривязанного
            // компонента отвязывал настоящий.
            if ("component".equals(rel) && (!remove || had)) {
                syncSpecComponent(req.spec_id(), remove ? null : req.target_id());
            }

            Map<String, Object> base = new java.util.LinkedHashMap<>();
            base.put("ok", true);
            base.put("spec_id", req.spec_id());
            base.put("rel", rel);
            base.put("target_id", req.target_id());
            base.put("mode", mode);
            if (remove) return unlinkOutcome(base, had);
            String outcome;
            if (had && (!displacesOthers || others == 0)) outcome = LoreOutcome.UNCHANGED;
            else if (displacesOthers && others > 0)      outcome = LoreOutcome.UPDATED;
            else                                         outcome = LoreOutcome.CREATED;
            // Факт, а не признак: после записи ребро обязано быть.
            if (!edgeExists(edge, "spec_id", req.spec_id(), targetField, req.target_id()))
                return noStore(Response.ok(LoreOutcome.link(base, false, false, rel + " " + req.target_id())));
            base.put("outcome", outcome);
            if (LoreOutcome.UNCHANGED.equals(outcome)) base.put("hint", "связь уже была — повторять вызов не нужно");
            if (LoreOutcome.UPDATED.equals(outcome))   base.put("replaced", others);
            return noStore(Response.ok(base));
        } catch (Exception e) {
            LOG.warnf("[LORE SPEC LINK] %s %s %s: %s", req.spec_id(), rel, req.target_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /** {@code SELECT count(*) AS n} → число; пустой ответ — ноль. */
    private static long countLong(List<Map<String, Object>> rows) {
        return rows == null || rows.isEmpty() ? 0
            : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
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
