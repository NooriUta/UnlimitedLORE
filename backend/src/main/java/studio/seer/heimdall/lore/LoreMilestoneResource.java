package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * KnowMilestone write endpoints (sprint↔milestone link, upsert), split out of
 * AidaLoreResource (B2). Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreMilestoneResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreMilestoneResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

    // Direct edge so the milestone-management UI can link ANY sprint (not only
    // the 160/186 that have a plan-item bridge). Read paths union both sources.

    public record SprintMilestoneRequest(String sprint_id, String milestone_id, String action) {}

    @POST
    @Path("milestone/sprint")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkSprintMilestone(SprintMilestoneRequest req,
                                        @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.sprint_id() == null || req.milestone_id() == null)
            return badParams("sprint_id and milestone_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            // Проба ДО обеих веток: «связь уже была» и «конца нет» различимы
            // только фактом (ADR-LORE-043).
            boolean had = edgeExists("TARGETS_MILESTONE", "sprint_id", req.sprint_id(),
                "milestone_id", req.milestone_id());
            if (remove) {
                // DELETE EDGE doesn't work in ArcadeDB — SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM TARGETS_MILESTONE WHERE @out.sprint_id=:sid AND @in.milestone_id=:mid",
                    Map.of("sid", req.sprint_id(), "mid", req.milestone_id()));
                for (Map<String, Object> e : edges) {
                    String rid = e.get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM TARGETS_MILESTONE WHERE @rid=" + rid, null)).await().indefinitely();
                }
            } else {
                List<Map<String, Object>> existing = ingestService.queryPublic(
                    "SELECT @rid FROM TARGETS_MILESTONE WHERE @out.sprint_id=:sid AND @in.milestone_id=:mid",
                    Map.of("sid", req.sprint_id(), "mid", req.milestone_id()));
                if (existing.isEmpty()) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TARGETS_MILESTONE " +
                        "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) " +
                        "TO   (SELECT FROM KnowMilestone WHERE milestone_id=:mid)",
                        Map.of("sid", req.sprint_id(), "mid", req.milestone_id()))).await().indefinitely();
                }
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true); out.put("sprint_id", req.sprint_id());
            out.put("milestone_id", req.milestone_id()); out.put("action", remove ? "removed" : "added");
            return remove ? unlinkOutcome(out, had)
                : linkOutcome(had, out, false, "TARGETS_MILESTONE", "sprint_id", req.sprint_id(),
                    "milestone_id", req.milestone_id(), "спринт " + req.sprint_id() + " или веха " + req.milestone_id());
        } catch (Exception e) {
            LOG.warnf("[LORE SPRINT MILESTONE] %s / %s: %s", req.sprint_id(), req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── RM-S1: веха → ПРОДУКТ ────────────────────────────────────────────────

    public record MilestoneProductRequest(String milestone_id, String product_code, String action) {}

    /**
     * RM-S1: дорожная карта принадлежит ПРОДУКТУ.
     *
     * <p>Прежняя редакция задачи вешала веху на git-проект и снята решением
     * {@code D-2026-LORE-PRODUCT-IS-OWN-ENTITY}: проект остаётся границей ПРАВ
     * (аналог тенанта AIDA), а носитель карты — продукт. Слова владелицы: «я
     * хочу создать продукты, и у них будет roadmap, а не проекты — у нас и так
     * меняется дорога».
     *
     * <p><b>Ребро, а не поле.</b> Веха может относиться к нескольким продуктам,
     * и один слаг этого не выразит. Плюс прецедент двойной правды, которым этот
     * корпус болел трижды за месяц: у релиза поле {@code git_project} разошлось
     * с ребром (AL-96), у спеки компонент выражался тремя способами (FIX-9), у
     * компонента {@code parent_id} разошёлся с {@code PARENT_OF} (RM-P10).
     *
     * <p><b>Отдельный тип {@code TARGETS_PRODUCT}, а не общий IN_PRODUCT.</b>
     * Семантика другая — компонент ВХОДИТ в продукт, веха НАЦЕЛЕНА на него, —
     * и это не вкусовщина: слайс {@code products} читает состав как
     * {@code in('IN_PRODUCT').component_id}, и вехи на том же типе приехали бы
     * туда пачкой null'ов. Имя парное к {@code TARGETS_MILESTONE}, так что цепь
     * карты читается подряд: спринт → веха → продукт.
     */
    @POST
    @Path("milestone/product")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkMilestoneProduct(MilestoneProductRequest req,
                                         @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.milestone_id() == null || req.product_code() == null)
            return badParams("milestone_id and product_code required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            // Оба конца проверяются ДО записи. Пустая выборка в
            // «CREATE EDGE … TO (SELECT …)» не падает, а молча не создаёт ребра —
            // записанный класс ошибок (project_new/linked:false, spec_link).
            if (!vertexExists("KnowMilestone", "milestone_id", req.milestone_id()))
                return badParams("milestone not found: " + req.milestone_id());
            if (!productExists(req.product_code()))
                return badParams("product not found: " + req.product_code());

            boolean had = edgeExists("TARGETS_PRODUCT", "milestone_id", req.milestone_id(),
                "code", req.product_code());
            if (remove) {
                // DELETE EDGE в грамматике ArcadeDB нет — SELECT @rid + DELETE FROM
                List<Map<String, Object>> edges = ingestService.queryPublic(
                    "SELECT @rid FROM TARGETS_PRODUCT WHERE @out.milestone_id=:mid AND @in.code=:c",
                    Map.of("mid", req.milestone_id(), "c", req.product_code()));
                for (Map<String, Object> e : edges) {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "DELETE FROM TARGETS_PRODUCT WHERE @rid=" + e.get("@rid"), null))
                        .await().indefinitely();
                }
            } else if (!had) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TARGETS_PRODUCT " +
                    "FROM (SELECT FROM KnowMilestone WHERE milestone_id=:mid) " +
                    "TO   (SELECT FROM KnowDictEntry WHERE dict_type='product' AND code=:c)",
                    Map.of("mid", req.milestone_id(), "c", req.product_code()))).await().indefinitely();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("milestone_id", req.milestone_id());
            out.put("product_code", req.product_code());
            out.put("action", remove ? "removed" : "added");
            return remove ? unlinkOutcome(out, had)
                : linkOutcome(had, out, false, "TARGETS_PRODUCT",
                    "milestone_id", req.milestone_id(), "code", req.product_code(),
                    "веха " + req.milestone_id() + " или продукт " + req.product_code());
        } catch (Exception e) {
            LOG.warnf("[LORE MILESTONE PRODUCT] %s / %s: %s",
                req.milestone_id(), req.product_code(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── RM-M1: массовая привязка спринтов к вехе ─────────────────────────────

    public record MilestoneSprintsRequest(String milestone_id, List<String> sprint_ids, String action) {}

    /**
     * RM-M1: список спринтов за один вызов.
     *
     * <p>Поштучный {@code milestone/sprint} остаётся и не трогается — но карта
     * из двадцати спринтов строится двадцатью вызовами и потому не строится.
     * Инструмент, которого нет, — это работа, которая не будет записана.
     *
     * <p>Исход отдаётся ПО КАЖДОМУ спринту, а не одним «ok». Сводный ответ на
     * пакет — это ровно та форма, в которой «двух спринтов не существует»
     * выглядит как успех; отдельные исходы делают потерю видимой. Один
     * непрошедший спринт не отменяет остальные: пакет не транзакция, и
     * притворяться ею, откатывая уже записанное, было бы хуже.
     */
    @POST
    @Path("milestone/sprints")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkMilestoneSprints(MilestoneSprintsRequest req,
                                         @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.milestone_id() == null || req.sprint_ids() == null || req.sprint_ids().isEmpty())
            return badParams("milestone_id and non-empty sprint_ids required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (!vertexExists("KnowMilestone", "milestone_id", req.milestone_id()))
                return badParams("milestone not found: " + req.milestone_id());

            List<Map<String, Object>> results = new java.util.ArrayList<>();
            int linked = 0, already = 0, missing = 0, removed = 0;
            for (String sid : req.sprint_ids()) {
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("sprint_id", sid);
                boolean had = edgeExists("TARGETS_MILESTONE", "sprint_id", sid,
                    "milestone_id", req.milestone_id());
                if (remove) {
                    if (had) {
                        List<Map<String, Object>> edges = ingestService.queryPublic(
                            "SELECT @rid FROM TARGETS_MILESTONE "
                            + "WHERE @out.sprint_id=:sid AND @in.milestone_id=:mid",
                            Map.of("sid", sid, "mid", req.milestone_id()));
                        for (Map<String, Object> e : edges) {
                            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                                "DELETE FROM TARGETS_MILESTONE WHERE @rid=" + e.get("@rid"), null))
                                .await().indefinitely();
                        }
                        removed++;
                        one.put("outcome", "removed");
                    } else {
                        one.put("outcome", "was_not_linked");
                    }
                } else if (had) {
                    already++;
                    one.put("outcome", "already_linked");
                } else if (!vertexExists("KnowSprint", "sprint_id", sid)) {
                    missing++;
                    one.put("outcome", "sprint_not_found");
                } else {
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE TARGETS_MILESTONE "
                        + "FROM (SELECT FROM KnowSprint WHERE sprint_id=:sid) "
                        + "TO   (SELECT FROM KnowMilestone WHERE milestone_id=:mid)",
                        Map.of("sid", sid, "mid", req.milestone_id()))).await().indefinitely();
                    // Признак записи — ФАКТ, а не отсутствие ошибки: CREATE EDGE
                    // возвращает пустоту и когда конца нет (ADR-LORE-043).
                    if (edgeExists("TARGETS_MILESTONE", "sprint_id", sid,
                                   "milestone_id", req.milestone_id())) {
                        linked++;
                        one.put("outcome", "linked");
                    } else {
                        missing++;
                        one.put("outcome", "not_linked");
                    }
                }
                results.add(one);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("milestone_id", req.milestone_id());
            out.put("action", remove ? "remove" : "add");
            out.put("requested", req.sprint_ids().size());
            if (remove) out.put("removed", removed);
            else { out.put("linked", linked); out.put("already_linked", already); }
            out.put("not_linked", missing);
            out.put("results", results);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE MILESTONE SPRINTS] %s: %s", req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /** Есть ли вершина с таким id. Сверка не удалась — отвечаем «нет» (не врём в сторону «есть»). */
    private boolean vertexExists(String type, String idField, String id) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT count(*) AS n FROM " + type + " WHERE " + idField + " = :id", Map.of("id", id));
            return !rows.isEmpty() && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Продукт — запись справочника; ключ составной, поэтому одного code мало. */
    private boolean productExists(String code) {
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type='product' AND code = :c",
                Map.of("c", code));
            return !rows.isEmpty() && ((Number) rows.get(0).getOrDefault("n", 0)).longValue() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    // ── Write-path: upsert milestone (create / edit label, week, date, goal) ──

    public record MilestoneRequest(String milestone_id, String label, Integer week,
                                   String date_display, String goal_md, String priority) {}

    @POST
    @Path("milestone")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertMilestone(MilestoneRequest req,
                                    @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.milestone_id() == null || req.milestone_id().isBlank())
            return badParams("milestone_id required");
        try {
            // Upsert the milestone vertex — LH-44: only SET fields actually provided,
            // a partial call (e.g. priority-only) must not wipe label/week/date_display.
            StringBuilder msql = new StringBuilder("UPDATE KnowMilestone SET milestone_id=:mid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("mid", req.milestone_id());
            if (req.label() != null)        { msql.append(", label=:lbl");       p.put("lbl",  req.label()); }
            if (req.week() != null)         { msql.append(", week=:wk");         p.put("wk",   req.week()); }
            if (req.date_display() != null) { msql.append(", date_display=:dd"); p.put("dd",   req.date_display()); }
            if (req.priority() != null)     { msql.append(", priority=:prio");   p.put("prio", req.priority()); }
            msql.append(" UPSERT WHERE milestone_id=:mid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                msql.toString(), p)).await().indefinitely();
            // Goal text lives in the current HAS_STATE hist row — update it if provided.
            if (req.goal_md() != null) {
                List<Map<String, Object>> hist = ingestService.queryPublic(
                    "SELECT @rid FROM (SELECT expand(out('HAS_STATE')) FROM KnowMilestone " +
                    "WHERE milestone_id=:mid) WHERE valid_to IS NULL", Map.of("mid", req.milestone_id()));
                if (!hist.isEmpty()) {
                    String rid = hist.get(0).get("@rid").toString();
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "UPDATE " + rid + " SET goal_md=:g", Map.of("g", req.goal_md()))).await().indefinitely();
                }
            }
            if (req.goal_md() != null)
                hashStamper.stampOpenHist("KnowMilestoneHist", "KnowMilestone", "milestone_id", req.milestone_id());
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("milestone_id", req.milestone_id());
            // Вердикт полноты (ADR-LORE-039): веха без даты не ложится на план.
            WorkQuality.Result quality = milestoneQuality(req.milestone_id());
            if (quality != null) out.put("quality", WorkQuality.compact(quality));
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE MILESTONE] %s: %s", req.milestone_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    /**
     * Вердикт полноты вехи (ADR-LORE-039). Поля читаются под их РЕАЛЬНЫМИ
     * именами в модели — {@code label} и {@code date_display}; спринты берутся
     * обратным обходом TARGETS_MILESTONE. Сбой вердикта не роняет ответ: запись
     * уже состоялась и была тем, что просил вызывающий.
     */
    // Факты собирает LoreQualityFacts — один источник на путь записи и
    // батч-API. Своя копия проекции здесь была причиной трёх разошедшихся
    // прочтений за один день (status vs status_raw, поле не из модели,
    // release_id вместо release_uid).
    @jakarta.inject.Inject
    LoreQualityFacts qualityFacts;

    private WorkQuality.Result milestoneQuality(String milestoneId) {
        return qualityFacts.forOne(LoreQualityFacts.Kind.MILESTONE, milestoneId);
    }
}
