package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * decision:D-2026-LORE-QUESTIONS-SLICE-RENAME (accepted 06.11.2026, под ADR-LORE-020).
 *
 * <p>Слова владелицы: «переназовите просто вопросы и группируйте по статусу».
 * Срез {@code open_questions} отдавал ВСЕ вопросы (126 из 244 строк закрыты) —
 * имя обещало одно, выдача делала другое, и потребители MCP читали закрытые
 * как открытые. Теперь срез называется {@code questions}, выдача идёт группами
 * open · deferred · closed · dropped, а {@code open_questions} остаётся
 * синонимом на переход (UI, MCP, miniLORE).
 */
class QuestionsSliceRenameTest {

    @Test
    void questionsSliceIsRegistered() {
        assertNotNull(LoreSlices.get("questions"), "срез questions зарегистрирован");
    }

    @Test
    void openQuestionsStaysAsSynonymWithTheSameShape() {
        LoreSlices.SliceDef q = LoreSlices.get("questions");
        LoreSlices.SliceDef legacy = LoreSlices.get("open_questions");
        assertNotNull(legacy, "open_questions оставлен синонимом — иначе ломаются UI, MCP и miniLORE");
        assertEquals(q.baseSql(), legacy.baseSql(), "синоним отдаёт ту же выдачу");
        assertEquals(q.suffix(), legacy.suffix(), "и в том же порядке");
    }

    @Test
    void outputIsGroupedByStatusInOwnersOrder() {
        String sql = LoreSlices.compose("questions", Map.of()).sql();
        assertTrue(sql.contains("AS status_rank"), "ранг статуса в выдаче: " + sql);
        int open = sql.indexOf("'open' THEN 0");
        int deferred = sql.indexOf("'deferred' THEN 1");
        int closed = sql.indexOf("'closed' THEN 2");
        int dropped = sql.indexOf("'dropped' THEN 3");
        assertTrue(open > 0 && deferred > open && closed > deferred && dropped > closed,
            "порядок групп open · deferred · closed · dropped: " + sql);
        assertTrue(sql.trim().endsWith("ORDER BY status_rank, question_id"),
            "группировка — сортировкой по рангу, внутри группы по id: " + sql);
    }

    @Test
    void bothNamesAreScopedTheSameWay() {
        assertEquals(LoreSlices.PROJECT_SCOPED.get("open_questions"),
            LoreSlices.PROJECT_SCOPED.get("questions"),
            "новое имя не должно открыть скоупную дыру");
        String scoped = LoreSlices.compose("questions", Map.of(), Set.of("NooriUta/UnlimitedLORE")).sql();
        assertTrue(scoped.contains("RAISED_IN"), "скоуп через RAISED_IN действует и на новом имени: " + scoped);
        assertTrue(scoped.trim().endsWith("ORDER BY status_rank, question_id"),
            "фильтр скоупа встаёт ДО сортировки: " + scoped);
    }
}
