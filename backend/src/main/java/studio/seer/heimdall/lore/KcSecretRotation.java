package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-19 — UC-6 «смена секрета агента без простоя»,
 * чистая часть: два секрета у клиента KC, «перешёл?» и отзыв прежнего.
 *
 * <p><b>Что умеет Keycloak (сверено с исходниками тега 26.6.2):</b> функция
 * {@code CLIENT_SECRET_ROTATION} — {@code Type.PREVIEW}, то есть выключена, пока
 * KC не запущен с {@code --features=client-secret-rotation}. Когда она включена
 * и к клиенту применяется клиентская политика с исполнителем
 * {@code secret-rotation} ({@code rotated-expiration-period} &gt; 0), вызов
 * {@code POST /clients/{id}/client-secret} оставляет прежний секрет «rotated»:
 * атрибуты {@code client.secret.rotated.creation.time} и
 * {@code client.secret.rotated.expiration.time}, а
 * {@code ClientIdAndSecretAuthenticator} принимает оба. Прежний отзывают
 * {@code DELETE /clients/{id}/client-secret/rotated}. Без функции/политики
 * {@code regenerateSecret} стирает сведения о ротации, и прежний секрет умирает
 * сразу — простой до перенастройки агента.
 *
 * <p><b>Значения секретов не читаются и не отдаются.</b> Представление клиента
 * несёт {@code secret} и атрибут {@code client.secret.rotated} — отсюда берутся
 * только время и факт.
 *
 * <p><b>«Перешёл?» — гипотеза-признак, а не доказательство.</b> Токен агента не
 * говорит, каким из двух секретов он получен. Признак — СЕССИЯ агента
 * ({@code KnowAgentSession}, ADR-LORE-037), НАЧАТАЯ после ротации: процесс MCP
 * перезапущен уже после выдачи нового секрета, значит, скорее всего, с ним.
 * Старая сессия, которая просто продолжает работать, переходом не считается.
 */
final class KcSecretRotation {

    private KcSecretRotation() {}

    static final String ATTR_ROTATED_CREATED = "client.secret.rotated.creation.time";
    static final String ATTR_ROTATED_EXPIRES = "client.secret.rotated.expiration.time";
    static final String ATTR_EXPIRES = "client.secret.expiration.time";

    static final String NO_DUAL_NOTE = "Keycloak не оставил прежний секрет: у клиента нет политики secret-rotation "
        + "или KC запущен без --features=client-secret-rotation. Прежний секрет уже недействителен — агент работает "
        + "только после того, как получит новый.";

    private static final Map<String, Object> CHECKED = Map.of("state", "checked", "source", "keycloak");

    private static JsonObject objOrNull(String json) {
        if (json == null) return null;
        try { return new JsonObject(json); } catch (RuntimeException e) { return null; }
    }

    /** Атрибут KC — секунды эпохи строкой; не число — null. */
    private static String isoOf(JsonObject attrs, String key) {
        if (attrs == null) return null;
        Object v = attrs.getValue(key);
        if (v == null) return null;
        try {
            return Instant.ofEpochSecond(Long.parseLong(String.valueOf(v).trim())).toString();
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Состояние секретов клиента по {@code GET /clients/{uuid}}.
     * {@code old_secret_active}: true — прежний секрет ещё принимается; false — нет;
     * null — клиент не прочитался. {@code rotation_policy}: к клиенту применялась
     * политика ротации (у текущего секрета есть срок) — признак, что следующая
     * ротация оставит прежний.
     */
    static Map<String, Object> secretState(String clientJson, Instant now) {
        JsonObject c = objOrNull(clientJson);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", c == null ? null : c.getString("clientId"));
        m.put("id", c == null ? null : c.getString("id"));
        if (c == null) {
            m.put("old_secret_active", null);
            m.put("rotated_at", null);
            m.put("old_secret_expires_at", null);
            m.put("rotation_policy", null);
            m.put("check", Map.of("state", "unavailable", "source", "клиент Keycloak не прочитался"));
            return m;
        }
        JsonObject attrs = c.getJsonObject("attributes");
        String rotatedAt = isoOf(attrs, ATTR_ROTATED_CREATED);
        String expiresAt = isoOf(attrs, ATTR_ROTATED_EXPIRES);
        boolean active = rotatedAt != null && (expiresAt == null || Instant.parse(expiresAt).isAfter(now));
        m.put("old_secret_active", active);
        m.put("rotated_at", rotatedAt);
        m.put("old_secret_expires_at", expiresAt);
        m.put("rotation_policy", isoOf(attrs, ATTR_EXPIRES) != null);
        m.put("check", CHECKED);
        return m;
    }

    private static Instant instantOrNull(Object v) {
        if (v == null) return null;
        try { return Instant.parse(String.valueOf(v)); } catch (DateTimeParseException e) { return null; }
    }

    /**
     * Первая сессия агента, НАЧАТАЯ не раньше ротации ({@code started_at >= rotatedAt}).
     * Тот же журнал, что у {@code firstCallOf} мастеров (agent_sessions), но по
     * началу сессии: активность старой сессии после ротации ничего не доказывает.
     */
    static Map<String, Object> switched(List<Map<String, Object>> sessions, String rotatedAt) {
        Map<String, Object> m = new LinkedHashMap<>();
        Instant since = instantOrNull(rotatedAt);
        if (since == null) {
            m.put("seen", false);
            m.put("reason", "ротации с двумя секретами не было — ждать нечего");
            return m;
        }
        Map<String, Object> best = null;
        Instant bestAt = null;
        for (Map<String, Object> s : sessions) {
            Instant st = instantOrNull(s.get("started_at"));
            if (st == null || st.isBefore(since)) continue;
            if (bestAt == null || st.isBefore(bestAt)) { best = s; bestAt = st; }
        }
        m.put("seen", best != null);
        m.put("since", since.toString());
        if (best != null) {
            m.put("at", bestAt.toString());
            m.put("session_id", best.get("session_id"));
            m.put("machine_id", best.get("machine_id"));
            m.put("how", "session");
        } else {
            m.put("reason", "после ротации агент ещё не начинал новой сессии — признака, что он взял новый секрет, нет");
        }
        return m;
    }

    /** Дифф отзыва прежнего секрета: «нельзя», пока нет вызова с новым. */
    static Map<String, Object> revokePlan(Map<String, Object> state, Map<String, Object> switched) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("client_id", state.get("client_id"));
        m.put("id", state.get("id"));
        m.put("old_secret_expires_at", state.get("old_secret_expires_at"));
        Object active = state.get("old_secret_active");
        if (!Boolean.TRUE.equals(active)) {
            m.put("kind", "unchanged");
            m.put("sign", "=");
            m.put("check", active == null ? state.get("check")
                : Map.of("state", "forbidden", "source", "прежнего секрета нет — отзывать нечего"));
            return m;
        }
        m.put("kind", "revoke-old");
        m.put("sign", "−");
        m.put("switched", switched);
        m.put("check", Boolean.TRUE.equals(switched.get("seen")) ? CHECKED
            : Map.of("state", "forbidden", "source", "прежний секрет отзывается только после вызова с новым: "
                + switched.getOrDefault("reason", "перехода не видно")));
        return m;
    }

    /** Почему отзывать нельзя, или null. */
    static String revokeRefusal(Map<String, Object> plan) {
        Object c = plan.get("check");
        if (!(c instanceof Map<?, ?> check)) return "дифф без проверки";
        if ("checked".equals(check.get("state")) && "revoke-old".equals(plan.get("kind"))) return null;
        return String.valueOf(check.get("source"));
    }

    /**
     * Итог ротации по клиенту, перечитанному ПОСЛЕ неё. null — не перечитали:
     * «сохранился ли прежний» неизвестно, и так и сказано.
     */
    static Map<String, Object> rotationOutcome(String clientJsonAfter, Instant now) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> s = clientJsonAfter == null ? null : secretState(clientJsonAfter, now);
        Object active = s == null ? null : s.get("old_secret_active");
        m.put("old_secret_kept", active);
        m.put("rotated_at", s == null ? null : s.get("rotated_at"));
        m.put("old_secret_expires_at", s == null ? null : s.get("old_secret_expires_at"));
        m.put("old_secret_note", active == null
            ? "клиент после ротации не перечитался — сохранился ли прежний секрет, неизвестно"
            : Boolean.TRUE.equals(active)
                ? "прежний секрет действует до " + s.get("old_secret_expires_at") + " или до отзыва после перехода агента"
                : NO_DUAL_NOTE);
        return m;
    }

    /**
     * Чего ждать ДО ротации: {@code kept} — политика ротации к клиенту применялась,
     * прежний секрет останется; {@code unknown} — признаков политики нет, прежний,
     * скорее всего, умрёт сразу (если функция KC выключена — точно).
     */
    static String oldSecretExpectation(Map<String, Object> state) {
        return Boolean.TRUE.equals(state.get("rotation_policy")) ? "kept" : "unknown";
    }
}
