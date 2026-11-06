package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_QG_REBUILD/QG-16: причина блокировки спринта.
 *
 * <p>Повод (Q-2026-BLOCKED-SPRINTS-ARE-MISLABELLED): срез {@code blocked_sprints}
 * перебирал ВСЕ строки истории — по строке на каждую blocked-ревизию (дубли
 * ×2/×3), посчитать по нему было нельзя. Причины блокировки в модели не было.
 *
 * <p>Владелица 06.11: «достаточно если объясняется блокировка … главное чтобы
 * инструмент знал причину» — причина пишется текстом в status_set.
 */
class BlockedSprintsReasonTest {

    private static String sql(String slice) {
        return LoreSlices.compose(slice, Map.of()).sql();
    }

    @Test
    void everBlockedKeepsItsMeaningButOneRowPerSprint() {
        // LoreAnalytics «Blocked rate» считает спринты, КОГДА-ЛИБО бывшие blocked —
        // этот смысл не трогаем (иначе метрика молча сменит определение), убираем дубли.
        String s = sql("blocked_sprints");
        assertTrue(s.contains("FROM KnowSprint "), "строка на спринт, а не на ревизию: " + s);
        assertFalse(s.contains("FROM KnowSprintHist"), s);
        assertTrue(s.contains("out('HAS_STATE')[status_raw LIKE '%BLOCK%']"), "любая ревизия, не только открытая: " + s);
        assertFalse(s.contains("valid_to IS NULL"), "«когда-либо», а не «сейчас»: " + s);
    }

    @Test
    void reasonSliceIsCurrentStateOnly() {
        String s = sql("blocked_sprints_reason");
        assertTrue(s.contains("FROM KnowSprint "), s);
        assertTrue(s.contains("WHERE out('HAS_STATE')[valid_to IS NULL AND status_raw LIKE '%BLOCK%']"),
            "заблокирован СЕЙЧАС — по открытой строке истории: " + s);
    }

    @Test
    void reasonSliceCarriesTheExplanation() {
        String s = sql("blocked_sprints_reason");
        for (String col : new String[] {"name", "block_reason", "task_count", "deps", "open_deps", "open_questions"}) {
            assertTrue(s.contains(" AS " + col), "колонка " + col + ": " + s);
        }
    }

    @Test
    void openDependencyMeansNotDoneAndNotCancelled() {
        String s = sql("blocked_sprints_reason");
        assertTrue(s.contains("out('DEPENDS_ON')[out('HAS_STATE')[valid_to IS NULL AND ("), s);
        assertTrue(s.contains(LoreStatusVocabulary.anySql("status_raw", "done", "cancelled")), s);
    }

    @Test
    void hintOnlyWhenBlockingWithoutReason() {
        assertNotNull(LoreStatusResource.blockReasonHint("sprint", "blocked", null));
        assertNotNull(LoreStatusResource.blockReasonHint("sprint", "blocked", "   "));
        assertNull(LoreStatusResource.blockReasonHint("sprint", "blocked", "ждёт ответа заказчика"));
        assertNull(LoreStatusResource.blockReasonHint("sprint", "active", null));
        assertNull(LoreStatusResource.blockReasonHint("task", "blocked", null), "причина — у спринтов");
    }
}
