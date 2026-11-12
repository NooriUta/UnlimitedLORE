package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-06 · decision:D-2026-UXR-LINK-MENTION-EDGE —
 * «Связать» из панели «упоминания без связи».
 *
 * <ul>
 *   <li>{@code GET /lore/link/types?from_type&to_type} — варианты для пары:
 *       типизированные рёбра из {@link LoreLinkTypes} (с явными концами,
 *       включая развёрнутые), последним — запасной {@code REFERENCES}. Без
 *       параметров — весь каталог (типы и таблица пар) для UI.</li>
 *   <li>{@code POST /lore/link/mention} — поставить выбранное ребро. Все отказы
 *       ДО записи: неизвестный тип, петля, недопустимая пара/направление,
 *       отсутствующий или неоднозначный конец, права агента по семейству
 *       исходной записи. Повтор — {@code outcome:"unchanged"}, а не второе ребро.</li>
 * </ul>
 *
 * <p><b>Аудит.</b> Две оси, обе без новых типов вершин: (1) строка
 * {@code lore.audit} — её пишет {@link LoreAuditLogFilter} на каждую запись
 * под /lore, (2) провенанс на самом ребре — {@code origin='mention'},
 * {@code created_at}, {@code created_by} (ось и идентичность вызывающего из
 * токена, не из тела запроса). Типизированное ребро несёт те же поля: так
 * отличимо, что связь поставлена из упоминания, а не основным путём записи.
 */
@Path("/lore/link")
public class LoreLinkResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreLinkResource.class);

    static final String ORIGIN_MENTION = "mention";

    private static final Pattern EDGE_NAME = Pattern.compile("[A-Z_]{2,40}");

    @GET
    @Path("types")
    @Produces(MediaType.APPLICATION_JSON)
    public Response types(@QueryParam("from_type") String fromType,
                          @QueryParam("to_type") String toType) {
        if (!enabled) return disabled();
        boolean hasFrom = fromType != null && !fromType.isBlank();
        boolean hasTo = toType != null && !toType.isBlank();
        Map<String, Object> out = new LinkedHashMap<>();
        if (!hasFrom && !hasTo) {
            List<Map<String, Object>> types = new ArrayList<>();
            LoreLinkTypes.ENTITIES.values().forEach(e -> {
                Map<String, Object> t = new LinkedHashMap<>();
                t.put("type", e.type());
                t.put("vertex_class", e.vertexClass());
                t.put("id_field", e.idField());
                types.add(t);
            });
            List<Map<String, Object>> pairs = new ArrayList<>();
            LoreLinkTypes.PAIRS.forEach(p -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("from_type", p.fromType());
                m.put("edge_type", p.edgeType());
                m.put("to_type", p.toType());
                pairs.add(m);
            });
            out.put("types", types);
            out.put("pairs", pairs);
            out.put("fallback", Map.of("edge_type", LoreLinkTypes.FALLBACK_EDGE));
            return noStore(Response.ok(out));
        }
        if (!hasFrom || !hasTo) return badParams("from_type и to_type задаются вместе (или оба опускаются — весь каталог)");
        if (LoreLinkTypes.entity(fromType) == null || LoreLinkTypes.entity(toType) == null)
            return badParams("неизвестный тип; допустимы: " + String.join(", ", LoreLinkTypes.ENTITIES.keySet()));

        List<Map<String, Object>> options = new ArrayList<>();
        for (LoreLinkTypes.Option o : LoreLinkTypes.optionsFor(fromType, toType)) options.add(optionJson(o));
        out.put("from_type", fromType);
        out.put("to_type", toType);
        out.put("options", options);
        out.put("fallback", optionJson(options.isEmpty() ? null
            : LoreLinkTypes.optionsFor(fromType, toType).get(options.size() - 1)));
        return noStore(Response.ok(out));
    }

    private static Map<String, Object> optionJson(LoreLinkTypes.Option o) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (o == null) return m;
        m.put("edge_type", o.edgeType());
        m.put("from_type", o.fromType());
        m.put("to_type", o.toType());
        m.put("reversed", o.reversed());
        m.put("fallback", o.fallback());
        return m;
    }

    /**
     * Концы задаются в направлении РЕБРА: {@code from} — откуда оно выходит.
     * Для развёрнутого варианта UI передаёт концы так, как пришли в
     * {@code options[]}. {@code edge_type} не задан — {@code REFERENCES}.
     */
    public record MentionLinkRequest(String from_type, String from_id,
                                     String to_type, String to_id, String edge_type) {}

    @POST
    @Path("mention")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkFromMention(MentionLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null) return badParams("тело запроса обязательно");
        LoreLinkTypes.Entity from = LoreLinkTypes.entity(req.from_type());
        LoreLinkTypes.Entity to = LoreLinkTypes.entity(req.to_type());
        if (from == null || to == null)
            return badParams("from_type/to_type: допустимы " + String.join(", ", LoreLinkTypes.ENTITIES.keySet()));
        if (req.from_id() == null || !SAFE_ID.matcher(req.from_id()).matches())
            return badParams("from_id обязателен и без недопустимых символов");
        if (req.to_id() == null || !SAFE_ID.matcher(req.to_id()).matches())
            return badParams("to_id обязателен и без недопустимых символов");
        if (from.type().equals(to.type()) && req.from_id().equals(req.to_id()))
            return badParams("запись не связывается сама с собой");

        String edge = req.edge_type() == null || req.edge_type().isBlank()
            ? LoreLinkTypes.FALLBACK_EDGE
            : req.edge_type().trim().toUpperCase(Locale.ROOT);
        if (!EDGE_NAME.matcher(edge).matches() || !LoreLinkTypes.isAllowed(from.type(), to.type(), edge)) {
            List<String> allowed = LoreLinkTypes.optionsFor(from.type(), to.type()).stream()
                .filter(o -> !o.reversed()).map(LoreLinkTypes.Option::edgeType).toList();
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("EDGE_NOT_ALLOWED",
                edge + " не ставится " + from.type() + " → " + to.type() + "; допустимо в этом направлении: "
                + String.join(", ", allowed) + " (варианты обоих направлений — GET /lore/link/types)")));
        }

        // Права агента — по семейству ИСХОДНОЙ записи и той же матрицей, что у фильтра.
        String denied = mentionScopeDenied(from);
        if (denied != null) return agentScopeForbidden(denied);

        try {
            String createdAt = Instant.now().toString();
            String createdBy = callerLabel();
            Map<String, Object> audit = new LinkedHashMap<>();
            audit.put("origin", ORIGIN_MENTION);
            audit.put("created_at", createdAt);
            audit.put("created_by", createdBy);

            Map<String, Object> base = new LinkedHashMap<>();
            base.put("ok", true);
            base.put("from_type", from.type());
            base.put("from_id", req.from_id());
            base.put("to_type", to.type());
            base.put("to_id", req.to_id());
            base.put("edge_type", edge);
            base.put("fallback", LoreLinkTypes.FALLBACK_EDGE.equals(edge));
            base.put("audit", audit);

            // Один код с автосвязями по телам (MD-AUTOLINK): проба до записи, запись, проверка факта.
            MentionEdgeOutcome o = placeMentionEdge(from, req.from_id(), to, req.to_id(), edge,
                ORIGIN_MENTION, createdAt, createdBy, false);
            switch (o) {
                case FROM_NOT_FOUND: return targetNotFound(from.type() + " " + req.from_id());
                case TO_NOT_FOUND:   return targetNotFound(to.type() + " " + req.to_id());
                case AMBIGUOUS_FROM:
                case AMBIGUOUS_TO:
                    return noStore(Response.status(Response.Status.CONFLICT).entity(new LoreError("AMBIGUOUS_TARGET",
                        "id " + (o == MentionEdgeOutcome.AMBIGUOUS_FROM ? req.from_id() : req.to_id())
                        + " принадлежит нескольким записям — уточните (например, релиз — в каком проекте)")));
                case UNCHANGED:
                    return noStore(Response.ok(LoreOutcome.link(base, false, true, "")));
                default:
                    boolean exists = o == MentionEdgeOutcome.CREATED;
                    LOG.infof("[LORE LINK] mention %s %s:%s → %s:%s by %s — %s", edge, from.type(), req.from_id(),
                        to.type(), req.to_id(), createdBy, exists ? "created" : "NOT created");
                    return noStore(Response.ok(LoreOutcome.link(base, exists, false,
                        from.type() + " " + req.from_id() + " или " + to.type() + " " + req.to_id())));
            }
        } catch (Exception e) {
            LOG.warnf("[LORE LINK] mention %s %s → %s: %s", edge, req.from_id(), req.to_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    // ── MD-AUTOLINK: бэкфилл по уже записанным телам — только сухой отчёт ────────

    /**
     * Откуда читать MD-тела записи типа: SELECT отдаёт {@code id} и поля тел. Только типы,
     * у которых есть авто-пары ({@link LoreLinkTypes#AUTO_PAIRS}) и чей путь записи
     * подключён к автосвязям — бэкфилл обязан совпадать с тем, что делает запись тела.
     */
    static final Map<String, String> BACKFILL_BODIES = new LinkedHashMap<>();
    static {
        BACKFILL_BODIES.put("adr", "SELECT in('HAS_STATE').adr_id[0] AS id, context_md, decision_md, consequences_md "
            + "FROM KnowADRHist WHERE valid_to IS NULL");
        BACKFILL_BODIES.put("decision", "SELECT decision_id AS id, body_md FROM KnowDecision");
        BACKFILL_BODIES.put("doc", "SELECT doc_id AS id, content_md_ru, content_md_en FROM KnowDoc");
        BACKFILL_BODIES.put("sprint", "SELECT sprint_id AS id, context_md, outcome_md FROM KnowSprint");
        // Заметка задачи — на открытой строке истории (её читают срезы), вершина — зеркало;
        // берутся обе (повтор упоминания схлопывает parse), как читает currentTaskNote.
        BACKFILL_BODIES.put("task", "SELECT task_uid AS id, "
            + "out('HAS_STATE')[valid_to IS NULL].note_md[0] AS note_md, note_md AS note_md_vertex FROM KnowTask");
    }

    private static final int BACKFILL_RECORDS_SHOWN = 200;

    /**
     * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK · spec:SPEC-LORE-MD-INLINE-REF §7 п.6 —
     * сухой прогон бэкфилла: сколько упоминаний в существующих телах, сколько рёбер
     * встало бы, сколько уже есть, сколько пропущено и почему. НИЧЕГО НЕ ПИШЕТ.
     * Запись бэкфилла — отдельный шаг после просмотра отчёта, по решению владелицы;
     * здесь её нет намеренно, {@code dry_run=false} — отказ.
     */
    @GET
    @Path("mentions/backfill")
    @Produces(MediaType.APPLICATION_JSON)
    public Response mentionsBackfill(@QueryParam("dry_run") String dryRun,
                                     @QueryParam("types") String types,
                                     @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (dryRun != null && !"true".equalsIgnoreCase(dryRun.trim()))
            return badParams("бэкфилл — только сухой прогон (dry_run=true); запись — отдельным шагом по решению владелицы");
        List<String> wanted = new ArrayList<>();
        if (types == null || types.isBlank()) wanted.addAll(BACKFILL_BODIES.keySet());
        else for (String t : types.split(",")) {
            String k = t.trim().toLowerCase(Locale.ROOT);
            if (!BACKFILL_BODIES.containsKey(k))
                return badParams("types: допустимы " + String.join(", ", BACKFILL_BODIES.keySet()));
            if (!wanted.contains(k)) wanted.add(k);
        }
        Map<String, Object> totals = new LinkedHashMap<>();
        Map<String, Integer> reasons = new java.util.TreeMap<>();
        Map<String, Object> byType = new LinkedHashMap<>();
        List<Map<String, Object>> records = new ArrayList<>();
        int scanned = 0, withMentions = 0, mentions = 0, wouldAdd = 0, unchanged = 0, skipped = 0;
        try {
            for (String type : wanted) {
                int tScanned = 0, tAdd = 0, tUnch = 0, tSkip = 0;
                for (Map<String, Object> row : ingestService.queryPublic(BACKFILL_BODIES.get(type), Map.of())) {
                    Object idObj = row.get("id");
                    if (idObj == null) continue;
                    String id = String.valueOf(idObj);
                    tScanned++;
                    List<String> bodies = new ArrayList<>();
                    row.forEach((k, v) -> { if (!"id".equals(k) && v != null) bodies.add(String.valueOf(v)); });
                    String[] arr = bodies.toArray(new String[0]);
                    if (LoreMentionAutoLink.parse(arr).isEmpty()) continue;
                    Map<String, Object> m = autoLinkMentions(type, id, true, arr);
                    @SuppressWarnings("unchecked") List<Map<String, Object>> a = (List<Map<String, Object>>) m.get("added");
                    @SuppressWarnings("unchecked") List<Map<String, Object>> u = (List<Map<String, Object>>) m.get("unchanged");
                    @SuppressWarnings("unchecked") List<Map<String, Object>> s = (List<Map<String, Object>>) m.get("skipped");
                    withMentions++;
                    mentions += a.size() + u.size() + s.size();
                    tAdd += a.size(); tUnch += u.size(); tSkip += s.size();
                    for (Map<String, Object> sk : s) reasons.merge(String.valueOf(sk.get("reason")), 1, Integer::sum);
                    if (!a.isEmpty() && records.size() < BACKFILL_RECORDS_SHOWN) {
                        Map<String, Object> r = new LinkedHashMap<>();
                        r.put("type", type);
                        r.put("id", id);
                        r.put("would_add", a);
                        records.add(r);
                    }
                }
                scanned += tScanned; wouldAdd += tAdd; unchanged += tUnch; skipped += tSkip;
                byType.put(type, Map.of("records", tScanned, "would_add", tAdd, "unchanged", tUnch, "skipped", tSkip));
            }
        } catch (Exception e) {
            LOG.warnf("[LORE LINK] mentions backfill dry-run: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        totals.put("records_scanned", scanned);
        totals.put("records_with_mentions", withMentions);
        totals.put("mentions", mentions);
        totals.put("would_add", wouldAdd);
        totals.put("unchanged", unchanged);
        totals.put("skipped", skipped);
        totals.put("skipped_by_reason", reasons);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("dry_run", true);
        out.put("auto_pairs", LoreLinkTypes.AUTO_PAIRS.stream().sorted().toList());
        out.put("totals", totals);
        out.put("by_type", byType);
        out.put("records", records);
        out.put("records_truncated", wouldAdd > 0 && records.size() >= BACKFILL_RECORDS_SHOWN);
        return noStore(Response.ok(out));
    }

    /**
     * Разовая миграция «задача → компонент» ({@link LoreTaskComponentEdgeMigration}):
     * старые BELONGS_TO KnowTask → LoreComponent (промоушен находок QG до PR #1265)
     * переводятся на TAGGED_WITH. Только admin.
     *
     * <ul>
     *   <li>{@code GET …/migrate} — сухой прогон, ничего не пишет: сколько задач,
     *       task_uid, какие рёбра создадутся и удалятся. {@code dry_run=false} на GET — отказ.</li>
     *   <li>{@code POST …/migrate?apply=true} — применение. Без явного {@code apply=true} — отказ:
     *       случайный POST не пишет. Один вызов = одна точка журнала AO-01
     *       ({@link LoreRequestStatsFilter}; object_id — {@code migration_id} из ответа).
     *       План строится заново на момент применения, а не берётся из сухого прогона.
     *       Есть провалы — HTTP 207 и {@code failed > 0}: workflow падает.</li>
     * </ul>
     */
    @GET
    @Path("task-component-edge/migrate")
    @Produces(MediaType.APPLICATION_JSON)
    public Response taskComponentEdgePlan(@QueryParam("dry_run") String dryRun,
                                          @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (dryRun != null && !"true".equalsIgnoreCase(dryRun.trim()))
            return badParams("GET — только сухой прогон; применение — POST …/migrate?apply=true");
        try {
            return noStore(Response.ok(taskComponentEdgeCurrentPlan().toMap()));
        } catch (Exception e) {
            LOG.warnf("[LORE LINK] task-component-edge dry-run: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @POST
    @Path("task-component-edge/migrate")
    @Produces(MediaType.APPLICATION_JSON)
    public Response taskComponentEdgeApply(@QueryParam("apply") String apply,
                                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (apply == null || !"true".equalsIgnoreCase(apply.trim()))
            return badParams("применение — только с явным apply=true; сухой прогон — GET …/migrate");
        LoreTaskComponentEdgeMigration.Plan plan;
        try {
            plan = taskComponentEdgeCurrentPlan();
        } catch (Exception e) {
            LOG.warnf("[LORE LINK] task-component-edge plan: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        LoreTaskComponentEdgeMigration.Result res = LoreTaskComponentEdgeMigration.apply(plan, taskComponentEdgeOps());
        LOG.infof("[LORE LINK] task-component-edge apply: found=%d created=%d deleted=%d unchanged=%d failed=%d",
            res.found(), res.created(), res.deleted(), res.unchanged(), res.failed());
        return noStore(Response.status(res.failed() == 0 ? 200 : 207).entity(res.toMap()));
    }

    private LoreTaskComponentEdgeMigration.Plan taskComponentEdgeCurrentPlan() {
        return LoreTaskComponentEdgeMigration.plan(
            ingestService.queryPublic(LoreTaskComponentEdgeMigration.LEGACY_SQL, Map.of()),
            ingestService.queryPublic(LoreTaskComponentEdgeMigration.TARGET_SQL, Map.of()));
    }

    private LoreTaskComponentEdgeMigration.Ops taskComponentEdgeOps() {
        String edge = LoreTaskComponentEdgeMigration.TARGET_EDGE;
        return new LoreTaskComponentEdgeMigration.Ops() {
            @Override public void createTagged(String taskUid, String componentId) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM (SELECT FROM KnowTask WHERE task_uid=:id) "
                    + "TO (SELECT FROM LoreComponent WHERE component_id=:c) IF NOT EXISTS",
                    Map.of("id", taskUid, "c", componentId))).await().indefinitely();
            }

            @Override public boolean taggedExists(String taskUid, String componentId) {
                List<Map<String, Object>> n = ingestService.queryPublic(
                    "SELECT count(*) AS n FROM " + edge + " WHERE @out.task_uid=:id AND @in.component_id=:c",
                    Map.of("id", taskUid, "c", componentId));
                return !n.isEmpty() && ((Number) n.get(0).getOrDefault("n", 0)).longValue() > 0;
            }

            @Override public void deleteLegacy(String rid) {
                // rid проверен в плане (#N:M). DELETE EDGE в ArcadeDB нет — удаление по @rid.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM " + LoreTaskComponentEdgeMigration.LEGACY_EDGE + " WHERE @rid=" + rid))
                    .await().indefinitely();
            }
        };
    }
}
