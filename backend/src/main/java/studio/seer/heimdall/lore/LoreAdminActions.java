package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-02 — журнал действий админки для экрана:
 * {@code GET /lore/admin/actions}. Кто (caller + ось human/agent), что (family +
 * entity_id), когда (ts), исход (status — код ответа, отказы видны).
 *
 * <p>Второго журнала нет: это тот же ряд AO-01 ({@code MetricSnapshot},
 * {@code metric='lore.action'}), что и срез {@code admin_actions}, только
 * админские семейства ({@link LoreSlices#ADMIN_FAMILIES}). Отдельный эндпоинт
 * нужен ради двух вещей, которых срез дать не может:
 * <ul>
 *   <li><b>период</b> — {@code ts} хранится LONG (epoch millis), а параметры
 *       среза приходят строками: сравнение строки с LONG молча не отберёт ничего;</li>
 *   <li><b>честная полнота</b> — {@code total} (сколько всего под фильтром),
 *       {@code truncated} (выбрано на строку больше лимита — видно и без счёта) и
 *       {@code total_state}: счёт, которому верить нельзя, отдаётся как unknown,
 *       а не цифрой.</li>
 * </ul>
 */
@Path("/lore/admin/actions")
public class LoreAdminActions extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreAdminActions.class);

    static final int DEFAULT_LIMIT = 200;
    static final int MAX_LIMIT = 1000;
    static final Set<String> AXES = Set.of("human", "agent", "unauth");

    record Query(String sql, String countSql, Map<String, Object> params) {}

    static Query build(String caller, String axis, String family, Long from, Long to, int limit) {
        return build(caller, axis, family, null, from, to, limit);
    }

    /** S7B-13: {@code batchId} — только записи этой пачки массовых правок. */
    static Query build(String caller, String axis, String family, String batchId, Long from, Long to, int limit) {
        if (family != null && !LoreSlices.ADMIN_FAMILIES.contains(family))
            throw new IllegalArgumentException("unknown family '" + family + "' — admin journal families: "
                + new java.util.TreeSet<>(LoreSlices.ADMIN_FAMILIES));
        if (axis != null && !AXES.contains(axis))
            throw new IllegalArgumentException("unknown axis '" + axis + "' — expected one of "
                + new java.util.TreeSet<>(AXES));
        if (from != null && to != null && from > to)
            throw new IllegalArgumentException("from is later than to");
        if (batchId != null && !LoreRoleBatch.isBatchId(batchId))
            throw new IllegalArgumentException("batch_id '" + batchId + "' is not a batch id (rb-<millis>-<hex8> expected)");
        StringBuilder where = new StringBuilder(" FROM AgentActionLog WHERE object_type IN [")
            .append(String.join(", ", LoreSlices.ADMIN_FAMILIES.stream().sorted().map(f -> "'" + f + "'").toList()))
            .append("]");
        Map<String, Object> p = new LinkedHashMap<>();
        if (caller != null) { where.append(" AND source = :caller"); p.put("caller", caller); }
        if (axis != null)   { where.append(" AND segment = :axis");  p.put("axis", axis); }
        if (family != null) { where.append(" AND object_type = :family"); p.put("family", family); }
        if (batchId != null) { where.append(" AND object_id = :batch"); p.put("batch", batchId); }
        if (from != null)   { where.append(" AND ts >= :from"); p.put("from", from); }
        if (to != null)     { where.append(" AND ts <= :to");   p.put("to", to); }
        String sql = "SELECT " + AgentActionLog.ROW_COLUMNS + where + " ORDER BY ts DESC LIMIT " + (limit + 1);
        return new Query(sql, "SELECT count(*) AS n" + where, p);
    }

    /**
     * S7B-13: каждая строка журнала получает {@code batch_id} — id пачки или null.
     * Запись о пачке {@code POST /lore/user/role/batch} несёт id пачки сущностью:
     * фильтр журнала берёт первое *_id поле ответа, а batch_id в ответе пачки стоит
     * первым из них. Строки копируются — ряды из базы и из тестов бывают неизменяемыми.
     */
    static List<Map<String, Object>> withBatch(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>(r);
            Object e = r.get("entity_id");
            m.put("batch_id", e instanceof String s && LoreRoleBatch.isBatchId(s) ? s : null);
            out.add(m);
        }
        return out;
    }

    /** epoch millis | ISO-момент | дата (UTC); {@code to}=дата — конец дня включительно. Пусто → null. */
    static Long parseTime(String name, String v, boolean endOfDay) {
        if (v == null || v.isBlank()) return null;
        String s = v.trim();
        if (s.chars().allMatch(Character::isDigit)) {
            try { return Long.parseLong(s); } catch (NumberFormatException e) { /* ниже — общий отказ */ }
        }
        try { return Instant.parse(s).toEpochMilli(); } catch (DateTimeParseException ignored) { }
        try {
            LocalDate d = LocalDate.parse(s);
            return endOfDay
                ? d.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() - 1
                : d.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        } catch (DateTimeParseException ignored) { }
        throw new IllegalArgumentException("bad value for param: " + name
            + " (epoch millis, ISO instant like 2026-11-10T12:00:00Z or date 2026-11-10 expected)");
    }

    static int limitOf(Integer limit) {
        if (limit == null) return DEFAULT_LIMIT;
        if (limit < 1 || limit > MAX_LIMIT)
            throw new IllegalArgumentException("limit must be 1.." + MAX_LIMIT + " (got " + limit + ")");
        return limit;
    }

    /** {@code rows} выбраны с LIMIT limit+1; {@code total} — счёт или null, если посчитать не удалось. */
    static Map<String, Object> body(List<Map<String, Object>> rows, Long total, int limit) {
        boolean truncated = rows.size() > limit;
        List<Map<String, Object>> shown = truncated ? new ArrayList<>(rows.subList(0, limit)) : rows;
        // Счёт меньше того, что уже выбрано, — счёт врёт (count под нехваткой heap
        // недосчитывает); цифру не отдаём, говорим «неизвестно».
        boolean exact = total != null && total >= rows.size();
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("rows", shown);
        b.put("shown", shown.size());
        b.put("total", exact ? total : null);
        b.put("total_state", exact ? "exact" : "unknown");
        b.put("truncated", truncated);
        b.put("limit", limit);
        return b;
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response actions(@QueryParam("caller") String caller,
                            @QueryParam("axis") String axis,
                            @QueryParam("family") String family,
                            @QueryParam("batch_id") String batchId,
                            @QueryParam("from") String from,
                            @QueryParam("to") String to,
                            @QueryParam("limit") Integer limit,
                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        Query q;
        int lim;
        try {
            lim = limitOf(limit);
            q = build(blankToNull(caller), blankToNull(axis), blankToNull(family), blankToNull(batchId),
                parseTime("from", from, false), parseTime("to", to, true), lim);
        } catch (IllegalArgumentException e) {
            return badParams(e.getMessage());
        }
        List<Map<String, Object>> rows;
        try {
            rows = ingestService.queryPublic(q.sql(), q.params());
        } catch (Exception e) {
            LOG.warnf("[ADMIN ACTIONS] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        Long total = null;
        try {
            List<Map<String, Object>> c = ingestService.queryPublic(q.countSql(), q.params());
            if (!c.isEmpty() && c.get(0).get("n") instanceof Number n) total = n.longValue();
        } catch (Exception e) {
            // Строки есть, счёта нет — отдаём строки и total_state=unknown, а не 502.
            LOG.warnf("[ADMIN ACTIONS] count: %s", e.getMessage());
        }
        Map<String, Object> b = body(withBatch(rows), total, lim);
        Map<String, Object> filters = new LinkedHashMap<>(q.params());
        b.put("filters", filters);
        return noStore(Response.ok(b));
    }

    /**
     * S7B-13: раскрыть пачку массовых правок до её назначений и собрать откат.
     * Элементы — события AL-102 ({@code KnowProjectRoleEvent}) с этим batch_id;
     * откат — {@code rollback.body} как есть в {@code POST /lore/user/role/batch}
     * (окно {@link LoreRoleBatch#UNDO_WINDOW}; после него сервер откажет по имени,
     * {@code undo_open=false} говорит об этом заранее).
     */
    @GET
    @Path("batch/{batch_id}")
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response batch(@jakarta.ws.rs.PathParam("batch_id") String batchId,
                          @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!LoreRoleBatch.isBatchId(batchId))
            return badParams("batch_id '" + batchId + "' is not a batch id (rb-<millis>-<hex8> expected)");
        List<Map<String, Object>> events;
        try {
            events = ingestService.queryPublic(
                "SELECT kc_sub, project, action, role, role_before, at, by_role FROM KnowProjectRoleEvent "
                + "WHERE batch_id = :b ORDER BY at", Map.of("b", batchId));
        } catch (Exception e) {
            LOG.warnf("[ADMIN ACTIONS] batch %s: %s", batchId, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        if (events.isEmpty())
            return targetNotFound("пачка " + batchId + ": событий назначений с этим batch_id нет "
                + "(пачка без изменений, dry_run или событие не записалось)");
        Map<String, Object> b = batchBody(batchId, events, Instant.now());
        return noStore(Response.ok(b));
    }

    /** S7B-13: тело ответа раскрытой пачки — чистая часть. */
    static Map<String, Object> batchBody(String batchId, List<Map<String, Object>> events, Instant now) {
        Object kcSub = events.get(0).get("kc_sub");
        List<Map<String, Object>> undo = LoreRoleBatch.undoFromEvents(events);
        Instant until = LoreRoleBatch.undoUntil(batchId);
        Map<String, Object> rbBody = new LinkedHashMap<>();
        rbBody.put("kc_sub", kcSub);
        rbBody.put("changes", undo);
        rbBody.put("undo_of", batchId);
        Map<String, Object> rollback = new LinkedHashMap<>();
        rollback.put("method", "POST");
        rollback.put("path", "/lore/user/role/batch");
        rollback.put("body", rbBody);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("batch_id", batchId);
        b.put("kc_sub", kcSub);
        b.put("count", events.size());
        b.put("items", events);
        b.put("undo", undo);
        b.put("undo_until", String.valueOf(until));
        b.put("undo_open", until != null && !now.isAfter(until));
        b.put("rollback", rollback);
        return b;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
