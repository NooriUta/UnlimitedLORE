package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.List;
import java.util.regex.Pattern;

/**
 * S7A-12, серверная просьба A (UC-ADMIN-NEW-MACHINE): учётка агента в Keycloak из админки.
 * Владелица: «я хочу, чтобы я не бегала между тремя интерфейсами» — консоль KC перестаёт быть
 * обязательным шагом. Клиент создаётся по шаблону профиля {@code lore-mcp-<profile>}: настройки,
 * мапперы и realm-роли сервисного аккаунта — оттуда, имя — {@code lore-mcp-<profile>_<machine>}.
 * Секрет KC выдаёт сам и отдаётся ответом ровно один раз; сервер его не хранит и не логирует.
 */
final class LoreKcAgentClient {

    private LoreKcAgentClient() {}

    private static final Pattern PART = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");

    /** Поля представления клиента, которые НЕ переносятся из шаблона: личность и секрет. */
    private static final List<String> NOT_COPIED = List.of("id", "secret", "registeredNodes", "clientId", "name",
        "baseUrl", "rootUrl", "adminUrl");

    static String templateId(String profile) {
        if (profile == null || !PART.matcher(profile).matches())
            throw new IllegalArgumentException("profile: только латиница, цифры, . _ - (получено: " + profile + ")");
        return "lore-mcp-" + profile;
    }

    static String clientId(String profile, String machine) {
        String base = templateId(profile);
        if (machine == null || !PART.matcher(machine).matches())
            throw new IllegalArgumentException("machine: только латиница, цифры, . _ - (получено: " + machine + ")");
        return base + "_" + machine;
    }

    /** Представление нового клиента из шаблона: без id/секрета шаблона, включён. Шаблон не меняется. */
    static JsonObject fromTemplate(JsonObject template, String newClientId) {
        JsonObject c = template.copy();
        for (String k : NOT_COPIED) c.remove(k);
        c.put("clientId", newClientId);
        c.put("name", newClientId);
        c.put("enabled", true);
        JsonArray mappers = c.getJsonArray("protocolMappers");
        if (mappers != null) {
            JsonArray clean = new JsonArray();
            for (int i = 0; i < mappers.size(); i++) {
                JsonObject m = mappers.getJsonObject(i).copy();
                m.remove("id");
                clean.add(m);
            }
            c.put("protocolMappers", clean);
        }
        return c;
    }

    /** 401/403 от KC — назвать, чего не хватает lore-admin, а не отдать сырое «forbidden». */
    static String forbiddenHint(int status) {
        if (status != 401 && status != 403) return null;
        return "Keycloak отказал клиенту lore-admin (HTTP " + status + "): нужна роль realm-management/manage-clients"
            + " у его сервисного аккаунта — выдаётся в консоли KC (Clients → lore-admin → Service account roles)."
            + " LORE эту роль сам себе не выдаёт.";
    }

    /**
     * Ревью 10.11, B8: клиентские роли сервисной учётки шаблона ({@code clientMappings} ответа
     * {@code /users/{id}/role-mappings}) — по uuid клиента-владельца роли. Роль agent-&lt;profile&gt;
     * выдаётся именно так (kc-provision-agents.js), и без неё машинная учётка получала пустой
     * agent_scope. Служебные роли самого KC (realm-management, account, broker) не копируются —
     * то же правило, что у realm-ролей.
     */
    static java.util.Map<String, io.vertx.core.json.JsonArray> clientRoleGrants(JsonObject roleMappings) {
        java.util.Map<String, io.vertx.core.json.JsonArray> out = new java.util.LinkedHashMap<>();
        JsonObject cm = roleMappings == null ? null : roleMappings.getJsonObject("clientMappings");
        if (cm == null) return out;
        for (String name : cm.fieldNames()) {
            if (KC_SERVICE_CLIENTS.contains(name)) continue;
            JsonObject c = cm.getJsonObject(name);
            String uuid = c == null ? null : c.getString("id");
            io.vertx.core.json.JsonArray roles = c == null ? null : c.getJsonArray("mappings");
            if (uuid == null || roles == null || roles.isEmpty()) continue;
            out.put(uuid, roles);
        }
        return out;
    }

    /** Встроенные клиенты Keycloak — их роли служебные, агенту не копируются. */
    static final java.util.Set<String> KC_SERVICE_CLIENTS = java.util.Set.of(
        "realm-management", "account", "account-console", "broker", "admin-cli", "security-admin-console");

    /**
     * Ревью 10.11, B10: {@code id} из тела ответа KC; битое тело (пустое, HTML от прокси) — {@code null},
     * а не исключение, которое роняло весь список агентов одним ответом.
     */
    /**
     * Находка kit к #1077: JSON-объект из тела ответа KC; битое тело (пустое, HTML от прокси) — null,
     * чтобы вызывающий записал оговорку, а не упал 500 на всей операции. Тот же приём, что {@link #idOf}.
     */
    static JsonObject jsonOrNull(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            return new JsonObject(body);
        } catch (RuntimeException e) {
            return null;
        }
    }

    static String idOf(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            return new JsonObject(body).getString("id");
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD шаг 4: что в токене свежей учётки агента.
     * state: ok (agent_scope = ожидаемый профиль) | mismatch | missing (клейма нет) |
     * error (токен не разобран). Нормализация та же, что у AgentScopeFilter: элементы
     * массива снимаются с кавычек, префикс agent- срезается. Сам токен в ответ не попадает.
     */
    static java.util.Map<String, Object> tokenCheck(String accessToken, String expectedProfile) {
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("expected", expectedProfile);
        try {
            String[] parts = accessToken == null ? new String[0] : accessToken.split(java.util.regex.Pattern.quote("."));
            if (parts.length < 2) throw new IllegalArgumentException("не JWT");
            JsonObject claims = new JsonObject(new String(java.util.Base64.getUrlDecoder().decode(parts[1]),
                java.nio.charset.StandardCharsets.UTF_8));
            Object raw = claims.getValue("agent_scope");
            java.util.Set<String> profiles = new java.util.LinkedHashSet<>();
            if (raw instanceof JsonArray a) { for (Object o : a) addScope(profiles, o); }
            else if (raw != null) addScope(profiles, raw);
            if (profiles.isEmpty()) { out.put("state", "missing"); out.put("agent_scope", null); return out; }
            String got = String.join(",", profiles);
            out.put("agent_scope", got);
            out.put("state", profiles.size() == 1 && profiles.contains(expectedProfile) ? "ok" : "mismatch");
        } catch (RuntimeException e) {
            out.put("state", "error");
            out.put("reason", "токен не разобран: " + e.getClass().getSimpleName());
        }
        return out;
    }

    private static void addScope(java.util.Set<String> out, Object v) {
        String s = String.valueOf(v).replace("\"", "").trim();
        if (s.isEmpty()) return;
        out.add(s.startsWith("agent-") ? s.substring("agent-".length()) : s);
    }
}
