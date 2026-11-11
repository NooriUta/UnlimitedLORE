package studio.seer.heimdall.lore;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-03 — опасные действия Keycloak тем же путём, что
 * роли проектов (LoreRoleBatch): дифф → подтверждение → применение → «Отменить»
 * в окне → журнал AO-01. Чистая часть: Keycloak в CI нет, и вся логика решений
 * проверяется здесь, без живого KC.
 *
 * <p><b>Realm-роль обратима.</b> Отмена — обратный вызов того же эндпоинта
 * ({@code undo}), в окне {@link LoreRoleBatch#UNDO_WINDOW}; время зашито в id
 * операции ({@code kr-<millis>-<hex8>}), окно проверяется без хранилища.
 * Префикс свой, не {@code rb-}: журнал раскрывает пачки {@code rb-} по
 * событиям AL-102, а у операции KC таких событий нет.
 *
 * <p><b>Ротация секрета НЕ обратима, и это не недоделка.</b>
 * {@code POST /clients/{id}/client-secret} выпускает новый секрет, и прежний
 * Keycloak сразу считает недействительным. Вернуть его можно было бы только
 * записав старое значение обратно ({@code PUT /clients/{id}} с полем secret) —
 * а для этого его пришлось бы прочитать и держать у себя, что запрещено: секрет
 * показывается один раз и никуда не пишется. Поэтому «отмена ротации» честно
 * отвечает «нельзя, можно только выпустить новый».
 */
final class KcDanger {

    private KcDanger() {}

    // S7B-19: «сразу» — только без политики secret-rotation в KC; с ней прежний секрет живёт до
    // срока или до отзыва (KcSecretRotation). Вернуть его текущим нельзя в обоих случаях.
    static final String UNDO_IMPOSSIBLE =
        "Новый секрет нельзя «вернуть» на прежний: LORE прежний секрет не читает и не хранит. Без политики "
        + "secret-rotation в Keycloak прежний секрет перестаёт работать сразу; с ней — действует до срока или до отзыва. "
        + "Отменить ротацию нельзя, можно только выпустить новый секрет.";

    private static final Map<String, Object> CHECKED = Map.of("state", "checked", "source", "keycloak");

    private static Map<String, Object> unavailable(String why) {
        return Map.of("state", "unavailable", "source", why);
    }

    // ── realm-роль ─────────────────────────────────────────────────────────

    /**
     * Дифф одной realm-роли человека.
     *
     * @param mappingsJson ответ {@code /users/{id}/role-mappings/realm} (массив) или
     *                     null — не прочитали; тогда «было» неизвестно, и строка
     *                     «не проверено», а не «добавится».
     */
    static Map<String, Object> realmRolePlan(String role, boolean remove, String mappingsJson) {
        Boolean before = holds(mappingsJson, role);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("role", role);
        m.put("before", before);
        m.put("after", !remove);
        String kind;
        if (before == null) kind = remove ? "remove" : "grant";
        else if (remove) kind = before ? "remove" : "unchanged";
        else kind = before ? "unchanged" : "grant";
        m.put("kind", kind);
        m.put("sign", switch (kind) { case "grant" -> "+"; case "remove" -> "−"; default -> "="; });
        m.put("check", before == null ? unavailable("текущие realm-роли человека не прочитались из Keycloak") : CHECKED);
        return m;
    }

    /** Есть ли роль среди назначений; null — ответ не разобрать. */
    private static Boolean holds(String mappingsJson, String role) {
        if (mappingsJson == null) return null;
        try {
            io.vertx.core.json.JsonArray arr = new io.vertx.core.json.JsonArray(mappingsJson);
            for (int i = 0; i < arr.size(); i++) {
                Object o = arr.getValue(i);
                if (o instanceof io.vertx.core.json.JsonObject j && role.equals(j.getString("name"))) return true;
            }
            return false;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Обратный вызов: снять выданное, вернуть снятое; ничего не менялось — null. */
    static Map<String, Object> realmRoleUndo(Map<String, Object> plan) {
        Object kind = plan.get("kind");
        if ("grant".equals(kind)) return Map.of("role", plan.get("role"), "action", "remove");
        if ("remove".equals(kind)) return Map.of("role", plan.get("role"), "action", "add");
        return null;
    }

    private static final Pattern OP_ID = Pattern.compile("^kr-([0-9]{13})-[0-9a-f]{8}$");

    static String opId(Instant at) {
        return "kr-" + String.format("%013d", at.toEpochMilli()) + "-"
            + String.format("%08x", java.util.concurrent.ThreadLocalRandom.current().nextInt());
    }

    static boolean isOpId(String s) {
        return s != null && OP_ID.matcher(s).matches();
    }

    static Instant undoUntil(String opId) {
        Matcher m = opId == null ? null : OP_ID.matcher(opId);
        if (m == null || !m.matches()) return null;
        return Instant.ofEpochMilli(Long.parseLong(m.group(1))).plus(LoreRoleBatch.UNDO_WINDOW);
    }

    /** Причина отказа в отмене или null. */
    static String undoError(String opId, Instant now) {
        Instant until = undoUntil(opId);
        if (until == null) return "undo_of: не идентификатор операции Keycloak (" + opId + ")";
        if (now.isAfter(until)) return "undo_of: окно отмены операции " + opId + " закрыто в " + until;
        return null;
    }

    /**
     * Ответ применения. Первое *_id поле — {@code user_id}: журнал AO-01 пишет его
     * сущностью записи, и «кому выдали admin» видно в журнале.
     */
    static Map<String, Object> realmRoleAnswer(String userId, String opId, Map<String, Object> plan) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("user_id", userId);
        m.put("op_id", opId);
        m.put("ok", true);
        m.put("role", plan.get("role"));
        m.put("action", Boolean.TRUE.equals(plan.get("after")) ? "added" : "removed");
        m.put("kind", plan.get("kind"));
        m.put("undo", realmRoleUndo(plan));
        Instant until = undoUntil(opId);
        m.put("undo_until", until == null ? null : String.valueOf(until));
        return m;
    }

    // ── ротация секрета ───────────────────────────────────────────────────

    /** Дифф ротации по представлению клиента ({@code GET /clients/{uuid}}). */
    static Map<String, Object> rotationPlan(String clientJson) {
        String clientId = null, id = null;
        try {
            io.vertx.core.json.JsonObject c = new io.vertx.core.json.JsonObject(clientJson);
            clientId = c.getString("clientId");
            id = c.getString("id");
        } catch (RuntimeException e) { /* не разобрали — «не проверено» ниже */ }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", clientId);
        m.put("id", id);
        m.put("kind", "rotate");
        m.put("sign", "~");
        m.put("check", clientId == null || id == null ? unavailable("клиент Keycloak не прочитался") : CHECKED);
        m.put("undoable", false);
        m.put("undo_reason", UNDO_IMPOSSIBLE);
        return m;
    }

    /**
     * Ответ ротации. Секрет — здесь и только здесь, один раз; первое *_id поле —
     * {@code client_id}, журнал пишет клиента, не секрет. Значения в ответе KC нет —
     * null: «успех с пустым секретом» хуже отказа.
     */
    static Map<String, Object> rotationAnswer(String clientId, String kcSecretBody) {
        String secret;
        try {
            secret = new io.vertx.core.json.JsonObject(kcSecretBody).getString("value");
        } catch (RuntimeException e) {
            return null;
        }
        if (secret == null || secret.isBlank()) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", clientId);
        m.put("ok", true);
        m.put("rotated", true);
        m.put("secret", secret);
        m.put("undoable", false);
        m.put("undo_reason", UNDO_IMPOSSIBLE);
        return m;
    }

    private static final Pattern UUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    /** Внутренний id клиента KC (uuid) или clientId — по форме. */
    static boolean isUuid(String s) {
        return s != null && UUID.matcher(s).matches();
    }
}
