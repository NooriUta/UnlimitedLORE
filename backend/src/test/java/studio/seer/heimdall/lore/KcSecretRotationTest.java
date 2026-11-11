package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-19 — UC-6 «смена секрета агента без простоя».
 *
 * <p>Keycloak 26.x держит у клиента два секрета, когда включена функция
 * {@code client-secret-rotation} (в 26.x — preview, по умолчанию выключена) и к
 * клиенту применяется политика с исполнителем {@code secret-rotation}: при
 * {@code POST /clients/{id}/client-secret} прежний секрет становится «rotated»
 * (атрибуты {@code client.secret.rotated*}) и действует до своего срока или до
 * {@code DELETE /clients/{id}/client-secret/rotated}. Без функции/политики KC
 * удаляет прежний сразу — это и есть простой.
 *
 * <p>Секреты не читаются: представление клиента несёт их значения
 * ({@code secret}, атрибут {@code client.secret.rotated}), и ни одно не должно
 * попасть в ответ LORE — только время и факт.
 */
class KcSecretRotationTest {

    /** Секунды эпохи: 2026-11-11T20:00:00Z. */
    private static final long T0 = 1794427200L;
    /** Часы теста: через час после ротации — прежний секрет ещё в сроке. */
    private static final java.time.Instant NOW = java.time.Instant.ofEpochSecond(T0 + 3600);

    private static String client(Map<String, String> attrs) {
        JsonObject a = new JsonObject();
        attrs.forEach(a::put);
        return JsonObject.of("id", "c-uuid", "clientId", "lore-mcp-full_nb", "enabled", true,
            "secret", "NEW-SECRET-VALUE", "attributes", a).encode();
    }

    private static final String DUAL = client(Map.of(
        "client.secret.creation.time", String.valueOf(T0),
        "client.secret.expiration.time", String.valueOf(T0 + 29 * 86400),
        "client.secret.rotated", "OLD-SECRET-VALUE",
        "client.secret.rotated.creation.time", String.valueOf(T0),
        "client.secret.rotated.expiration.time", String.valueOf(T0 + 2 * 86400)));

    private static final String SINGLE = client(Map.of());

    // ── состояние секретов клиента ───────────────────────────────────────

    @Test
    void dualStateIsSeenFromAttributesWithoutSecretValues() {
        Map<String, Object> s = KcSecretRotation.secretState(DUAL, NOW);
        assertEquals("lore-mcp-full_nb", s.get("client_id"));
        assertEquals(true, s.get("old_secret_active"));
        assertEquals("2026-11-11T20:00:00Z", s.get("rotated_at"));
        assertEquals("2026-11-13T20:00:00Z", s.get("old_secret_expires_at"));
        assertEquals(true, s.get("rotation_policy"));
        String encoded = new JsonObject(new java.util.HashMap<>(s)).encode();
        assertFalse(encoded.contains("OLD-SECRET-VALUE"), "значение прежнего секрета не уходит наружу");
        assertFalse(encoded.contains("NEW-SECRET-VALUE"), "значение текущего секрета не уходит наружу");
    }

    @Test
    void singleSecretClientHasNoOldSecretAndNoPolicy() {
        Map<String, Object> s = KcSecretRotation.secretState(SINGLE, NOW);
        assertEquals(false, s.get("old_secret_active"));
        assertEquals(false, s.get("rotation_policy"));
        assertNull(s.get("rotated_at"));
    }

    @Test
    void unreadableClientIsUnknownNotFalse() {
        Map<String, Object> s = KcSecretRotation.secretState("<html>bad gateway</html>", NOW);
        assertNull(s.get("old_secret_active"));
        assertEquals("unavailable", ((Map<?, ?>) s.get("check")).get("state"));
    }

    // ── «перешёл?» ───────────────────────────────────────────────────────

    private static Map<String, Object> session(String sid, String machine, String started) {
        return Map.of("session_id", sid, "machine_id", machine, "started_at", started, "last_activity_at", started);
    }

    @Test
    void sessionStartedAfterRotationMeansSwitched() {
        Map<String, Object> sw = KcSecretRotation.switched(List.of(
            session("s-old", "nb", "2026-11-11T19:00:00Z"),
            session("s-new", "nb", "2026-11-11T20:05:00Z")), "2026-11-11T20:00:00Z");
        assertEquals(true, sw.get("seen"));
        assertEquals("s-new", sw.get("session_id"));
        assertEquals("nb", sw.get("machine_id"));
        assertEquals("2026-11-11T20:05:00Z", sw.get("at"));
    }

    /** Старая сессия, которая просто продолжает работать, — не переход: её токен мог быть получен старым секретом. */
    @Test
    void oldSessionStillActiveIsNotSwitched() {
        Map<String, Object> old = new java.util.HashMap<>(session("s-old", "nb", "2026-11-11T19:00:00Z"));
        old.put("last_activity_at", "2026-11-11T20:30:00Z");
        Map<String, Object> sw = KcSecretRotation.switched(List.of(old), "2026-11-11T20:00:00Z");
        assertEquals(false, sw.get("seen"));
    }

    @Test
    void noRotationMomentMeansNothingToWaitFor() {
        assertEquals(false, KcSecretRotation.switched(List.of(session("s", "nb", "2026-11-11T20:05:00Z")), null).get("seen"));
    }

    // ── отзыв прежнего секрета ───────────────────────────────────────────

    @Test
    void revokeAllowedOnlyAfterACallWithTheNewSecret() {
        Map<String, Object> state = KcSecretRotation.secretState(DUAL, NOW);
        Map<String, Object> waiting = KcSecretRotation.switched(List.of(), "2026-11-11T20:00:00Z");
        Map<String, Object> plan = KcSecretRotation.revokePlan(state, waiting);
        assertEquals("forbidden", ((Map<?, ?>) plan.get("check")).get("state"));
        assertNotNull(KcSecretRotation.revokeRefusal(plan));

        Map<String, Object> seen = KcSecretRotation.switched(
            List.of(session("s-new", "nb", "2026-11-11T20:05:00Z")), "2026-11-11T20:00:00Z");
        Map<String, Object> ok = KcSecretRotation.revokePlan(state, seen);
        assertEquals("checked", ((Map<?, ?>) ok.get("check")).get("state"));
        assertEquals("revoke-old", ok.get("kind"));
        assertNull(KcSecretRotation.revokeRefusal(ok));
    }

    @Test
    void nothingToRevokeWhenThereIsNoOldSecret() {
        Map<String, Object> plan = KcSecretRotation.revokePlan(KcSecretRotation.secretState(SINGLE, NOW),
            KcSecretRotation.switched(List.of(), null));
        assertEquals("unchanged", plan.get("kind"));
        assertNotNull(KcSecretRotation.revokeRefusal(plan));
    }

    // ── итог ротации ─────────────────────────────────────────────────────

    @Test
    void rotationOutcomeSaysWhetherTheOldSecretSurvived() {
        Map<String, Object> kept = KcSecretRotation.rotationOutcome(DUAL, NOW);
        assertEquals(true, kept.get("old_secret_kept"));
        assertEquals("2026-11-13T20:00:00Z", kept.get("old_secret_expires_at"));
        Map<String, Object> lost = KcSecretRotation.rotationOutcome(SINGLE, NOW);
        assertEquals(false, lost.get("old_secret_kept"));
        assertTrue(String.valueOf(lost.get("old_secret_note")).contains("client-secret-rotation"));
        assertNull(KcSecretRotation.rotationOutcome(null, NOW).get("old_secret_kept"), "не перечитали — не знаем");
    }

    /** Дифф ротации заранее говорит, ждать ли простоя: политика видна — старый останется, нет — умрёт сразу. */
    @Test
    void rotationExpectationBeforeApplying() {
        assertEquals("kept", KcSecretRotation.oldSecretExpectation(KcSecretRotation.secretState(DUAL, NOW)));
        assertEquals("unknown", KcSecretRotation.oldSecretExpectation(KcSecretRotation.secretState(SINGLE, NOW)));
    }
}
