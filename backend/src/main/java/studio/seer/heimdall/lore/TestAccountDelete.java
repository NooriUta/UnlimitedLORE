package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-01 — удаление ТЕСТОВЫХ учёток агента и человека.
 *
 * <p>Правило — D-2026-ONLY-TEST-PREFIXED-ACCOUNTS: создавать, менять и удалять
 * агентам и админке можно только тестовые учётки. Проверка имени — здесь, на
 * сервере: кнопка в UI её только повторяет, обойти её запросом мимо UI нельзя.
 * <ul>
 *   <li>агент — clientId {@code lore-mcp-<профиль>_Test*} (так мастер учёток
 *       называет машинную учётку с машиной {@code Test…});</li>
 *   <li>человек — логин Keycloak {@code TEST*} (регистр не важен: {@code test-user-1}).</li>
 * </ul>
 *
 * <p><b>Что удаляется.</b> Агент: клиент KC (его сервисного пользователя KC
 * удаляет сам вместе с клиентом — после удаления это проверяется пробой
 * {@code GET /users/{id}}, а не принимается на веру), затем актор агента в графе
 * со всеми рёбрами (владелец OWNED_BY, машина USES_MACHINE, …). Человек: его
 * агенты (тем же путём), его проектные роли и вершина KnowUser. Пользователя
 * Keycloak LORE НЕ удаляет никогда — даже тестового: это работа инфраструктурной
 * сессии, и так сказано в плане.
 *
 * <p>Порядок «сначала KC, потом граф»: отказ KC (нет права manage-clients у
 * lore-admin) останавливает всё до записи в граф — повтор после выдачи права
 * идёт по тому же плану, а не по наполовину удалённой учётке.
 *
 * <p>Чистая часть: KC — {@link KcOps.KcCall}, граф — {@link Graph}; ресурс только
 * подставляет настоящие вызовы. Так её проверяет {@code TestAccountDeleteTest}
 * без живого Keycloak.
 */
final class TestAccountDelete {

    private TestAccountDelete() {}

    /** Граф: чтение строк и команда записи. */
    interface Graph {
        List<Map<String, Object>> query(String sql, Map<String, Object> params);
        void exec(String sql, Map<String, Object> params);
    }

    /** Глоб из решения: {@code <приложение>_<профиль>_Test*} в форме, которую даёт мастер учёток. */
    static final Pattern TEST_AGENT_CLIENT = Pattern.compile("^lore-mcp-[a-z_-]+_Test[A-Za-z0-9._-]*$");
    /** Глоб из решения: логин начинается со слова TEST. */
    static final Pattern TEST_PERSON_LOGIN = Pattern.compile("^(?i)test[A-Za-z0-9._@-]*$");

    static final String REAL_AGENT_REFUSAL =
        "удалять можно только тестовые учётки агентов (lore-mcp-<профиль>_Test…, D-2026-ONLY-TEST-PREFIXED-ACCOUNTS); "
        + "реальные — только выключить";
    static final String REAL_PERSON_REFUSAL =
        "удалять можно только тестовых людей (логин TEST…, D-2026-ONLY-TEST-PREFIXED-ACCOUNTS); "
        + "реальных — только отключить";
    static final String KC_USER_KEPT =
        "LORE не удаляет пользователей Keycloak, даже тестовых: учётку удаляет инфраструктурная сессия (CICDGitHub)";
    static final String SA_NOTE =
        "сервисного пользователя Keycloak удаляет вместе с клиентом; после удаления это проверяется пробой";

    static boolean isTestAgentClient(String clientId) {
        return clientId != null && TEST_AGENT_CLIENT.matcher(clientId).matches();
    }

    static boolean isTestPersonLogin(String login) {
        return login != null && TEST_PERSON_LOGIN.matcher(login).matches();
    }

    // ── агент ─────────────────────────────────────────────────────────────

    /**
     * План «что уйдёт»: в KC — клиент, его сервисный пользователь и роли; в LORE —
     * акторы агента (actor_id/client_id), их владелец (identity: OWNED_BY), роль
     * агента и рёбра по типам. Ничего не пишет.
     */
    static Map<String, Object> agentPlan(KcOps.KcCall kc, Graph g, String clientId) throws Exception {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("client_id", clientId);
        plan.put("keycloak", kcClientPart(kc, clientId));
        plan.put("lore", Map.of("actors", agentActors(g, clientId)));
        return plan;
    }

    private static Map<String, Object> kcClientPart(KcOps.KcCall kc, String clientId) throws Exception {
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("client_id", clientId);
        KcOps.Resp r = kc.call("GET", "/clients?clientId=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8), null);
        if (r.status() != 200) throw new KcOps.KcFailed(r.status(), "GET /clients");
        String uuid = null;
        JsonArray a = new JsonArray(r.body());
        for (int i = 0; i < a.size(); i++) {
            JsonObject c = a.getJsonObject(i);
            // поиск KC по clientId бывает не точным — берём только ровное совпадение
            if (clientId.equals(c.getString("clientId"))) { uuid = c.getString("id"); break; }
        }
        if (uuid == null) {
            k.put("state", "absent");
            k.put("action", "none");
            k.put("note", "клиента в Keycloak нет — удаляется только LORE-часть");
            return k;
        }
        k.put("state", "present");
        k.put("client_uuid", uuid);
        k.put("action", "delete_client");
        KcOps.Resp sa = kc.call("GET", "/clients/" + uuid + "/service-account-user", null);
        if (sa.status() == 200) {
            JsonObject u = new JsonObject(sa.body());
            Map<String, Object> su = new LinkedHashMap<>();
            su.put("id", u.getString("id"));
            su.put("username", u.getString("username"));
            su.put("action", "removed_with_client");
            k.put("service_account_user", su);
            KcOps.Resp rm = kc.call("GET", "/users/" + u.getString("id") + "/role-mappings", null);
            JsonObject m = rm.status() == 200 ? jsonOrNull(rm.body()) : null;
            k.put("roles", m == null ? List.of() : roleNames(m));
            k.put("roles_checked", m != null);
            if (m == null) k.put("roles_note", "роли сервисного пользователя не прочитаны: KC " + rm.status());
        } else {
            k.put("service_account_user", null);
            k.put("roles", List.of());
            k.put("roles_checked", sa.status() == 404);
            if (sa.status() != 404) k.put("roles_note", "сервисный пользователь не прочитан: KC " + sa.status());
        }
        k.put("note", SA_NOTE);
        return k;
    }

    /** realm-роли по имени, клиентские — «клиент/роль». */
    static List<String> roleNames(JsonObject mappings) {
        List<String> out = new ArrayList<>();
        JsonArray realm = mappings.getJsonArray("realmMappings");
        if (realm != null) for (int i = 0; i < realm.size(); i++) out.add(realm.getJsonObject(i).getString("name"));
        JsonObject clients = mappings.getJsonObject("clientMappings");
        if (clients != null) {
            for (String key : new java.util.TreeSet<>(clients.fieldNames())) {
                JsonObject c = clients.getJsonObject(key);
                JsonArray ms = c == null ? null : c.getJsonArray("mappings");
                String name = c != null && c.getString("client") != null ? c.getString("client") : key;
                if (ms != null) for (int i = 0; i < ms.size(); i++) out.add(name + "/" + ms.getJsonObject(i).getString("name"));
            }
        }
        return out;
    }

    private static JsonObject jsonOrNull(String body) {
        try { return new JsonObject(body); } catch (RuntimeException e) { return null; }
    }

    private static List<Map<String, Object>> agentActors(Graph g, String clientId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : g.query(
                "SELECT actor_id, name, client_id, agent_role, machine_id, out('OWNED_BY').kc_sub AS owners "
                + "FROM KnowActor WHERE kind = 'agent' AND (client_id = :c OR actor_id = :c)", Map.of("c", clientId))) {
            String actorId = str(r.get("actor_id"));
            if (actorId == null) continue;
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("actor_id", actorId);
            a.put("name", r.get("name"));
            a.put("client_id", r.get("client_id"));
            a.put("agent_role", r.get("agent_role"));
            a.put("machine_id", r.get("machine_id"));
            // identity агента в LORE — связка с владельцем: уходит вместе с актором
            a.put("owners", strings(r.get("owners")));
            a.put("edges", edgeCounts(g, "SELECT expand(bothE()) FROM KnowActor WHERE actor_id = :a", Map.of("a", actorId)));
            a.put("action", "delete");
            out.add(a);
        }
        return out;
    }

    private static Map<String, Integer> edgeCounts(Graph g, String sql, Map<String, Object> p) {
        Map<String, Integer> n = new TreeMap<>();
        for (Map<String, Object> e : g.query(sql, p)) {
            String t = str(e.get("@type"));
            n.merge(t == null ? "?" : t, 1, Integer::sum);
        }
        return n;
    }

    @SuppressWarnings("unchecked")
    static boolean isEmpty(Map<String, Object> agentPlan) {
        Map<String, Object> k = (Map<String, Object>) agentPlan.get("keycloak");
        Map<String, Object> l = (Map<String, Object>) agentPlan.get("lore");
        return "absent".equals(k.get("state")) && ((List<?>) l.get("actors")).isEmpty();
    }

    /**
     * Применить план агента: клиент KC → проба сервисного пользователя → акторы в
     * графе. Отказ KC — {@link KcOps.KcFailed} до записи в граф.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> applyAgent(KcOps.KcCall kc, Graph g, Map<String, Object> plan) throws Exception {
        Map<String, Object> k = (Map<String, Object>) plan.get("keycloak");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("client_id", plan.get("client_id"));
        boolean deleted = false;
        if ("present".equals(k.get("state"))) {
            String uuid = String.valueOf(k.get("client_uuid"));
            KcOps.Resp d = kc.call("DELETE", "/clients/" + uuid, null);
            if (d.status() >= 300) throw new KcOps.KcFailed(d.status(), "DELETE /clients");
            deleted = true;
            Map<String, Object> sa = (Map<String, Object>) k.get("service_account_user");
            if (sa != null && sa.get("id") != null) {
                KcOps.Resp probe = kc.call("GET", "/users/" + sa.get("id"), null);
                if (probe.status() == 404) out.put("service_account_user_removed", true);
                else if (probe.status() == 200) {
                    out.put("service_account_user_removed", false);
                    out.put("service_account_note", "Keycloak оставил сервисного пользователя " + sa.get("username")
                        + " после удаления клиента — LORE пользователей KC не удаляет, передать инфраструктурной сессии");
                } else {
                    out.put("service_account_user_removed", null);
                    out.put("service_account_note", "не проверено: KC " + probe.status());
                }
            }
        }
        out.put("kc_client_deleted", deleted);
        List<String> gone = new ArrayList<>();
        for (Map<String, Object> a : (List<Map<String, Object>>) ((Map<String, Object>) plan.get("lore")).get("actors")) {
            String actorId = String.valueOf(a.get("actor_id"));
            // ArcadeDB: сначала рёбра, потом вершина (как удаление ADR)
            g.exec("DELETE FROM (SELECT expand(bothE()) FROM KnowActor WHERE actor_id = :a)", Map.of("a", actorId));
            g.exec("DELETE FROM KnowActor WHERE actor_id = :a", Map.of("a", actorId));
            gone.add(actorId);
        }
        out.put("actors_deleted", gone);
        return out;
    }

    // ── человек ───────────────────────────────────────────────────────────

    /**
     * План «что уйдёт» у тестового человека. Логин уже проверен вызывающим по KC
     * ({@code username}). Помехи — в {@code blockers}: реальный агент за человеком
     * и последний owner проекта; с помехой применение отказывает.
     */
    static Map<String, Object> personPlan(KcOps.KcCall kc, Graph g, String kcSub, String username) throws Exception {
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("kc_sub", kcSub);
        Map<String, Object> ku = new LinkedHashMap<>();
        ku.put("id", kcSub);
        ku.put("username", username);
        ku.put("action", "kept");
        ku.put("note", KC_USER_KEPT);
        plan.put("kc_user", ku);

        List<String> blockers = new ArrayList<>();
        List<Map<String, Object>> users = g.query(
            "SELECT kc_sub, display_name FROM KnowUser WHERE kc_sub = :s", Map.of("s", kcSub));
        Map<String, Object> user = null;
        if (!users.isEmpty()) {
            user = new LinkedHashMap<>();
            user.put("kc_sub", kcSub);
            user.put("display_name", users.get(0).get("display_name"));
            user.put("edges", edgeCounts(g, "SELECT expand(bothE()) FROM KnowUser WHERE kc_sub = :s", Map.of("s", kcSub)));
            user.put("action", "delete");
        }
        List<Map<String, Object>> roles = new ArrayList<>();
        for (Map<String, Object> r : g.query(
                "SELECT @in.slug AS project, role FROM HAS_PROJECT_ROLE WHERE valid_to IS NULL AND @out.kc_sub = :s", Map.of("s", kcSub))) {
            String project = str(r.get("project"));
            String role = str(r.get("role"));
            roles.add(Map.of("project", project == null ? "?" : project, "role", role == null ? "" : role));
            if ("owner".equals(role) && project != null) {
                List<Map<String, Object>> n = g.query(
                    "SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE valid_to IS NULL AND @in.slug = :p AND role = 'owner'", Map.of("p", project));
                long owners = n.isEmpty() || !(n.get(0).get("n") instanceof Number x) ? 0 : x.longValue();
                if (owners <= 1)
                    blockers.add("последний owner проекта " + project + " — сначала назначьте другого владельца");
            }
        }
        Map<String, Object> lore = new LinkedHashMap<>();
        lore.put("user", user);
        lore.put("project_roles", roles);
        plan.put("lore", lore);

        List<Map<String, Object>> agents = new ArrayList<>();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (Map<String, Object> r : g.query(
                "SELECT actor_id, client_id FROM (SELECT expand(in('OWNED_BY')) FROM KnowUser WHERE kc_sub = :s)",
                Map.of("s", kcSub))) {
            String client = str(r.get("client_id"));
            String actor = str(r.get("actor_id"));
            String key = client != null ? client : actor;
            if (key == null || !seen.add(key)) continue;
            if (!isTestAgentClient(key)) {
                blockers.add("за человеком реальный агент " + key + " — его можно только выключить; "
                    + "сначала передайте агента другому владельцу");
                continue;
            }
            agents.add(agentPlan(kc, g, key));
        }
        plan.put("agents", agents);
        plan.put("blockers", blockers);
        return plan;
    }

    /** Почему применять нельзя; null — можно. */
    @SuppressWarnings("unchecked")
    static String refusal(Map<String, Object> personPlan) {
        List<String> b = (List<String>) personPlan.get("blockers");
        return b == null || b.isEmpty() ? null : String.join("; ", b);
    }

    @SuppressWarnings("unchecked")
    static boolean isEmptyPerson(Map<String, Object> personPlan) {
        Map<String, Object> l = (Map<String, Object>) personPlan.get("lore");
        return l.get("user") == null && ((List<?>) l.get("project_roles")).isEmpty()
            && ((List<?>) personPlan.get("agents")).isEmpty();
    }

    /**
     * Применить план человека: агенты (шаг агента) → проектные роли → вершина.
     * Пользователь KC остаётся. С помехой — {@link IllegalStateException} до любой записи.
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> applyPerson(KcOps.KcCall kc, Graph g, Map<String, Object> plan) throws Exception {
        String why = refusal(plan);
        if (why != null) throw new IllegalStateException(why);
        String kcSub = String.valueOf(plan.get("kc_sub"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kc_sub", kcSub);
        List<Map<String, Object>> agents = new ArrayList<>();
        for (Map<String, Object> a : (List<Map<String, Object>>) plan.get("agents")) agents.add(applyAgent(kc, g, a));
        out.put("agents", agents);
        Map<String, Object> lore = (Map<String, Object>) plan.get("lore");
        g.exec("DELETE FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :s", Map.of("s", kcSub)); // edge-history: тестовая учётка стирается целиком, со всеми версиями
        out.put("project_roles_removed", ((List<?>) lore.get("project_roles")).size());
        boolean hadUser = lore.get("user") != null;
        if (hadUser) {
            g.exec("DELETE FROM (SELECT expand(bothE()) FROM KnowUser WHERE kc_sub = :s)", Map.of("s", kcSub));
            g.exec("DELETE FROM KnowUser WHERE kc_sub = :s", Map.of("s", kcSub));
        }
        out.put("user_deleted", hadUser);
        out.put("kc_user", "kept");
        out.put("kc_user_note", KC_USER_KEPT);
        return out;
    }

    private static String str(Object v) {
        if (v instanceof Collection<?> c) v = c.isEmpty() ? null : c.iterator().next();
        return v == null || String.valueOf(v).isBlank() ? null : String.valueOf(v);
    }

    private static List<String> strings(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof Collection<?> c) { for (Object o : c) if (o != null) out.add(String.valueOf(o)); }
        else if (v != null) out.add(String.valueOf(v));
        return out;
    }
}
