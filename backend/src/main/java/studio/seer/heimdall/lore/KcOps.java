package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-20 — серверные хвосты UC-4 «отключить человека»,
 * чистая часть. Keycloak в CI нет: HTTP KC приходит сюда интерфейсом
 * {@link KcCall}, в тестах — заглушкой, в {@link LoreKcResource} — {@link KcBridge#kc}.
 *
 * <ul>
 *   <li><b>Все учётки realm'а.</b> {@code GET /users} у KC постраничный (first/max),
 *       и прежний {@code ?max=100} молча обрезал список: человека 101-го «не было».
 *       Здесь — страницы до неполной, и сбой страницы — отказ, а не короткий список.</li>
 *   <li><b>Выключить / включить учётку человека</b> ({@code enabled}) — дифф,
 *       «последний админ» (AL-35), «это вы», обратный вызов в окне. Учётку
 *       выключают, а не удаляют: включение возвращает всё как было.</li>
 *   <li><b>Включить учётку агента обратно</b> — обратное к disable.</li>
 * </ul>
 */
final class KcOps {

    private KcOps() {}

    /** Вызов Admin API KC: путь — от {@code /admin/realms/<realm>}. */
    interface KcCall { Resp call(String method, String path, String json) throws Exception; }

    record Resp(int status, String body) {}

    /** KC ответил не так: код и что звали — без тела (в теле бывает чужое). */
    static final class KcFailed extends RuntimeException {
        final int status;
        KcFailed(int status, String what) { super("kc " + what + " " + status); this.status = status; }
    }

    /** Страница по умолчанию: ровно прежний потолок, но теперь — не потолок. */
    static final int PAGE = 100;
    /** Предохранитель от бесконечного цикла при битом first у прокси: 1000 страниц = 100 000 учёток. */
    static final int MAX_PAGES = 1000;

    private static final Map<String, Object> CHECKED = Map.of("state", "checked", "source", "keycloak");

    private static Map<String, Object> unavailable(String why) { return Map.of("state", "unavailable", "source", why); }

    private static Map<String, Object> forbidden(String why) { return Map.of("state", "forbidden", "source", why); }

    // ── все учётки ────────────────────────────────────────────────────────

    static JsonArray listAllUsers(KcCall kc, int page) throws Exception {
        JsonArray all = new JsonArray();
        for (int n = 0; n < MAX_PAGES; n++) {
            int first = n * page;
            Resp r = kc.call("GET", "/users?first=" + first + "&max=" + page + "&briefRepresentation=true", null);
            if (r.status() != 200) throw new KcFailed(r.status(), "users first=" + first);
            JsonArray a;
            try {
                a = new JsonArray(r.body());
            } catch (RuntimeException e) {
                throw new KcFailed(r.status(), "users first=" + first + " (не JSON)");
            }
            for (int i = 0; i < a.size(); i++) all.add(a.getValue(i));
            if (a.size() < page) return all;
        }
        throw new KcFailed(200, "users: больше " + MAX_PAGES + " страниц — выборка остановлена");
    }

    /**
     * Строка ответа /lore/kc/users. Роли не прочитались — {@code roles_checked:false}:
     * пустой список ролей у такой учётки — «не знаем», а не «ролей нет», и подсчёт
     * администраторов по нему не верен.
     */
    static JsonObject userRow(JsonObject u, Resp mappings) {
        JsonArray names = new JsonArray();
        boolean checked = false;
        if (mappings != null && mappings.status() == 200) {
            try {
                JsonArray roles = new JsonArray(mappings.body());
                for (int j = 0; j < roles.size(); j++) names.add(roles.getJsonObject(j).getString("name"));
                checked = true;
            } catch (RuntimeException e) {
                names = new JsonArray();
            }
        }
        return JsonObject.of(
            "id", u.getString("id"), "username", u.getString("username"),
            "email", u.getString("email"), "enabled", u.getBoolean("enabled"),
            "roles", names, "roles_checked", checked);
    }

    // ── учётка человека: enabled ──────────────────────────────────────────

    static final String LAST_ADMIN = "это последняя включённая учётка с ролью admin/super-admin — выключив её, LORE "
        + "останется без администратора. Сначала назначьте admin кому-то ещё (AL-35)";
    static final String SELF = "это ваша учётка — выключив её, вы потеряете вход в LORE и не сможете включить её обратно";

    private static JsonObject objOrNull(String json) {
        if (json == null) return null;
        try { return new JsonObject(json); } catch (RuntimeException e) { return null; }
    }

    /**
     * Дифф одной учётки.
     *
     * @param userJson      ответ {@code GET /users/{id}} или null — не прочитали
     * @param enabledAdmins включённые носители admin/super-admin ({@link KcBridge#enabledAdminHolders})
     * @param callerSub     sub вызывающего; null — не знаем (auth выключен)
     */
    static Map<String, Object> userEnabledPlan(String userId, String userJson, boolean enable,
                                               Set<String> enabledAdmins, String callerSub) {
        JsonObject u = objOrNull(userJson);
        Boolean before = u == null ? null : u.getBoolean("enabled");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("user_id", userId);
        m.put("username", u == null ? null : u.getString("username"));
        m.put("before", before);
        m.put("after", enable);
        String kind = before == null ? (enable ? "enable" : "disable")
            : before == enable ? "unchanged" : (enable ? "enable" : "disable");
        m.put("kind", kind);
        m.put("sign", switch (kind) { case "enable" -> "+"; case "disable" -> "−"; default -> "="; });
        Map<String, Object> check;
        if (before == null) check = unavailable("учётка человека не прочиталась из Keycloak");
        else if ("disable".equals(kind) && callerSub != null && callerSub.equals(userId)) check = forbidden(SELF);
        else if ("disable".equals(kind) && enabledAdmins.size() <= 1 && enabledAdmins.contains(userId)) check = forbidden(LAST_ADMIN);
        else check = CHECKED;
        m.put("check", check);
        return m;
    }

    /** Почему применять нельзя, или null. Непроверенное не применяется так же, как запрещённое. */
    static String refusal(Map<String, Object> plan) {
        Object c = plan.get("check");
        if (!(c instanceof Map<?, ?> check)) return "дифф без проверки";
        Object state = check.get("state");
        if ("checked".equals(state)) return null;
        return String.valueOf(check.get("source"));
    }

    /**
     * Тело {@code PUT /users/{id}}: всё представление как прочитано, меняется только
     * {@code enabled}. Не частичное {@code {"enabled":false}}: при декларативном
     * профиле пользователя KC проверяет и пишет представление целиком, и неполное
     * тело рискует затереть атрибуты (гипотеза — живым KC не проверено, поэтому
     * берём путь, который безопасен в обоих случаях).
     */
    static JsonObject withEnabled(String userJson, boolean enabled) {
        JsonObject u = new JsonObject(userJson).copy();
        u.put("enabled", enabled);
        return u;
    }

    /**
     * Ответ применения. Первое поле — {@code user_id}: журнал AO-01 пишет его
     * сущностью записи. {@code undo} — тело обратного вызова этого же эндпоинта.
     */
    static Map<String, Object> userEnabledAnswer(String userId, String opId, Map<String, Object> plan, boolean sessionsLoggedOut) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("user_id", userId);
        m.put("op_id", opId);
        m.put("ok", true);
        m.put("username", plan.get("username"));
        m.put("enabled", plan.get("after"));
        m.put("kind", plan.get("kind"));
        boolean changed = !"unchanged".equals(plan.get("kind"));
        m.put("undo", changed && plan.get("before") instanceof Boolean b ? Map.of("enabled", b) : null);
        Instant until = KcDanger.undoUntil(opId);
        m.put("undo_until", changed && until != null ? String.valueOf(until) : null);
        m.put("sessions_logged_out", sessionsLoggedOut);
        return m;
    }

    // ── учётка агента: enabled ────────────────────────────────────────────

    static Map<String, Object> clientEnabledPlan(String clientId, String clientJson, boolean enable) {
        JsonObject c = objOrNull(clientJson);
        Boolean before = c == null ? null : c.getBoolean("enabled");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", clientId);
        m.put("id", c == null ? null : c.getString("id"));
        m.put("before", before);
        m.put("after", enable);
        String kind = before == null ? (enable ? "enable" : "disable")
            : before == enable ? "unchanged" : (enable ? "enable" : "disable");
        m.put("kind", kind);
        m.put("sign", switch (kind) { case "enable" -> "+"; case "disable" -> "−"; default -> "="; });
        m.put("check", before == null ? unavailable("клиент Keycloak не прочитался") : CHECKED);
        return m;
    }

    /** Ответ: {@code client_id} первым (журнал AO-01); undo — обратное действие. */
    static Map<String, Object> clientEnabledAnswer(String clientId, Map<String, Object> plan) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", clientId);
        m.put("ok", true);
        m.put("clientId", clientId);
        m.put("enabled", plan.get("after"));
        m.put("kind", plan.get("kind"));
        boolean changed = !"unchanged".equals(plan.get("kind"));
        m.put("undo", changed ? Map.of("action", Boolean.TRUE.equals(plan.get("after")) ? "disable" : "enable") : null);
        return m;
    }
}
