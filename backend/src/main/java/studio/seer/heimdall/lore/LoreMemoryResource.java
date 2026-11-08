package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-05 — «что LORE помнит обо мне».
 *
 * <ul>
 *   <li>{@code GET  /lore/me/memory} — всё, что помнится: частые виды, частые срезы,
 *       недавние; флаг «запоминаю», срок хранения, правило доступа;</li>
 *   <li>{@code POST /lore/me/memory/hit} — отметить использование вида/среза;</li>
 *   <li>{@code POST /lore/me/memory/delete} — стереть запись ({@code memory_id}),
 *       вид памяти ({@code kind}) или всё (пустое тело);</li>
 *   <li>{@code POST /lore/me/memory/remembering} — «не запоминать» / «запоминать».</li>
 * </ul>
 *
 * <p><b>Доступ</b>: владелец — только из токена ({@code sub} человека или владелец
 * агента по OWNED_BY), параметра «чья память» нет вовсе — админ чужую память не
 * видит. Агент владельца читает и стирает (уборка по просьбе человека), но не
 * пишет привычки и не переключает «не запоминать»: это привычки и решение
 * человека — {@code 403 AGENT_SCOPE_FORBIDDEN}.
 *
 * <p><b>Срок хранения</b> {@link LoreMemory#RETENTION_DAYS} дней по последнему
 * использованию: старое не отдаётся никогда и стирается при чтении и записи.
 *
 * <p>Глаголы — POST/GET, как во всём {@code /lore} (см. {@link LoreMeResource}).
 */
@Path("/lore/me/memory")
public class LoreMemoryResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreMemoryResource.class);

    @Inject
    ProjectRbacService projectRbac;

    String ownerSub() {
        String clientId = callerClientId();
        if (clientId != null) return projectRbac.ownerKcSub(clientId);
        return callerKcSub();
    }

    private Response noIdentity() {
        return noStore(Response.status(Response.Status.UNAUTHORIZED).entity(new LoreError("NO_IDENTITY",
            "вызывающий не опознан: нужен токен человека или агента с владельцем (OWNED_BY) — "
            + "память привязана к kc_sub и видна только ему и его агентам")));
    }

    private static Response upstream(String what, Exception e) {
        LOG.warnf("[LORE MEMORY] %s: %s", what, e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
    }

    private static String now() { return LoreMemory.TS.format(Instant.now()); }

    private static int intOf(Object o) { return o instanceof Number n ? n.intValue() : 0; }

    private void exec(String sql, Map<String, Object> params) {
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely();
    }

    private long affected(String sql, Map<String, Object> params) {
        Object res = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely().result();
        if (res instanceof List<?> l && !l.isEmpty() && l.get(0) instanceof Map<?, ?> m
                && m.get("count") instanceof Number n) return n.longValue();
        return 0;
    }

    /** Запоминает ли LORE привычки владельца. Нет строки — да (умолчание). */
    static boolean remembering(LoreIngestService svc, String me) {
        List<Map<String, Object>> rows = svc.queryPublic(
            "SELECT remembering FROM KnowUserMemoryPref WHERE owner_sub = :me", Map.of("me", me));
        return rows.isEmpty() || !Boolean.FALSE.equals(rows.get(0).get("remembering"));
    }

    /** Стереть просроченное у владельца. Сбой — предупреждение: чтение и так отфильтрует старое. */
    private String purgeExpired(String me, String cut) {
        try {
            exec("DELETE FROM KnowUserHabit WHERE owner_sub = :me AND (last_seen IS NULL OR last_seen < :cut)",
                Map.of("me", me, "cut", cut));
            exec("DELETE FROM KnowUserRecent WHERE owner_sub = :me AND (visited_at IS NULL OR visited_at < :cut)",
                Map.of("me", me, "cut", cut));
            return null;
        } catch (Exception e) {
            LOG.warnf("[LORE MEMORY] purge: %s", e.getMessage());
            return "просроченная память не стёрта (" + LoreUpstream.detail(e) + ") — в ответ не попала, сотрётся позже";
        }
    }

    private static Map<String, Object> item(String memoryId, String kind, String key, Object label,
                                            Object hits, Object firstSeen, Object lastSeen) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("memory_id", memoryId);
        m.put("kind", kind);
        m.put("key", key);
        m.put("label", label);
        m.put("hits", intOf(hits));
        m.put("first_seen", firstSeen != null ? firstSeen : lastSeen);
        m.put("last_seen", lastSeen);
        return m;
    }

    // ── Чтение ──────────────────────────────────────────────────────────────

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response memory() {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        try {
            String cut = LoreMemory.cutoff(Instant.now());
            List<String> warnings = new ArrayList<>();
            String w = purgeExpired(me, cut);
            if (w != null) warnings.add(w);

            Map<String, List<Map<String, Object>>> byKind = new LinkedHashMap<>();
            for (String k : LoreMemory.KINDS) byKind.put(k, new ArrayList<>());

            List<Map<String, Object>> habits = ingestService.queryPublic(
                "SELECT memory_id, kind, habit_key, label, hits, first_seen, last_seen FROM KnowUserHabit "
                + "WHERE owner_sub = :me ORDER BY hits DESC, last_seen DESC", Map.of("me", me));
            // Частые виды опираются на вид S2-04: подпись — его текущее имя; вида нет
            // или он больше не виден — привычка не показывается (висячая ссылка).
            Map<String, String> viewNames = new HashMap<>();
            for (Map<String, Object> v : ingestService.queryPublic(
                    "SELECT view_uid, name FROM KnowSavedView WHERE owner_sub = :me OR visibility IN ['all', 'roles']",
                    Map.of("me", me)))
                viewNames.put(String.valueOf(v.get("view_uid")), (String) v.get("name"));
            for (Map<String, Object> h : habits) {
                String kind = (String) h.get("kind");
                String key = (String) h.get("habit_key");
                if (!LoreMemory.HABIT_KINDS.contains(kind) || !LoreMemory.fresh((String) h.get("last_seen"), cut)) continue;
                Object label = h.get("label");
                if ("frequent_views".equals(kind)) {
                    if (!viewNames.containsKey(key)) continue;
                    label = viewNames.get(key);
                }
                byKind.get(kind).add(item((String) h.get("memory_id"), kind, key, label,
                    h.get("hits"), h.get("first_seen"), h.get("last_seen")));
            }
            for (Map<String, Object> r : ingestService.queryPublic(
                    "SELECT ref_type, ref_id, visits, first_seen, visited_at FROM KnowUserRecent "
                    + "WHERE owner_sub = :me ORDER BY visited_at DESC", Map.of("me", me))) {
                if (!LoreMemory.fresh((String) r.get("visited_at"), cut)) continue;
                String t = String.valueOf(r.get("ref_type"));
                String i = String.valueOf(r.get("ref_id"));
                byKind.get("recent_records").add(item(LoreMemory.recentMemoryId(t, i), "recent_records",
                    t + ":" + i, null, r.get("visits"), r.get("first_seen"), r.get("visited_at")));
            }

            List<Map<String, Object>> categories = new ArrayList<>();
            int total = 0;
            for (var e : byKind.entrySet()) {
                categories.add(Map.of("kind", e.getKey(), "items", e.getValue()));
                total += e.getValue().size();
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("remembering", remembering(ingestService, me));
            body.put("retention_days", LoreMemory.RETENTION_DAYS);
            body.put("categories", categories);
            body.put("count", total);
            body.put("access", LoreMemory.ACCESS);
            body.put("warnings", warnings);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("memory get", e);
        }
    }

    // ── Отметить привычку ───────────────────────────────────────────────────

    public record HitRequest(String kind, String key, String label) {}

    @POST
    @Path("hit")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response hit(HitRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (callerClientId() != null)
            return agentScopeForbidden("привычки копятся только по действиям человека — агент их не пишет");
        if (req == null) return badParams("body required");
        String err = LoreMemory.validateHit(req.kind(), req.key(), req.label());
        if (err != null) return badParams(err);
        try {
            if ("frequent_views".equals(req.kind()) && ingestService.queryPublic(
                    "SELECT view_uid FROM KnowSavedView WHERE view_uid = :u AND (owner_sub = :me OR visibility IN ['all', 'roles'])",
                    Map.of("u", req.key(), "me", me)).isEmpty())
                return targetNotFound("вид " + req.key() + " не найден");
            if (!remembering(ingestService, me))
                return noStore(Response.ok(Map.of("ok", true, "recorded", false, "reason", "not_remembering",
                    "outcome", LoreOutcome.NOOP)));
            Map<String, Object> key = Map.of("me", me, "k", req.kind(), "hk", req.key());
            List<Map<String, Object>> prev = ingestService.queryPublic(
                "SELECT memory_id, hits, first_seen, label FROM KnowUserHabit "
                + "WHERE owner_sub = :me AND kind = :k AND habit_key = :hk", key);
            String at = now();
            Map<String, Object> p = new HashMap<>(key);
            p.put("at", at);
            int hits;
            if (prev.isEmpty()) {
                hits = 1;
                p.put("id", LoreMemory.newHabitId());
                p.put("l", req.label());
                // UPSERT: гонка двух первых отметок не роняет вторую на уникальном индексе.
                exec("UPDATE KnowUserHabit SET memory_id = :id, owner_sub = :me, kind = :k, habit_key = :hk, "
                    + "label = :l, hits = 1, first_seen = :at, last_seen = :at "
                    + "UPSERT WHERE owner_sub = :me AND kind = :k AND habit_key = :hk", p);
            } else {
                hits = intOf(prev.get(0).get("hits")) + 1;
                p.put("h", hits);
                // Подпись не затирается вызовом без label.
                p.put("l", req.label() != null ? req.label() : prev.get(0).get("label"));
                exec("UPDATE KnowUserHabit SET hits = :h, label = :l, last_seen = :at "
                    + "WHERE owner_sub = :me AND kind = :k AND habit_key = :hk", p);
            }
            trimHabits(me, req.kind());
            purgeExpired(me, LoreMemory.cutoff(Instant.now()));
            return noStore(Response.ok(Map.of("ok", true, "recorded", true, "hits", hits,
                "outcome", prev.isEmpty() ? LoreOutcome.CREATED : LoreOutcome.UPDATED)));
        } catch (Exception e) {
            return upstream("memory hit", e);
        }
    }

    /** Сверх предела вида — срезаем самые редкие и давние: память не копится бессрочно. */
    private void trimHabits(String me, String kind) {
        List<Map<String, Object>> tail = ingestService.queryPublic(
            "SELECT @rid AS rid FROM KnowUserHabit WHERE owner_sub = :me AND kind = :k "
            + "ORDER BY hits DESC, last_seen DESC SKIP " + LoreMemory.HABIT_CAP, Map.of("me", me, "k", kind));
        for (Map<String, Object> t : tail) exec("DELETE FROM KnowUserHabit WHERE @rid = " + t.get("rid"), Map.of());
    }

    // ── Стереть ─────────────────────────────────────────────────────────────

    public record EraseRequest(String memory_id, String kind) {}

    @POST
    @Path("delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response erase(EraseRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        String memoryId = req == null ? null : req.memory_id();
        String kind = req == null ? null : req.kind();
        if (memoryId != null && kind != null) return badParams("либо memory_id, либо kind — не оба");
        if (kind != null && !LoreMemory.KINDS.contains(kind))
            return badParams("kind must be one of " + String.join("|", LoreMemory.KINDS));
        try {
            Map<String, Object> erased = new LinkedHashMap<>();
            if (memoryId != null) {
                LoreMemory.RecentRef r = LoreMemory.parseRecentMemoryId(memoryId);
                long n;
                if (r != null) {
                    n = affected("DELETE FROM KnowUserRecent WHERE owner_sub = :me AND ref_type = :t AND ref_id = :i",
                        Map.of("me", me, "t", r.type(), "i", r.id()));
                    erased.put("recent_records", n);
                } else if (LoreMemory.HABIT_ID.matcher(memoryId).matches()) {
                    // owner_sub в условии: чужой memory_id не стирается и неотличим от несуществующего.
                    n = affected("DELETE FROM KnowUserHabit WHERE owner_sub = :me AND memory_id = :id",
                        Map.of("me", me, "id", memoryId));
                    erased.put("habit", n);
                } else {
                    n = 0;
                }
                if (n == 0) return targetNotFound("запись памяти " + memoryId + " не найдена");
                return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.DELETED,
                    "memory_id", memoryId, "erased", erased)));
            }
            long total = 0;
            for (String k : LoreMemory.KINDS) {
                if (kind != null && !kind.equals(k)) continue;
                long n = "recent_records".equals(k)
                    ? affected("DELETE FROM KnowUserRecent WHERE owner_sub = :me", Map.of("me", me))
                    : affected("DELETE FROM KnowUserHabit WHERE owner_sub = :me AND kind = :k", Map.of("me", me, "k", k));
                erased.put(k, n);
                total += n;
            }
            return noStore(Response.ok(Map.of("ok", true,
                "outcome", total > 0 ? LoreOutcome.DELETED : LoreOutcome.NOOP, "erased", erased)));
        } catch (Exception e) {
            return upstream("memory erase", e);
        }
    }

    // ── «Не запоминать» ─────────────────────────────────────────────────────

    public record RememberingRequest(Boolean remembering) {}

    @POST
    @Path("remembering")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setRemembering(RememberingRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (callerClientId() != null)
            return agentScopeForbidden("«не запоминать» решает только сам человек — агент этот флаг не переключает");
        if (req == null || req.remembering() == null) return badParams("remembering (true|false) required");
        try {
            boolean cur = remembering(ingestService, me);
            if (cur == req.remembering())
                return noStore(Response.ok(Map.of("ok", true, "remembering", cur, "outcome", LoreOutcome.UNCHANGED)));
            Map<String, Object> p = new HashMap<>();
            p.put("me", me);
            p.put("r", req.remembering());
            p.put("at", now());
            exec("UPDATE KnowUserMemoryPref SET owner_sub = :me, remembering = :r, updated_at = :at "
                + "UPSERT WHERE owner_sub = :me", p);
            return noStore(Response.ok(Map.of("ok", true, "remembering", remembering(ingestService, me),
                "outcome", LoreOutcome.UPDATED)));
        } catch (Exception e) {
            return upstream("memory remembering", e);
        }
    }
}
