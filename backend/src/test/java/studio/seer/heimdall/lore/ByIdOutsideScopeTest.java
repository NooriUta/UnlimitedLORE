package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH, A12 (06.11.2026).
 *
 * <p>question_by_id не находил запись, которая в ту же минуту успешно
 * записалась: чтение по id режет по проектному скоупу, запись — нет. Пустой
 * ответ на явный id читался как «такой записи нет».
 *
 * <p>Правило: запрос по явному id обязан вернуть запись ЛИБО честно сказать,
 * что она вне скоупа. Содержимое не раскрывается — только факт существования
 * (тот же уровень, что 409 «id занят» у записи).
 */
class ByIdOutsideScopeTest {

    @Test
    void byIdSlicesAreTheScopedOnesAddressedByAnExplicitId() {
        assertTrue(AidaLoreResource.isScopedByIdSlice("question_by_id"));
        assertFalse(AidaLoreResource.isScopedByIdSlice("questions"), "списочный срез — не адресный");
        assertFalse(AidaLoreResource.isScopedByIdSlice("no_such_slice"));
        // Положительный контроль: правило касается всех адресных срезов под скоупом, а не одного.
        long n = LoreSlices.ids().stream().filter(AidaLoreResource::isScopedByIdSlice).count();
        assertTrue(n >= 3, "адресных срезов под скоупом несколько, найдено " + n);
    }

    @Test
    void emptyScopedAnswerOnAnExistingIdSaysOutsideScope() {
        Map<String, Object> m = AidaLoreResource.outsideScopeMarker("Q-X", true);
        assertNotNull(m);
        assertEquals("Q-X", m.get("id"));
        assertEquals("outside_scope", m.get("verdict"));
        assertTrue(String.valueOf(m.get("reason")).contains("вне"), String.valueOf(m));
    }

    @Test
    void reallyMissingIdStaysEmptyWithoutAMarker() {
        assertNull(AidaLoreResource.outsideScopeMarker("Q-X", false),
            "записи нет вовсе — это «не найдено», а не «вне скоупа»");
    }

    @Test
    void rowsAreCountedInBothResponseShapes() {
        assertTrue(AidaLoreResource.isEmptyResult(List.of()));
        assertFalse(AidaLoreResource.isEmptyResult(List.of(Map.of("id", "Q"))));
        assertTrue(AidaLoreResource.isEmptyResult(null));
    }
}
