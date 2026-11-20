package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Служебное поле версии {@code changed_by_session} — код сессии агента, записавшей версию
 * (SPRINT_LORE_AGENT_OBSERVABILITY/AO-SESSION-LOG). Слова владелицы 16.11.2026: «в истории тех, у кого есть
 * история, он пишет идентификатор сессии»; «с тебя изменение в модель текущего решения и синхронизация правил
 * общих технических полей».
 *
 * <p>Поле входит во все перечни служебных полей сразу: иначе одно место показывает его как «не описано в
 * модели», а другое переносит из прежней версии в новую — и новая версия получает чужую сессию.
 */
class ServiceFieldSessionTest {

    @Test
    void sessionFieldIsInApprovedServiceList() {
        assertTrue(LoreRecordUnmodeled.SERVICE.contains("changed_by_session"),
            "служебное поле не показывается блоком «Не описано в модели»");
    }

    @Test
    void sessionFieldIsInternalInModel() {
        assertTrue(LoreModelTypes.isInternal("changed_by_session", "task_uid"),
            "в модели — внутреннее, на поверхность не выводится, как changed_by");
    }

    @Test
    void sessionFieldIsNeverCopiedFromPreviousVersion() {
        assertTrue(StatusHistoryService.VERSION_FIELDS.contains("changed_by_session"),
            "сессию ставит сервис для своей версии; из прежней строки её не переносят");
    }

    /** 16.11.2026, слова владелицы: «просить каждый mcp писать harness … указать его константой»; «и машину что уж то же». */
    @Test
    void harnessAndMachineAreServiceFieldsToo() {
        for (String f : java.util.List.of("changed_by_harness", "changed_by_harness_note", "changed_by_machine")) {
            assertTrue(LoreRecordUnmodeled.SERVICE.contains(f), "SERVICE: " + f);
            assertTrue(StatusHistoryService.VERSION_FIELDS.contains(f), "VERSION_FIELDS: " + f);
        }
    }

    /**
     * SPRINT_LORE_WORK_ANY_KIND/WK-01 (20.11.2026): причина правки {@code change_reason} — служебное поле версии рядом
     * с changed_by_*: не «не описано в модели», внутреннее, и из прежней версии не переносится (у каждой правки своя).
     */
    @Test
    void changeReasonIsServiceVersionField() {
        assertTrue(LoreRecordUnmodeled.SERVICE.contains("change_reason"), "SERVICE");
        assertTrue(LoreModelTypes.isInternal("change_reason", "code"), "isInternal");
        assertTrue(StatusHistoryService.VERSION_FIELDS.contains("change_reason"), "VERSION_FIELDS");
    }

    /** Общее правило: служебные поля автора правки ходят вместе — где есть changed_by, там и сессия. */
    @Test
    void authorFieldsTravelTogether() {
        for (String f : java.util.List.of("changed_by", "changed_by_kind", "changed_by_session", "changed_by_harness", "changed_by_harness_note", "changed_by_machine")) {
            assertTrue(LoreRecordUnmodeled.SERVICE.contains(f), "SERVICE: " + f);
            assertTrue(LoreModelTypes.isInternal(f, "task_uid"), "isInternal: " + f);
            assertTrue(StatusHistoryService.VERSION_FIELDS.contains(f), "VERSION_FIELDS: " + f);
        }
    }
}
