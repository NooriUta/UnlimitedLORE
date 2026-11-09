package studio.seer.heimdall.lore;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.inject.Inject;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-04 · decision:D-2026-UXR-VIEWS-SERVER — личный слой
 * на сервере: сохранённые виды, избранное, недавние, личные настройки. Видны с
 * любого устройства (владелица работает с телефона, браузерные виды там не видны).
 *
 * <h2>Чьё это</h2>
 * Владелец — {@code sub} токена ({@code KnowUser.kc_sub}). Агент пишет и читает от
 * имени СВОЕГО владельца (ребро {@code OWNED_BY}, {@link ProjectRbacService#ownerKcSub}):
 * «видимость — сам пользователь и его агенты». Вызывающий не опознан (нет токена,
 * агент без владельца) — {@code 401 NO_IDENTITY}, а не пустой список: «не смогли
 * понять, кто вы» и «у вас ничего нет» обязаны различаться.
 *
 * <h2>Одновременная правка (S2-09)</h2>
 * Вид и настройки несут {@code version}. Запись идёт условием по версии, которую
 * сервер только что прочитал ({@code WHERE row_version = :cv}), — две вкладки не
 * затрут друг друга молча. Клиент может передать {@code expected_version} — то,
 * что он видел; расхождение даёт {@code 409 CONFLICT} с текущим состоянием в
 * {@code current}, чтобы UI показал «изменено в другом месте» без второго запроса.
 *
 * <h2>Командные виды</h2>
 * {@code is_team_default} заводит и правит только админ (человек admin/superadmin
 * или agent-full). Командный вид обязан быть виден кому-то кроме автора
 * (visibility all|roles). В разделе действует: личный вид по умолчанию → иначе
 * командный → иначе нет ({@code defaults} в ответе списка).
 *
 * <p>Все пути — POST/GET, как во всём {@code /lore}: PUT/DELETE в ресурсах LORE нет,
 * и сторожа матрицы агентов разбирают ровно эти глаголы.
 */
@Path("/lore/me")
public class LoreMeResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreMeResource.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    ProjectRbacService projectRbac;

    // ── Кто вызывает ────────────────────────────────────────────────────────

    /** kc_sub владельца данных или {@code null} — вызывающий не опознан. */
    String ownerSub() {
        String clientId = callerClientId();
        if (clientId != null) return projectRbac.ownerKcSub(clientId);
        return callerKcSub();
    }

    private Response noIdentity() {
        return noStore(Response.status(Response.Status.UNAUTHORIZED).entity(new LoreError("NO_IDENTITY",
            "вызывающий не опознан: нужен токен человека или агента с владельцем (OWNED_BY) — "
            + "личные виды и настройки привязаны к kc_sub")));
    }

    /** Роли для видимости «роли»: роль реалма из заголовка + проектные роли из графа. */
    private Set<String> callerRoles(String me, String headerRole) {
        Set<String> roles = new HashSet<>();
        if (headerRole != null) roles.add(headerRole);
        for (Map<String, Object> r : ingestService.queryPublic(
                "SELECT role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub", Map.of("sub", me))) {
            if (r.get("role") != null) roles.add(String.valueOf(r.get("role")));
        }
        return roles;
    }

    /**
     * Метка времени ФИКСИРОВАННОЙ ширины. По ней сортируются недавние и выбирается
     * свежий командный вид — строкой. {@code Instant.toString()} печатает дробную часть
     * переменной длины («…:00Z» против «…:00.1Z»), и строковое сравнение таких меток
     * врёт: 'Z' больше '.'.
     */
    private static final java.time.format.DateTimeFormatter TS = java.time.format.DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'").withZone(java.time.ZoneOffset.UTC);

    private static String now() { return TS.format(Instant.now()); }

    private static Response upstream(String what, Exception e) {
        LOG.warnf("[LORE ME] %s: %s", what, e.getMessage());
        return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
    }

    private Response forbidden(String code, String detail) {
        return noStore(Response.status(Response.Status.FORBIDDEN).entity(new LoreError(code, detail)));
    }

    private static Response conflict(String detail, Object current) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "CONFLICT");
        body.put("detail", detail);
        body.put("current", current);
        return noStore(Response.status(Response.Status.CONFLICT).entity(body));
    }

    @SuppressWarnings("unchecked")
    private long affected(LoreCommandClient.LoreCommand cmd) {
        Object res = writeClient.command(db, basicAuth(), cmd).await().indefinitely().result();
        if (res instanceof List<?> l && !l.isEmpty() && l.get(0) instanceof Map<?, ?> m
                && m.get("count") instanceof Number n) return n.longValue();
        return 0;
    }

    private void exec(String sql, Map<String, Object> params) {
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
            .await().indefinitely();
    }

    private static int intOf(Object o) { return o instanceof Number n ? n.intValue() : 0; }

    // ── Виды ────────────────────────────────────────────────────────────────

    public record ViewRequest(String view_uid, String name, String section, String query,
                              String visibility, List<String> roles, Boolean is_team_default,
                              Boolean is_personal_default, Integer expected_version) {}

    public record ViewDeleteRequest(String view_uid, Integer expected_version) {}

    private static final String VIEW_FIELDS = "view_uid, owner_sub, name, section, query, visibility, roles, "
        + "is_team_default, is_personal_default, row_version, created_at, updated_at";

    private Map<String, Object> readView(String uid) {
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT " + VIEW_FIELDS + " FROM KnowSavedView WHERE view_uid = :u", Map.of("u", uid));
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Наружная форма вида. kc_sub владельца не отдаём — только «мой / не мой». */
    private static Map<String, Object> viewOut(Map<String, Object> row, String me) {
        Map<String, Object> v = new LinkedHashMap<>();
        boolean own = Objects.equals(row.get("owner_sub"), me);
        v.put("view_uid", row.get("view_uid"));
        v.put("name", row.get("name"));
        v.put("section", row.get("section"));
        v.put("query", row.get("query") == null ? "" : row.get("query"));
        v.put("visibility", row.get("visibility"));
        v.put("roles", LoreMePrefs.parseRolesCsv((String) row.get("roles")));
        v.put("is_team_default", Boolean.TRUE.equals(row.get("is_team_default")));
        v.put("is_personal_default", own && Boolean.TRUE.equals(row.get("is_personal_default")));
        v.put("own", own);
        v.put("version", intOf(row.get("row_version")));
        v.put("created_at", row.get("created_at"));
        v.put("updated_at", row.get("updated_at"));
        return v;
    }

    private boolean visible(Map<String, Object> row, String me, Set<String> roles) {
        return LoreMePrefs.visibleTo((String) row.get("owner_sub"), (String) row.get("visibility"),
            LoreMePrefs.parseRolesCsv((String) row.get("roles")), me, roles);
    }

    /** Может ли вызывающий править вид: владелец; командный вид — ещё и админ. */
    private boolean canEdit(Map<String, Object> row, String me, String role) {
        if (Objects.equals(row.get("owner_sub"), me)) return true;
        return Boolean.TRUE.equals(row.get("is_team_default")) && isFullScopeCaller(role);
    }

    @GET
    @Path("views")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listViews(@QueryParam("section") String section, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (section != null && !section.isBlank() && !LoreMePrefs.SECTION.matcher(section).matches())
            return badParams("section must match " + LoreMePrefs.SECTION.pattern());
        try {
            Map<String, Object> p = new HashMap<>();
            p.put("me", me);
            String sql = "SELECT " + VIEW_FIELDS + " FROM KnowSavedView WHERE "
                + "(owner_sub = :me OR visibility IN ['all', 'roles'])";
            if (section != null && !section.isBlank()) { sql += " AND section = :s"; p.put("s", section); }
            sql += " ORDER BY section, name";
            Set<String> roles = callerRoles(me, role);
            List<Map<String, Object>> out = new ArrayList<>();
            Map<String, String> personal = new LinkedHashMap<>();
            Map<String, String> team = new LinkedHashMap<>();
            Map<String, String> teamAt = new HashMap<>();
            for (Map<String, Object> row : ingestService.queryPublic(sql, p)) {
                if (!visible(row, me, roles)) continue;
                Map<String, Object> v = viewOut(row, me);
                out.add(v);
                String sec = String.valueOf(v.get("section"));
                if (Boolean.TRUE.equals(v.get("is_personal_default"))) personal.putIfAbsent(sec, (String) v.get("view_uid"));
                if (Boolean.TRUE.equals(v.get("is_team_default"))) {
                    String at = String.valueOf(v.get("updated_at"));
                    // Командных по умолчанию в разделе может оказаться больше одного
                    // (два админа) — берём самый свежий, детерминированно.
                    if (!team.containsKey(sec) || at.compareTo(teamAt.get(sec)) > 0) {
                        team.put(sec, (String) v.get("view_uid"));
                        teamAt.put(sec, at);
                    }
                }
            }
            Map<String, String> defaults = new LinkedHashMap<>(team);
            defaults.putAll(personal);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("views", out);
            body.put("count", out.size());
            body.put("defaults", defaults);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("views list", e);
        }
    }

    @POST
    @Path("views")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response saveView(ViewRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (req == null) return badParams("body required");
        try {
            return req.view_uid() == null || req.view_uid().isBlank()
                ? createView(req, me, role) : updateView(req, me, role);
        } catch (LoreExceptions.Forbidden f) {
            throw f;
        } catch (Exception e) {
            return upstream("view save", e);
        }
    }

    private Response createView(ViewRequest req, String me, String role) {
        String visibility = req.visibility() == null ? "me" : req.visibility();
        String err = LoreMePrefs.validateView(req.name(), req.section(), req.query(), visibility, req.roles());
        if (err != null) return badParams(err);
        boolean team = Boolean.TRUE.equals(req.is_team_default());
        if (team) {
            if (!isFullScopeCaller(role))
                return forbidden("TEAM_VIEW_FORBIDDEN", "командный вид по умолчанию заводит только админ");
            if ("me".equals(visibility))
                return badParams("командный вид должен быть виден команде: visibility all|roles");
        }
        boolean personal = Boolean.TRUE.equals(req.is_personal_default());
        String uid = "view-" + UUID.randomUUID();
        String at = now();
        Map<String, Object> p = new HashMap<>();
        p.put("u", uid);
        p.put("me", me);
        p.put("n", req.name().trim());
        p.put("s", req.section());
        p.put("q", req.query() == null ? "" : req.query());
        p.put("vis", visibility);
        p.put("r", LoreMePrefs.rolesCsv(req.roles()));
        p.put("td", team);
        p.put("pd", personal);
        p.put("at", at);
        if (personal) clearPersonalDefault(me, req.section(), null);
        exec("INSERT INTO KnowSavedView SET view_uid=:u, owner_sub=:me, name=:n, section=:s, query=:q, "
            + "visibility=:vis, roles=:r, is_team_default=:td, is_personal_default=:pd, row_version=1, "
            + "created_at=:at, updated_at=:at", p);
        Map<String, Object> row = readView(uid);
        if (row == null)
            return noStore(Response.ok(Map.of("ok", false, "outcome", LoreOutcome.NOOP,
                "reason", "INSERT выполнен, но вид не читается обратно")));
        return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.CREATED, "view", viewOut(row, me))));
    }

    /** Снять «личный по умолчанию» с остальных видов владельца в разделе. Версию не трогает: это не правка вида. */
    private void clearPersonalDefault(String me, String section, String exceptUid) {
        Map<String, Object> p = new HashMap<>();
        p.put("me", me);
        p.put("s", section);
        String sql = "UPDATE KnowSavedView SET is_personal_default=false "
            + "WHERE owner_sub=:me AND section=:s AND is_personal_default=true";
        if (exceptUid != null) { sql += " AND view_uid <> :u"; p.put("u", exceptUid); }
        exec(sql, p);
    }

    private Response updateView(ViewRequest req, String me, String role) {
        Map<String, Object> row = readView(req.view_uid());
        Set<String> roles = row == null ? Set.of() : callerRoles(me, role);
        // Невидимый вид — «не найден», а не «запрещено»: сам факт существования
        // чужого личного вида тоже не раскрываем.
        if (row == null || !visible(row, me, roles)) return targetNotFound("вид " + req.view_uid() + " не найден");
        if (!canEdit(row, me, role)) return forbidden("NOT_OWNER", "править вид может только его владелец");
        int cv = intOf(row.get("row_version"));
        if (req.expected_version() != null && req.expected_version() != cv)
            return conflict("вид изменён в другом месте: ожидали версию " + req.expected_version()
                + ", сейчас " + cv, viewOut(row, me));
        if (req.section() != null && !req.section().equals(row.get("section")))
            return badParams("section вида не меняется — сохраните как новый вид");

        String name = req.name() != null ? req.name() : (String) row.get("name");
        String query = req.query() != null ? req.query() : (row.get("query") == null ? "" : (String) row.get("query"));
        String visibility = req.visibility() != null ? req.visibility() : (String) row.get("visibility");
        List<String> vroles = req.roles() != null ? req.roles() : LoreMePrefs.parseRolesCsv((String) row.get("roles"));
        if ("me".equals(visibility) && req.visibility() != null && req.roles() == null) vroles = List.of();
        String err = LoreMePrefs.validateView(name, (String) row.get("section"), query, visibility, vroles);
        if (err != null) return badParams(err);
        boolean team = req.is_team_default() != null ? req.is_team_default() : Boolean.TRUE.equals(row.get("is_team_default"));
        if (team != Boolean.TRUE.equals(row.get("is_team_default")) && !isFullScopeCaller(role))
            return forbidden("TEAM_VIEW_FORBIDDEN", "командный вид по умолчанию назначает только админ");
        if (team && "me".equals(visibility))
            return badParams("командный вид должен быть виден команде: visibility all|roles");
        boolean own = Objects.equals(row.get("owner_sub"), me);
        boolean personal = req.is_personal_default() != null && own
            ? req.is_personal_default() : Boolean.TRUE.equals(row.get("is_personal_default"));
        String rolesCsv = LoreMePrefs.rolesCsv(vroles);

        boolean contentChanged = !name.trim().equals(row.get("name"))
            || !query.equals(row.get("query") == null ? "" : row.get("query"))
            || !visibility.equals(row.get("visibility"))
            || !rolesCsv.equals(row.get("roles") == null ? "" : row.get("roles"))
            || team != Boolean.TRUE.equals(row.get("is_team_default"));
        boolean personalChanged = personal != Boolean.TRUE.equals(row.get("is_personal_default"));
        if (!contentChanged && !personalChanged)
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.UNCHANGED,
                "view", viewOut(row, me), "hint", "вид уже такой — повторять вызов не нужно")));

        if (personalChanged && personal) clearPersonalDefault(me, (String) row.get("section"), req.view_uid());
        Map<String, Object> p = new HashMap<>();
        p.put("u", req.view_uid());
        p.put("cv", cv);
        p.put("pd", personal);
        String sql;
        if (contentChanged) {
            p.put("nv", cv + 1);
            p.put("n", name.trim());
            p.put("q", query);
            p.put("vis", visibility);
            p.put("r", rolesCsv);
            p.put("td", team);
            p.put("at", now());
            sql = "UPDATE KnowSavedView SET name=:n, query=:q, visibility=:vis, roles=:r, is_team_default=:td, "
                + "is_personal_default=:pd, row_version=:nv, updated_at=:at WHERE view_uid=:u AND row_version=:cv";
        } else {
            sql = "UPDATE KnowSavedView SET is_personal_default=:pd WHERE view_uid=:u AND row_version=:cv";
        }
        long n;
        try {
            n = affected(new LoreCommandClient.LoreCommand("sql", sql, p));
        } catch (RuntimeException e) {
            if (!isConcurrentModification(e)) throw e;
            n = 0;
        }
        Map<String, Object> after = readView(req.view_uid());
        if (n == 0) {
            if (after == null) return targetNotFound("вид " + req.view_uid() + " удалён в другом месте");
            return conflict("вид изменён в другом месте одновременно с этой правкой", viewOut(after, me));
        }
        return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.UPDATED,
            "view", viewOut(after == null ? row : after, me))));
    }

    private static boolean isConcurrentModification(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = t.getMessage();
            if (m != null && m.contains("ConcurrentModification")) return true;
        }
        return false;
    }

    @POST
    @Path("views/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteView(ViewDeleteRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (req == null || req.view_uid() == null || req.view_uid().isBlank()) return badParams("view_uid required");
        try {
            Map<String, Object> row = readView(req.view_uid());
            if (row == null || !visible(row, me, callerRoles(me, role)))
                return targetNotFound("вид " + req.view_uid() + " не найден");
            if (!canEdit(row, me, role)) return forbidden("NOT_OWNER", "удалить вид может только его владелец");
            int cv = intOf(row.get("row_version"));
            if (req.expected_version() != null && req.expected_version() != cv)
                return conflict("вид изменён в другом месте: ожидали версию " + req.expected_version()
                    + ", сейчас " + cv, viewOut(row, me));
            long n = affected(new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM KnowSavedView WHERE view_uid=:u AND row_version=:cv",
                Map.of("u", req.view_uid(), "cv", cv)));
            if (n == 0) {
                Map<String, Object> after = readView(req.view_uid());
                if (after != null) return conflict("вид изменён в другом месте одновременно с удалением", viewOut(after, me));
                return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.NOOP,
                    "reason", "вид уже удалён в другом месте")));
            }
            // Вид в чужом избранном после удаления — висячая ссылка; снимаем вместе с видом.
            exec("DELETE FROM KnowUserFavorite WHERE ref_type='view' AND ref_id=:u", Map.of("u", req.view_uid()));
            // S2-05: и из «частых видов» памяти — привычка к несуществующему виду бессмысленна.
            exec("DELETE FROM KnowUserHabit WHERE kind='frequent_views' AND habit_key=:u", Map.of("u", req.view_uid()));
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.DELETED, "view_uid", req.view_uid())));
        } catch (Exception e) {
            return upstream("view delete", e);
        }
    }

    // ── Избранное ───────────────────────────────────────────────────────────

    public record RefRequest(String ref_type, String ref_id, String action) {}

    private String refError(RefRequest req) {
        if (req == null) return "body required";
        if (req.ref_type() == null || !LoreMePrefs.REF_TYPE.matcher(req.ref_type()).matches())
            return "ref_type must match " + LoreMePrefs.REF_TYPE.pattern();
        if (req.ref_id() == null || !LoreMePrefs.REF_ID.matcher(req.ref_id()).matches())
            return "ref_id must match " + LoreMePrefs.REF_ID.pattern();
        return null;
    }

    @GET
    @Path("favorites")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listFavorites() {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT ref_type, ref_id, added_at FROM KnowUserFavorite WHERE owner_sub = :me "
                + "ORDER BY added_at DESC", Map.of("me", me));
            return noStore(Response.ok(Map.of("ok", true, "favorites", rows, "count", rows.size())));
        } catch (Exception e) {
            return upstream("favorites list", e);
        }
    }

    @POST
    @Path("favorites")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setFavorite(RefRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        String err = refError(req);
        if (err != null) return badParams(err);
        String action = req.action() == null ? "add" : req.action();
        if (!"add".equals(action) && !"remove".equals(action)) return badParams("action must be add|remove");
        Map<String, Object> key = Map.of("me", me, "t", req.ref_type(), "i", req.ref_id());
        try {
            if ("remove".equals(action)) {
                long n = affected(new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM KnowUserFavorite WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i", key));
                return noStore(Response.ok(Map.of("ok", true, "outcome", n > 0 ? LoreOutcome.DELETED : LoreOutcome.NOOP)));
            }
            List<Map<String, Object>> prev = ingestService.queryPublic(
                "SELECT added_at FROM KnowUserFavorite WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i", key);
            if (!prev.isEmpty())
                return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.UNCHANGED)));
            Map<String, Object> p = new HashMap<>(key);
            p.put("at", now());
            // UPSERT, а не INSERT: гонка двух «добавить» не роняет второй вызов на уникальном индексе.
            exec("UPDATE KnowUserFavorite SET owner_sub=:me, ref_type=:t, ref_id=:i, added_at=:at "
                + "UPSERT WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i", p);
            return noStore(Response.ok(Map.of("ok", true, "outcome", LoreOutcome.CREATED)));
        } catch (Exception e) {
            return upstream("favorite " + action, e);
        }
    }

    // ── Недавние ────────────────────────────────────────────────────────────

    @GET
    @Path("recent")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listRecent(@QueryParam("limit") Integer limit) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        int lim = limit == null ? LoreMePrefs.RECENT_CAP : Math.max(1, Math.min(limit, LoreMePrefs.RECENT_CAP));
        try {
            // S2-05: старше срока хранения не отдаётся; remembering=false — пустой
            // список значит «не запоминаю», а не «ничего не открывали».
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT ref_type, ref_id, visited_at, visits FROM KnowUserRecent WHERE owner_sub = :me "
                + "AND visited_at >= :cut ORDER BY visited_at DESC LIMIT " + lim,
                Map.of("me", me, "cut", LoreMemory.cutoff(Instant.now())));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("recent", rows);
            body.put("count", rows.size());
            body.put("cap", LoreMePrefs.RECENT_CAP);
            body.put("remembering", LoreMemoryResource.remembering(ingestService, me));
            body.put("retention_days", LoreMemory.RETENTION_DAYS);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("recent list", e);
        }
    }

    @POST
    @Path("recent")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response touchRecent(RefRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        String err = refError(req);
        if (err != null) return badParams(err);
        Map<String, Object> p = new HashMap<>();
        p.put("me", me);
        p.put("t", req.ref_type());
        p.put("i", req.ref_id());
        p.put("at", now());
        try {
            // S2-05 «не запоминать»: честный отказ записи, а не молчаливое «ок».
            if (!LoreMemoryResource.remembering(ingestService, me))
                return noStore(Response.ok(Map.of("ok", true, "recorded", false, "reason", "not_remembering",
                    "outcome", LoreOutcome.NOOP)));
            List<Map<String, Object>> prev = ingestService.queryPublic(
                "SELECT visits, visited_at FROM KnowUserRecent WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i",
                Map.of("me", me, "t", req.ref_type(), "i", req.ref_id()));
            p.put("v", (prev.isEmpty() ? 0 : intOf(prev.get(0).get("visits"))) + 1);
            exec("UPDATE KnowUserRecent SET owner_sub=:me, ref_type=:t, ref_id=:i, visited_at=:at, visits=:v "
                + "UPSERT WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i", p);
            // first_seen (S2-05) — только у новой записи; у старых строк S2-04 его нет,
            // память тогда честно показывает first_seen = last_seen.
            if (prev.isEmpty())
                exec("UPDATE KnowUserRecent SET first_seen=:at WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i "
                    + "AND first_seen IS NULL", p);
            // Хвост сверх предела — срезаем сразу: «недавние» не копятся бессрочно.
            List<Map<String, Object>> tail = ingestService.queryPublic(
                "SELECT @rid AS rid FROM KnowUserRecent WHERE owner_sub = :me ORDER BY visited_at DESC SKIP "
                + LoreMePrefs.RECENT_CAP, Map.of("me", me));
            for (Map<String, Object> t : tail)
                exec("DELETE FROM KnowUserRecent WHERE @rid = " + t.get("rid"), Map.of());
            return noStore(Response.ok(Map.of("ok", true, "recorded", true,
                "outcome", prev.isEmpty() ? LoreOutcome.CREATED : LoreOutcome.UPDATED,
                "visits", p.get("v"), "trimmed", tail.size())));
        } catch (Exception e) {
            return upstream("recent touch", e);
        }
    }

    // ── Мои проекты (S7B-14, S9-04) ─────────────────────────────────────────

    /**
     * Проекты вызывающего — по назначениям ролей (HAS_PROJECT_ROLE, источник истины
     * о правах — граф, ADR-LORE-036), а не все проекты LORE: «Все мои (N своих)».
     * Без ролей — честный ноль, без опознанного вызывающего — 401.
     */
    @GET
    @Path("projects")
    @Produces(MediaType.APPLICATION_JSON)
    public Response myProjects() {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT @in.slug AS slug, role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :me ORDER BY slug",
                Map.of("me", me));
            List<Map<String, Object>> projects = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                if (r.get("slug") == null) continue;
                Map<String, Object> p = new LinkedHashMap<>();
                p.put("slug", r.get("slug"));
                p.put("role", r.get("role"));
                projects.add(p);
            }
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("projects", projects);
            body.put("count", projects.size());
            body.put("source", "HAS_PROJECT_ROLE");
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("my projects", e);
        }
    }

    // ── Личные настройки ────────────────────────────────────────────────────

    public record SettingsRequest(Map<String, Object> settings, Integer expected_version) {}

    private Map<String, Object> readSettingsRow(String me) {
        List<Map<String, Object>> rows = ingestService.queryPublic(
            "SELECT settings_json, row_version, updated_at FROM KnowUserSettings WHERE owner_sub = :me",
            Map.of("me", me));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private static Map<String, Object> parseStored(Map<String, Object> row) {
        if (row == null || row.get("settings_json") == null) return Map.of();
        try {
            Map<String, Object> m = JSON.readValue(String.valueOf(row.get("settings_json")),
                new TypeReference<LinkedHashMap<String, Object>>() {});
            return LoreMePrefs.merge(m, null);
        } catch (Exception e) {
            LOG.warnf("[LORE ME] settings_json не разбирается — отдаю умолчания: %s", e.getMessage());
            return Map.of();
        }
    }

    private static Map<String, Object> settingsOut(Map<String, Object> row) {
        Map<String, Object> stored = parseStored(row);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("settings", LoreMePrefs.effective(stored));
        out.put("stored", stored);
        out.put("version", row == null ? 0 : intOf(row.get("row_version")));
        out.put("updated_at", row == null ? null : row.get("updated_at"));
        out.put("schema", LoreMePrefs.schema());
        return out;
    }

    // ── Черновики (S5-09) ───────────────────────────────────────────────────

    public record DraftRequest(String ref_type, String ref_id, String field, String body_md, Integer base_version) {}

    public record DraftDeleteRequest(String ref_type, String ref_id, String field) {}

    /** Черновики записи у вызывающего — по полю, свежие сверху. Пустой список — «черновиков нет». */
    @GET
    @Path("drafts")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listDrafts(@QueryParam("ref_type") String refType, @QueryParam("ref_id") String refId) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        String err = LoreMeDrafts.error(refType, refId, "x", "", null);
        if (err != null) return badParams(err);
        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                "SELECT ref_type, ref_id, field, body_md, base_version, saved_at FROM KnowUserDraft "
                + "WHERE owner_sub = :me AND ref_type = :t AND ref_id = :i ORDER BY saved_at DESC",
                Map.of("me", me, "t", refType, "i", refId));
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("ok", true);
            body.put("drafts", rows.stream().map(LoreMeDrafts::out).toList());
            body.put("count", rows.size());
            return noStore(Response.ok(body));
        } catch (Exception e) {
            return upstream("drafts list", e);
        }
    }

    /** Сохранить черновик поля: один на (владелец, запись, поле), повтор обновляет. */
    @POST
    @Path("drafts")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response saveDraft(DraftRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (req == null) return badParams("body required");
        String err = LoreMeDrafts.error(req.ref_type(), req.ref_id(), req.field(), req.body_md(), req.base_version());
        if (err != null) return badParams(err);
        Map<String, Object> p = new HashMap<>();
        p.put("me", me);
        p.put("t", req.ref_type());
        p.put("i", req.ref_id());
        p.put("f", req.field());
        p.put("b", req.body_md());
        p.put("v", req.base_version());
        p.put("at", now());
        try {
            boolean existed = !ingestService.queryPublic(
                "SELECT @rid FROM KnowUserDraft WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i AND field=:f",
                Map.of("me", me, "t", req.ref_type(), "i", req.ref_id(), "f", req.field())).isEmpty();
            exec("UPDATE KnowUserDraft SET owner_sub=:me, ref_type=:t, ref_id=:i, field=:f, body_md=:b, "
                + "base_version=:v, saved_at=:at UPSERT WHERE owner_sub=:me AND ref_type=:t AND ref_id=:i AND field=:f", p);
            return noStore(Response.ok(Map.of("ok", true, "saved_at", p.get("at"),
                "outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED)));
        } catch (Exception e) {
            return upstream("draft save", e);
        }
    }

    /** Удалить черновик поля (после сохранения записи или «отбросить»); без field — все черновики записи. */
    @POST
    @Path("drafts/delete")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteDraft(DraftDeleteRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (req == null) return badParams("body required");
        String field = req.field() == null ? "x" : req.field();
        String err = LoreMeDrafts.error(req.ref_type(), req.ref_id(), field, "", null);
        if (err != null) return badParams(err);
        Map<String, Object> p = new HashMap<>();
        p.put("me", me);
        p.put("t", req.ref_type());
        p.put("i", req.ref_id());
        String where = "owner_sub=:me AND ref_type=:t AND ref_id=:i";
        if (req.field() != null) { where += " AND field=:f"; p.put("f", req.field()); }
        try {
            long n = affected(new LoreCommandClient.LoreCommand("sql", "DELETE FROM KnowUserDraft WHERE " + where, p));
            return noStore(Response.ok(Map.of("ok", true, "deleted", n,
                "outcome", n > 0 ? LoreOutcome.DELETED : LoreOutcome.NOOP)));
        } catch (Exception e) {
            return upstream("draft delete", e);
        }
    }

    @GET
    @Path("settings")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getSettings() {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        try {
            return noStore(Response.ok(settingsOut(readSettingsRow(me))));
        } catch (Exception e) {
            return upstream("settings get", e);
        }
    }

    @POST
    @Path("settings")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response saveSettings(SettingsRequest req) {
        if (!enabled) return disabled();
        String me = ownerSub();
        if (me == null) return noIdentity();
        if (req == null || req.settings() == null) return badParams("settings required");
        List<String> errs = LoreMePrefs.validateSettingsPatch(req.settings());
        if (!errs.isEmpty()) return badParams(String.join("; ", errs));
        try {
            Map<String, Object> row = readSettingsRow(me);
            int cv = row == null ? 0 : intOf(row.get("row_version"));
            if (req.expected_version() != null && req.expected_version() != cv)
                return conflict("настройки изменены в другом месте: ожидали версию " + req.expected_version()
                    + ", сейчас " + cv, settingsOut(row));
            Map<String, Object> stored = parseStored(row);
            Map<String, Object> merged = LoreMePrefs.merge(stored, req.settings());
            if (row != null && merged.equals(stored)) {
                Map<String, Object> out = settingsOut(row);
                out.put("outcome", LoreOutcome.UNCHANGED);
                return noStore(Response.ok(out));
            }
            Map<String, Object> p = new HashMap<>();
            p.put("me", me);
            p.put("j", JSON.writeValueAsString(merged));
            p.put("nv", cv + 1);
            p.put("at", now());
            long n;
            try {
                if (row == null) {
                    exec("INSERT INTO KnowUserSettings SET owner_sub=:me, settings_json=:j, row_version=:nv, "
                        + "updated_at=:at", p);
                    n = 1;
                } else {
                    p.put("cv", cv);
                    n = affected(new LoreCommandClient.LoreCommand("sql",
                        "UPDATE KnowUserSettings SET settings_json=:j, row_version=:nv, updated_at=:at "
                        + "WHERE owner_sub=:me AND row_version=:cv", p));
                }
            } catch (RuntimeException e) {
                // Первая запись с двух устройств сразу: второй INSERT упирается в
                // уникальный индекс owner_sub — это та же гонка, что и устаревшая версия.
                String m = String.valueOf(LoreUpstream.detail(e));
                if (!isConcurrentModification(e) && !m.contains("DuplicatedKey") && !m.contains("Duplicated key"))
                    throw e;
                n = 0;
            }
            Map<String, Object> after = readSettingsRow(me);
            if (n == 0) return conflict("настройки изменены в другом месте одновременно с этой правкой", settingsOut(after));
            Map<String, Object> out = settingsOut(after);
            out.put("outcome", row == null ? LoreOutcome.CREATED : LoreOutcome.UPDATED);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            return upstream("settings save", e);
        }
    }
}
