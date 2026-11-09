package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.jboss.logging.Logger;
import studio.seer.heimdall.lore.news.NewsAtomWriter;
import studio.seer.heimdall.lore.news.NewsV2;
import studio.seer.heimdall.lore.news.NewsV2Engine;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09: единый сервис новостей v2 — GET /lore/news/v2.
 *
 * <p>Аддитивно: GET /lore/news (v1 и miniLORE) не тронут, пока клиенты не
 * переедут. Ответ — {@code {events, groups, metrics, meta}}; все числа
 * считает {@link NewsV2Engine} по SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0, клиенты
 * только рисуют.
 *
 * <ul>
 *   <li>GET  /lore/news/v2            — лента, группы, метрики с дельтой, meta с валидацией (S7A-01/02/03/07/09)</li>
 *   <li>GET  /lore/news/v2/atom       — Atom на тот же фильтр (S7A-05)</li>
 *   <li>GET  /lore/news/v2/read-mark  — черта «прочитано» (S7A-04)</li>
 *   <li>PUT  /lore/news/v2/read-mark  — сдвиг черты действием пользователя (S7A-04)</li>
 * </ul>
 *
 * <p>Параметры ленты: {@code from}, {@code to} (ISO-момент или местный день
 * YYYY-MM-DD; to — исключительно, день — до конца дня), {@code days} (окно, по
 * умолчанию 7), {@code tz} (по умолчанию Europe/Moscow), фильтры по осям
 * {@code type, project, component, sprint, milestone, author, kind, els}
 * (списки через запятую), разрез {@code group_by}, {@code sub},
 * {@code matrix} (N столбцов матрицы дни × проекты), {@code limit}.
 *
 * <p>Возвращает Response (не Uni) → исполняется на worker-нити, блокирующий
 * queryPublic безопасен (тот же приём, что /lore/news).
 */
@Path("/lore")
public class LoreNewsV2Resource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreNewsV2Resource.class);
    static final ZoneId DEFAULT_ZONE = ZoneId.of("Europe/Moscow");

    /** Проектный скоуп — тем же кодом, что у v1 (allowedProjectsOrNull), без копии правил. */
    @Inject
    AidaLoreResource lore;

    public record ReadMarkRequest(String at) {}

    @GET
    @Path("news/v2")
    @Produces(MediaType.APPLICATION_JSON)
    public Response newsV2(@QueryParam("from") String from, @QueryParam("to") String to,
                           @QueryParam("days") Integer days, @QueryParam("tz") String tz,
                           @QueryParam("type") String type, @QueryParam("project") String project,
                           @QueryParam("component") String component, @QueryParam("sprint") String sprint,
                           @QueryParam("milestone") String milestone, @QueryParam("author") String author,
                           @QueryParam("kind") String kind, @QueryParam("els") String els,
                           @QueryParam("who") String who,
                           @QueryParam("group_by") String groupBy, @QueryParam("sub") String sub,
                           @QueryParam("matrix") Integer matrix, @QueryParam("limit") Integer limit,
                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Built b = build(from, to, days, tz, type, project, component, sprint, milestone, author, kind, els, who, groupBy, sub, matrix, limit, role);
        if (b.error != null) return b.error;
        return noStore(Response.ok(b.response));
    }

    @GET
    @Path("news/v2/atom")
    @Produces("application/atom+xml")
    public Response newsV2Atom(@QueryParam("from") String from, @QueryParam("to") String to,
                               @QueryParam("days") Integer days, @QueryParam("tz") String tz,
                               @QueryParam("type") String type, @QueryParam("project") String project,
                               @QueryParam("component") String component, @QueryParam("sprint") String sprint,
                               @QueryParam("milestone") String milestone, @QueryParam("author") String author,
                               @QueryParam("kind") String kind, @QueryParam("els") String els,
                               @QueryParam("who") String who,
                               @Context UriInfo uri, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        Built b = build(from, to, days, tz, type, project, component, sprint, milestone, author, kind, els, who, null, null, null, null, role);
        if (b.error != null) return b.error;
        String self = uri == null ? "urn:lore:news:v2" : uri.getRequestUri().toString();
        String xml = NewsAtomWriter.write(b.response, self, null);
        return Response.ok(xml).type("application/atom+xml; charset=utf-8").header("Cache-Control", "no-store").build();
    }

    @GET
    @Path("news/v2/read-mark")
    @Produces(MediaType.APPLICATION_JSON)
    public Response readMark() {
        if (!enabled) return disabled();
        return noStore(Response.ok(store().get().toMap()));
    }

    @PUT
    @Path("news/v2/read-mark")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setReadMark(ReadMarkRequest req) {
        if (!enabled) return disabled();
        Instant at;
        if (req == null || req.at() == null || req.at().isBlank()) at = Instant.now();
        else {
            at = LoreNewsV2Collector.instant(req.at());
            if (at == null) return badParams("at: ожидается ISO-момент, например 2026-11-07T17:30:00Z");
        }
        String by = Optional.ofNullable(callerKcSub()).orElse(callerClientId());
        LoreNewsReadMarkStore.State st = store().set(at, by);
        Response.Status code = "unavailable".equals(st.state()) ? Response.Status.SERVICE_UNAVAILABLE : Response.Status.OK;
        return noStore(Response.status(code).entity(st.toMap()));
    }

    // ── сборка ──

    private record Built(Map<String, Object> response, Response error) {}

    private Built build(String from, String to, Integer days, String tz, String type, String project, String component,
                        String sprint, String milestone, String author, String kind, String els, String who,
                        String groupBy, String sub, Integer matrix, Integer limit, String role) {
        Set<String> scope = lore.allowedProjectsOrNull(role);
        if (scope != null && scope.isEmpty())
            return new Built(null, noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("SCOPE_EMPTY", "проектный скоуп: у вызывающего нет ни одного разрешённого "
                    + "проекта — лента не отдаётся пустой"))));
        ZoneId zone;
        try { zone = tz == null || tz.isBlank() ? DEFAULT_ZONE : ZoneId.of(tz); }
        catch (Exception e) { return new Built(null, badParams("tz: неизвестный часовой пояс " + tz)); }
        for (String ax : new String[]{groupBy, sub})
            if (ax != null && !NewsV2Engine.AXES.contains(ax))
                return new Built(null, badParams("group_by/sub: ожидается одна из осей " + NewsV2Engine.AXES));
        if (limit != null && limit < 1) return new Built(null, badParams("limit: ожидается целое ≥ 1"));
        Instant now = Instant.now();
        Instant[] period = period(from, to, days, zone, now);
        if (period == null) return new Built(null, badParams("from/to: ожидается ISO-момент или день YYYY-MM-DD, from < to"));
        try {
            LoreNewsV2Collector col = new LoreNewsV2Collector(
                (sql, params) -> LoreTimeFormat.isoUtcRows(ingestService.queryPublic(sql, params)));
            NewsV2.Input input = col.collect(period[0], period[1], now, zone, scope);
            LoreNewsReadMarkStore.State mark = store().get();
            NewsV2.Query q = new NewsV2.Query(csv(type), csv(project), csv(component), csv(sprint), csv(milestone),
                csv(author), csv(kind), csv(els), groupBy == null ? "project" : groupBy, sub, matrix, limit,
                "ok".equals(mark.state()) ? mark.at() : null, csv(who));
            // S7A-01: автор и история статуса — из истории SCD2 (S2-12/S2-13), а не заглушки.
            java.util.function.BiFunction<String, Map<String, Object>, List<Map<String, Object>>> rows =
                (sql, params) -> LoreTimeFormat.isoUtcRows(ingestService.queryPublic(sql, params));
            StatusHistoryTimeline timeline = StatusHistoryTimeline.load(rows);
            HistAuthorIndex authorIndex = HistAuthorIndex.load(rows);
            Map<String, Object> out = new NewsV2Engine(input,
                    LoreNewsV2Collector.authors(timeline, authorIndex), timeline)
                .compute(q);
            @SuppressWarnings("unchecked") Map<String, Object> meta = (Map<String, Object>) out.get("meta");
            meta.put("read_mark", mark.toMap());
            return new Built(out, null);
        } catch (Exception e) {
            LOG.warnf("[LORE NEWS v2] %s", e.getMessage());
            return new Built(null, noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e))));
        }
    }

    /**
     * Период [t0, t1). По умолчанию — {@code days} местных дней, заканчивая
     * сейчас: t0 = начало дня (сегодня − days + 1), t1 = now. День в to —
     * включительно (до конца дня), момент — исключительно.
     */
    static Instant[] period(String from, String to, Integer days, ZoneId zone, Instant now) {
        int d = days == null || days <= 0 ? 7 : Math.min(days, 366);
        Instant t1 = to == null || to.isBlank() ? now : parseBound(to, zone, true);
        Instant t0 = from == null || from.isBlank()
            ? (t1 == null ? null : t1.atZone(zone).toLocalDate().minusDays(d - 1L).atStartOfDay(zone).toInstant())
            : parseBound(from, zone, false);
        if (t0 == null || t1 == null || !t0.isBefore(t1)) return null;
        return new Instant[]{t0, t1};
    }

    static Instant parseBound(String s, ZoneId zone, boolean end) {
        String x = s.trim();
        if (x.matches("\\d{4}-\\d{2}-\\d{2}")) {
            LocalDate day = LocalDate.parse(x);
            return (end ? day.plusDays(1) : day).atStartOfDay(zone).toInstant();
        }
        return LoreNewsV2Collector.instant(x);
    }

    static Set<String> csv(String s) {
        if (s == null || s.isBlank()) return null;
        Set<String> out = new LinkedHashSet<>();
        for (String p : s.split(",")) if (!p.isBlank()) out.add(p.trim());
        return out.isEmpty() ? null : out;
    }

    private LoreNewsReadMarkStore store() {
        return new LoreNewsReadMarkStore(
            (sql, params) -> ingestService.queryPublic(sql, params),
            (sql, params) -> writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
                .await().indefinitely());
    }
}
