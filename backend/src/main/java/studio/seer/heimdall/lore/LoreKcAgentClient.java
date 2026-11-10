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
    /** Заглушка до правки (находка kit к #1077). */
    static JsonObject jsonOrNull(String body) {
        return new JsonObject(body == null || body.isBlank() ? "{}" : "{}");
    }

    static String idOf(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            return new JsonObject(body).getString("id");
        } catch (RuntimeException e) {
            return null;
        }
    }
}
