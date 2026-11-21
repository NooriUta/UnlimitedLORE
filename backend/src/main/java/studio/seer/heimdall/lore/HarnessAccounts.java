package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.Function;

/**
 * SPRINT_LORE_OWN_HOST/OH-MCP-HOSTED-SWITCH (1.18.2) — «гирлянда»: учётки MCP одного harness деревом ролей
 * по порядку модели ({@code agent_profiles}). У каждого узла: имя клиента KC и ключ секрета по схеме, можно ли
 * выпустить (отказ — теми же словами, что 409 выпуска), и что в Keycloak: выпущена / нет / не смогли проверить.
 *
 * <p>Честные состояния: KC не настроен или недоступен — у каждого узла {@code account.state = unknown} с
 * причиной, а не «absent». Значений секретов в срезе нет: из представления клиента берутся только время и факт.
 */
final class HarnessAccounts {

    private HarnessAccounts() {}

    static final String ATTR_SECRET_CREATED = "client.secret.creation.time";

    /** Итог поиска клиента KC по clientId. state: found | absent | failed. */
    record Lookup(String state, String clientJson, String reason) {
        static Lookup found(String json) { return new Lookup("found", json, null); }
        static Lookup absent() { return new Lookup("absent", null, null); }
        static Lookup failed(String reason) { return new Lookup("failed", null, reason); }
    }

    /** Что известно о Keycloak целиком. state: checked | not_configured | unavailable. */
    record KcView(String state, String reason, Function<String, Lookup> lookup) {
        static KcView checked(Function<String, Lookup> lookup) { return new KcView("checked", null, lookup); }
        static KcView notConfigured(String reason) { return new KcView("not_configured", reason, null); }
        static KcView unavailable(String reason) { return new KcView("unavailable", reason, null); }
    }

    /**
     * Срез; null — harness в модели нет. {@code switched(clientId, rotatedAt)} — «перешёл?»
     * ({@link KcSecretRotation#switched}).
     */
    static Map<String, Object> build(LoreModelAgentProfiles.AgentProfiles m, String harness, KcView kc,
                                     BiFunction<String, String, Map<String, Object>> switched, Instant now) {
        LoreModelAgentProfiles.Harness h = LoreModelAgentProfiles.harness(m, harness);
        if (h == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("harness", harness);
        out.put("main", h.main());
        out.put("suffix", h.suffix());
        Map<String, Object> kcOut = new LinkedHashMap<>();
        kcOut.put("state", kc.state());
        if (kc.reason() != null) kcOut.put("reason", kc.reason());
        out.put("kc", kcOut);
        Map<String, Integer> levels = new HashMap<>();
        List<Map<String, Object>> nodes = new ArrayList<>();
        for (LoreModelAgentProfiles.Profile p : m.profiles()) {
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("role", p.code());
            n.put("rank", p.rank());
            n.put("level", level(m, p.code(), levels, 0));
            n.put("parents", p.parents());
            if (p.about() != null) n.put("about", p.about());
            n.put("is_main", p.code().equals(h.main()));
            String clientId = LoreModelAgentProfiles.clientId(m, p.code(), harness);
            n.put("client_id", clientId);
            n.put("secret_key", LoreModelAgentProfiles.secretKey(m, p.code(), harness));
            String refusal = LoreModelAgentProfiles.issueRefusal(m, p.code(), harness);
            n.put("issuable", refusal == null);
            n.put("refusal", refusal);
            n.put("account", account(kc, clientId, switched, now));
            nodes.add(n);
        }
        out.put("nodes", nodes);
        return out;
    }

    /** Длиннейший путь от корня по parents; цикл модель не пропускает (problems), глубина всё равно ограничена. */
    private static int level(LoreModelAgentProfiles.AgentProfiles m, String code, Map<String, Integer> memo, int depth) {
        Integer known = memo.get(code);
        if (known != null) return known;
        LoreModelAgentProfiles.Profile p = m.profile(code);
        int lv = 0;
        if (p != null && depth < 64)
            for (String par : p.parents()) lv = Math.max(lv, level(m, par, memo, depth + 1) + 1);
        memo.put(code, lv);
        return lv;
    }

    private static Map<String, Object> account(KcView kc, String clientId,
                                               BiFunction<String, String, Map<String, Object>> switched, Instant now) {
        Map<String, Object> a = new LinkedHashMap<>();
        if (!"checked".equals(kc.state())) {
            a.put("state", "unknown");
            a.put("reason", kc.reason());
            return a;
        }
        Lookup l;
        try { l = kc.lookup().apply(clientId); }
        catch (RuntimeException e) { l = Lookup.failed("Keycloak не ответил: " + e.getClass().getSimpleName()); }
        if ("absent".equals(l.state())) { a.put("state", "absent"); return a; }
        JsonObject c = "found".equals(l.state()) ? LoreKcAgentClient.jsonOrNull(l.clientJson()) : null;
        if (c == null) {
            a.put("state", "unknown");
            a.put("reason", l.reason() != null ? l.reason() : "ответ Keycloak не разобран");
            return a;
        }
        Map<String, Object> s = KcSecretRotation.secretState(l.clientJson(), now);
        a.put("state", "issued");
        a.put("id", c.getString("id"));
        a.put("enabled", c.getBoolean("enabled", false));
        a.put("secret_created_at", epochIso(c.getJsonObject("attributes"), ATTR_SECRET_CREATED));
        a.put("rotated_at", s.get("rotated_at"));
        a.put("old_secret_active", s.get("old_secret_active"));
        a.put("old_secret_expires_at", s.get("old_secret_expires_at"));
        Map<String, Object> sw;
        try { sw = switched.apply(clientId, (String) s.get("rotated_at")); }
        catch (RuntimeException e) {
            sw = new LinkedHashMap<>();
            sw.put("seen", null);
            sw.put("reason", "журнал сессий агента не прочитан: " + e.getClass().getSimpleName());
        }
        a.put("switched", sw);
        return a;
    }

    private static String epochIso(JsonObject attrs, String key) {
        if (attrs == null || attrs.getValue(key) == null) return null;
        try { return Instant.ofEpochSecond(Long.parseLong(String.valueOf(attrs.getValue(key)).trim())).toString(); }
        catch (NumberFormatException e) { return null; }
    }
}
