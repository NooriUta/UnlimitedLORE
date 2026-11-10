package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Kit 2 (K2-MATRIX), владелица 09.11 через S7A-12: ячейка матрицы «проект × люди» несёт
 * СОСТОЯНИЕ — «проверено / не смогли / нет прав», а не роль|null. Пустая ячейка по
 * Keycloak/Forgejo чаще значит «не смогли спросить», чем «нет роли», и путать их нельзя.
 *
 * <p>Источники ячеек:
 * <ul>
 *   <li>{@code graph} — рёбра HAS_PROJECT_ROLE, прочитаны целиком → {@code checked};</li>
 *   <li>{@code kc} — решение D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11 (31а): проектных ролей
 *       в Keycloak нет, поэтому ячейка ОДНА на человека, {@code project:"*"}, роль — его
 *       realm-роли; человек сопоставлен по {@code kc_sub} = id пользователя KC;</li>
 *   <li>{@code forgejo} — 32а: связи «KnowUser ↔ пользователь Forgejo» в графе нет, ячейка
 *       честно {@code unavailable} с причиной; Forgejo не опрашивается.</li>
 * </ul>
 * Строковое {@code state} — состояние графа (как было). Старые поля {@code projects}/{@code roles}
 * не убираются — обратная совместимость.
 */
final class LoreRoleMatrix {

    private LoreRoleMatrix() {}

    /** Закрытый набор состояний ячейки. */
    static final List<String> STATES = List.of("checked", "unavailable", "forbidden");

    static final String FORGEJO_NO_LINK = "нет связи с пользователем Forgejo";
    static final String KC_NO_USER = "нет пользователя в Keycloak";
    private static final java.util.regex.Pattern KC_ID = java.util.regex.Pattern.compile("[A-Za-z0-9-]{1,64}");

    /** Ответ KC на {@code /users/{id}/role-mappings/realm} по одному человеку. */
    record KcLookup(int status, List<String> roles) {}

    /** Опрос Keycloak: либо ответы по людям, либо причина, почему спросить не удалось. */
    record KcResult(String failure, Map<String, KcLookup> bySub) {
        static KcResult answered(Map<String, KcLookup> bySub) { return new KcResult(null, bySub); }
        static KcResult failed(String reason) { return new KcResult(reason, Map.of()); }
    }

    /** Сопоставление по kc_sub — то же, что сверяет /lore/kc/user-orphans. */
    static List<String> kcSubs(Map<String, Object> body) {
        List<String> out = new ArrayList<>();
        if (body.get("rows") instanceof List<?> rows)
            for (Object o : rows)
                if (o instanceof Map<?, ?> m && m.get("kc_sub") != null && !String.valueOf(m.get("kc_sub")).isBlank())
                    out.add(String.valueOf(m.get("kc_sub")));
        return out;
    }

    /**
     * Опросить KC по людям матрицы. Блокирующий — звать с рабочего пула. Любой сбой
     * становится причиной в ответе, а не исключением: матрица графа отдаётся всё равно.
     */
    static KcResult askKc(KcBridge bridge, List<String> subs) {
        if (bridge == null || !bridge.configured()) return KcResult.failed("Keycloak не настроен");
        try {
            String token = bridge.adminToken();
            Map<String, KcLookup> by = new LinkedHashMap<>();
            for (String sub : subs) {
                // id пользователя KC — UUID; иное в путь admin API не подставляем.
                if (!KC_ID.matcher(sub).matches()) { by.put(sub, new KcLookup(400, List.of())); continue; }
                java.net.http.HttpResponse<String> r = bridge.kc("GET", "/users/" + sub + "/role-mappings/realm", null, token);
                List<String> names = new ArrayList<>();
                if (r.statusCode() == 200) {
                    io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(r.body());
                    for (int i = 0; i < arr.size(); i++) names.add(arr.getJsonObject(i).getString("name"));
                }
                by.put(sub, new KcLookup(r.statusCode(), names));
            }
            return KcResult.answered(by);
        } catch (Exception e) {
            return KcResult.failed("Keycloak не ответил: " + e.getMessage());
        }
    }

    /** Без опроса KC (null) — ячеек kc нет, и kc нет в sources_asked. */
    static void fold(Map<String, Object> body) { fold(body, null); }

    @SuppressWarnings("unchecked")
    static void fold(Map<String, Object> body, KcResult kc) {
        // Kit 09.11: «не спрашивали» ≠ «спросили, роли нет». Какие источники опрошены — в теле.
        // Forgejo не опрашивается (нет связи с пользователем) — в списке его нет.
        body.put("sources_asked", kc == null ? List.of("graph") : List.of("graph", "kc"));
        if (!(body.get("rows") instanceof List<?> rows)) return;
        for (Object o : rows) {
            if (!(o instanceof Map<?, ?> raw)) continue;
            Map<String, Object> row = (Map<String, Object>) raw;
            List<?> projects = row.get("projects") instanceof List<?> l ? l : List.of();
            List<?> roles = row.get("roles") instanceof List<?> l ? l : List.of();
            List<Map<String, Object>> cells = new ArrayList<>();
            for (int i = 0; i < projects.size(); i++) {
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("project", String.valueOf(projects.get(i)));
                c.put("role", i < roles.size() && roles.get(i) != null ? String.valueOf(roles.get(i)) : null);
                c.put("state", "checked");
                c.put("source", "graph");
                cells.add(c);
            }
            if (kc != null) cells.add(kcCell(kc, row.get("kc_sub") == null ? null : String.valueOf(row.get("kc_sub"))));
            cells.add(rowCell("forgejo", "unavailable", null, null, FORGEJO_NO_LINK));
            row.put("cells", cells);
            row.put("state", "checked");
        }
    }

    static Map<String, Object> kcCell(KcResult kc, String sub) {
        if (kc.failure() != null) return rowCell("kc", "unavailable", null, null, kc.failure());
        KcLookup l = sub == null ? null : kc.bySub().get(sub);
        if (l == null) return rowCell("kc", "unavailable", null, null, "Keycloak по этому человеку не спрашивали");
        if (l.status() == 404) return rowCell("kc", "checked", null, null, KC_NO_USER);
        if (l.status() != 200) return rowCell("kc", "unavailable", null, null, "Keycloak ответил " + l.status());
        List<String> own = l.roles().stream()
            .filter(r -> r != null && !KcBridge.isKeycloakServiceRole(r)).sorted().toList();
        return rowCell("kc", "checked", own.isEmpty() ? null : String.join(", ", own), own, null);
    }

    private static Map<String, Object> rowCell(String source, String state, String role, List<String> roles, String reason) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("project", "*");
        c.put("role", role);
        if (roles != null) c.put("roles", roles);
        c.put("state", state);
        c.put("source", source);
        if (reason != null) c.put("reason", reason);
        return c;
    }
}
