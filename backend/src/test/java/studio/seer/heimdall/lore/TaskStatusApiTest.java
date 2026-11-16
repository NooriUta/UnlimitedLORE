package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-11, шаг А — находки 16.11.2026 по API статусов задачи.
 * Статус при создании обязателен и не выбрасывается молча; отказы говорят, что именно не так.
 */
class TaskStatusApiTest {

    // ── 1. Статус при создании ────────────────────────────────────────────

    @Test
    void missingStatusOnCreateBecomesTheFirstStatusBacklog() {
        // Правило владелицы 16.11.2026: «если статус не указан при создании — ставим первый статус, в бэклог».
        for (String missing : new String[] {null, "", "  "}) {
            assertNull(TaskCreateStatus.refuse(missing), "не отказ: [" + missing + "]");
            assertTrue(TaskCreateStatus.defaulted(missing));
            assertEquals("🟣 BACKLOG", TaskCreateStatus.raw(missing), "статус у задачи есть всегда, пустым он не бывает");
        }
        assertEquals("backlog", TaskCreateStatus.DEFAULT);
        assertFalse(TaskCreateStatus.defaulted("planned"));
    }

    @Test
    void statusGivenOnCreateIsWrittenAsItsRawForm() {
        assertNull(TaskCreateStatus.refuse("planned"));
        assertEquals("📋 PLANNED", TaskCreateStatus.raw("planned"));
        assertEquals("🔄 IN PROGRESS", TaskCreateStatus.raw("active"));
        assertEquals("🟣 BACKLOG", TaskCreateStatus.raw("backlog"));
        assertEquals("📋 PLANNED", TaskCreateStatus.raw(" PLANNED "), "регистр и пробелы не мешают");
        assertEquals(List.of("planned", "todo", "backlog", "design", "active"), TaskCreateStatus.ALLOWED);
    }

    @Test
    void statusesThatNeedWordsOrProofAreNotSetOnCreate() {
        // done, приёмка, блокировка и ожидание требуют доказательства, причины или «кого ждём» — это путь
        // смены статуса; создание не должно быть лазейкой мимо этих проверок.
        for (String gated : new String[] {"done", "uat", "ready_for_deploy", "review", "blocked", "waiting", "cancelled", "failed", "partial"}) {
            String why = TaskCreateStatus.refuse(gated);
            assertNotNull(why, gated);
            assertTrue(why.contains("status_set"), "сказано, каким путём ставится такой статус: " + why);
        }
        String unknown = TaskCreateStatus.refuse("в работе");
        assertNotNull(unknown);
        assertTrue(unknown.contains("в работе"), "незнакомое значение названо: " + unknown);
    }

    @Test
    void createRequestCarriesStatusSoItIsNotDroppedSilently() {
        boolean has = java.util.Arrays.stream(LoreSprintTaskResource.TaskCreateRequest.class.getRecordComponents())
            .anyMatch(c -> c.getName().equals("status"));
        assertTrue(has, "тело POST /lore/task несёт status — иначе сервер его не видит и клиенту нечего проверять");
    }

    // ── 2. Отказ по ролям называет ключи запроса ──────────────────────────

    @Test
    void rolesRefusalNamesTheRequestKeys() {
        String why = TaskRoleWriter.refuseCreate(null, null, List.of("omiloreadmin"));
        assertNotNull(why);
        assertTrue(why.contains("author_agent") && why.contains("executor_agent"),
            "по тексту должно быть понятно, какими ключами называть роли: " + why);
    }

    // ── 4. Уже закрытая задача ────────────────────────────────────────────

    @Test
    void agentSettingDoneOnAlreadyDoneTaskIsToldSo() {
        LoreDoneGate.Verdict v = LoreDoneGate.done(new LoreDoneGate.Facts(true, "agent-full", "agent-full", "omiloreadmin",
            "done", "dev", "owner_word", "16.11.2026 08:31 «закрывай»"), LoreModelFile.content().workflow());
        assertNotNull(v);
        assertEquals("ALREADY_DONE", v.code());
        assertFalse(v.detail().contains("переведите в review"), "не совет идти в review: " + v.detail());
    }

    @Test
    void positiveControlDoneFromActiveIsStillRefusedAsBefore() {
        LoreDoneGate.Verdict v = LoreDoneGate.done(new LoreDoneGate.Facts(true, "agent-full", "agent-full", "omiloreadmin",
            "active", "dev", "owner_word", "16.11.2026 08:31 «закрывай»"), LoreModelFile.content().workflow());
        assertEquals("DONE_ONLY_FROM_REVIEW", v.code());
    }
}
