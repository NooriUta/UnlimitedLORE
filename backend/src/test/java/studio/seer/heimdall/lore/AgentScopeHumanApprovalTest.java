package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Решение владелицы 09.11.2026 (канал, вариант «А»): «перепиши правило — с разрешения
 * человека». Справочник (семейство {@code dict}) остаётся человеческим, но агент full
 * может записать в него, если в запросе названо, кто из людей разрешил
 * ({@link AgentScopeFilter#HUMAN_APPROVAL_HEADER}). Разрешение пишется в журнал.
 *
 * <p>Проверяется чистая функция {@code decide}: та же, что отказывает на проде.
 */
class AgentScopeHumanApprovalTest {

    private static final String DICT = "lore/dict/entry";
    private static final String OK = "omiloreadmin: канал minilore 09.11, adr_status DRAFT";

    /** Без разрешения — как раньше: справочник правит только человек. */
    @Test
    void dictWithoutApprovalStaysHumanOnly() {
        assertNotNull(AgentScopeFilter.decide("full", DICT, null));
        assertNotNull(AgentScopeFilter.decide("full", DICT, "   "));
    }

    /** Ради чего всё: full с названным разрешением человека пишет в справочник. */
    @Test
    void fullWithHumanApprovalMayWriteDict() {
        assertNull(AgentScopeFilter.decide("full", DICT, OK));
    }

    /** Только full: узкие профили справочник не правят и с разрешением. */
    @Test
    void narrowProfilesStayOutEvenWithApproval() {
        for (String scope : new String[]{"architect", "developer", "tester", "pm", "analyst", "marketer"})
            assertNotNull(AgentScopeFilter.decide(scope, DICT, OK), scope);
    }

    /** Только справочник: остальные человеческие семейства разрешением не открываются. */
    @Test
    void otherHumanFamiliesDoNotOpen() {
        for (String path : new String[]{"lore/kc/agent-client", "lore/admin/lore/ingest",
                                        "lore/news/v2/read-mark", "lore/record/task/X/relation"})
            assertNotNull(AgentScopeFilter.decide("full", path, OK), path);
    }

    /** Двухаргументная форма — без разрешения, поведение прежнее. */
    @Test
    void legacyFormIsUnchanged() {
        assertEquals("dict", AgentScopeFilter.decide("full", DICT).what());
    }

    /** Разрешение — короткая строка «кто и где»; простыня — не разрешение. */
    @Test
    void oversizedApprovalIsRejected() {
        assertNotNull(AgentScopeFilter.decide("full", DICT, "x".repeat(301)));
    }
}
