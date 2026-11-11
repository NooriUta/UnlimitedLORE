package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-03 — опасные действия Keycloak тем же путём, что роли
 * проектов: дифф (dry_run) → ввод подтверждения → применение → «Отменить» в окне →
 * запись в журнале AO-01. Keycloak в CI нет — вся логика здесь чистыми функциями.
 *
 * <p>Выдача realm-роли обратима: отмена — обратный вызов в окне 15 минут, id
 * операции несёт время. Ротация секрета НЕ обратима: Keycloak делает старый секрет
 * недействительным сразу, а LORE старый секрет не читает и не хранит — значит
 * «отменить» честно отвечает «нельзя, можно только выпустить новый».
 */
class KcDangerTest {

    private static final String MAPPINGS = "[{\"id\":\"r1\",\"name\":\"viewer\"},{\"id\":\"r2\",\"name\":\"default-roles-omilore\"}]";

    // ── realm-роль: дифф ──────────────────────────────────────────────────

    @Test
    void grantOfMissingRoleIsPlus() {
        Map<String, Object> p = KcDanger.realmRolePlan("admin", false, MAPPINGS);
        assertEquals("admin", p.get("role"));
        assertEquals("grant", p.get("kind"));
        assertEquals("+", p.get("sign"));
        assertEquals(false, p.get("before"));
        assertEquals(true, p.get("after"));
        assertEquals(Map.of("state", "checked", "source", "keycloak"), p.get("check"));
    }

    @Test
    void grantOfHeldRoleIsUnchanged() {
        Map<String, Object> p = KcDanger.realmRolePlan("viewer", false, MAPPINGS);
        assertEquals("unchanged", p.get("kind"));
        assertEquals("=", p.get("sign"));
    }

    @Test
    void removeOfHeldRoleIsMinus() {
        Map<String, Object> p = KcDanger.realmRolePlan("viewer", true, MAPPINGS);
        assertEquals("remove", p.get("kind"));
        assertEquals("−", p.get("sign"));
        assertEquals(true, p.get("before"));
        assertEquals(false, p.get("after"));
    }

    @Test
    void removeOfMissingRoleIsUnchanged() {
        assertEquals("unchanged", KcDanger.realmRolePlan("admin", true, MAPPINGS).get("kind"));
    }

    /** Текущие роли не прочитались — строка «не проверено», а не «добавится». */
    @Test
    void unreadableMappingsAreUnavailableNotGuessed() {
        for (String body : new String[]{null, "not json", "{\"x\":1}"}) {
            Map<String, Object> p = KcDanger.realmRolePlan("admin", false, body);
            @SuppressWarnings("unchecked")
            Map<String, Object> check = (Map<String, Object>) p.get("check");
            assertEquals("unavailable", check.get("state"), "body=" + body);
            assertNull(p.get("before"), "было неизвестно — не false");
        }
    }

    // ── realm-роль: отмена ────────────────────────────────────────────────

    @Test
    void undoIsTheInverseCall() {
        assertEquals(Map.of("role", "admin", "action", "remove"),
            KcDanger.realmRoleUndo(KcDanger.realmRolePlan("admin", false, MAPPINGS)));
        assertEquals(Map.of("role", "viewer", "action", "add"),
            KcDanger.realmRoleUndo(KcDanger.realmRolePlan("viewer", true, MAPPINGS)));
        assertNull(KcDanger.realmRoleUndo(KcDanger.realmRolePlan("viewer", false, MAPPINGS)),
            "ничего не менялось — отменять нечего");
    }

    @Test
    void opIdCarriesItsUndoWindow() {
        Instant at = Instant.parse("2026-11-11T10:00:00Z");
        String id = KcDanger.opId(at);
        assertTrue(KcDanger.isOpId(id), id);
        assertTrue(id.startsWith("kr-"), "у операции KC свой префикс — журнал не путает её с пачкой rb-");
        assertFalse(LoreRoleBatch.isBatchId(id));
        assertEquals(at.plus(Duration.ofMinutes(15)), KcDanger.undoUntil(id));
        assertNull(KcDanger.undoError(id, at.plus(Duration.ofMinutes(14))));
        String late = KcDanger.undoError(id, at.plus(Duration.ofMinutes(16)));
        assertNotNull(late);
        assertTrue(late.contains("закрыто"), late);
        assertNotNull(KcDanger.undoError("rb-1762767074000-ab12cd34", at), "чужой id — отказ");
        assertNotNull(KcDanger.undoError(null, at));
    }

    /** Журнал AO-01 берёт первое *_id поле ответа — это человек, не служебный id. */
    @Test
    void realmAnswerJournalsThePerson() {
        Instant at = Instant.parse("2026-11-11T10:00:00Z");
        Map<String, Object> plan = KcDanger.realmRolePlan("admin", false, MAPPINGS);
        Map<String, Object> a = KcDanger.realmRoleAnswer("u-123", KcDanger.opId(at), plan);
        assertEquals("u-123", LoreAuditLogFilter.entityIdOf(a));
        assertEquals("added", a.get("action"));
        assertEquals(Map.of("role", "admin", "action", "remove"), a.get("undo"));
        assertEquals(String.valueOf(at.plus(Duration.ofMinutes(15))), a.get("undo_until"));
    }

    // ── ротация секрета ───────────────────────────────────────────────────

    @Test
    void rotationPlanSaysUndoIsImpossible() {
        Map<String, Object> p = KcDanger.rotationPlan("{\"id\":\"c-uuid\",\"clientId\":\"lore-mcp-full_pc1\",\"enabled\":true}");
        assertEquals("lore-mcp-full_pc1", p.get("client_id"));
        assertEquals("c-uuid", p.get("id"));
        assertEquals("rotate", p.get("kind"));
        assertEquals("~", p.get("sign"));
        assertEquals(false, p.get("undoable"));
        String why = String.valueOf(p.get("undo_reason"));
        assertTrue(why.contains("нельзя") && why.contains("новый"), why);
        assertEquals(Map.of("state", "checked", "source", "keycloak"), p.get("check"));
    }

    @Test
    void rotationPlanOfUnreadableClientIsUnavailable() {
        Map<String, Object> p = KcDanger.rotationPlan("garbage");
        @SuppressWarnings("unchecked")
        Map<String, Object> check = (Map<String, Object>) p.get("check");
        assertEquals("unavailable", check.get("state"));
        assertEquals(false, p.get("undoable"));
    }

    /** Секрет — в ответе ОДИН раз; журнал пишет клиента, не секрет; без значения — null. */
    @Test
    void rotationAnswerNeverJournalsTheSecret() {
        Map<String, Object> a = KcDanger.rotationAnswer("lore-mcp-full_pc1", "{\"type\":\"secret\",\"value\":\"s3cr3t-XYZ\"}");
        assertNotNull(a);
        assertEquals("lore-mcp-full_pc1", LoreAuditLogFilter.entityIdOf(a));
        assertEquals("s3cr3t-XYZ", a.get("secret"));
        assertEquals(false, a.get("undoable"));
        assertFalse(String.valueOf(a.get("undo_reason")).contains("s3cr3t"));
        assertNull(KcDanger.rotationAnswer("x", "{\"type\":\"secret\"}"), "значения нет — не «успех с пустым секретом»");
        assertNull(KcDanger.rotationAnswer("x", "not json"));
    }

    @Test
    void uuidIsRecognised() {
        assertTrue(KcDanger.isUuid("3f2a1c7e-0b1d-4e5f-9a8b-1c2d3e4f5a6b"));
        assertFalse(KcDanger.isUuid("lore-mcp-full_pc1"));
        assertFalse(KcDanger.isUuid(null));
    }
}
