package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Владелица 09.11.2026: «верхний фильтр по проектам не влияет на элементы внизу». Выбор
 * проектов в шапке v2 (?proj=a,b) серверу передать было нечем: срез сужался только правами
 * вызывающего. {@code scope_projects} сужает любой проектно-скоупленный срез до выбранных
 * проектов — пересечением с правами, а не вместо них, — и честно говорит, где сузить нельзя.
 */
class SliceProjectNarrowingTest {

    private static final String SCOPED = "tasks_of_sprint";        // проект через спринт
    private static final String UNSCOPED = "dictionary";           // к проектам не привязан

    private static Map<String, String> given(String projects) {
        Map<String, String> g = new LinkedHashMap<>();
        g.put("sprint_id", "SPRINT_X");
        if (projects != null) g.put(SliceProjectNarrowing.PARAM, projects);
        return g;
    }

    @Test
    void withoutParamNothingChanges() {
        Map<String, String> g = given(null);
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply(SCOPED, g, Set.of("a"));
        assertEquals(Set.of("a"), r.scope());
        assertNull(r.meta());
        assertFalse(r.emptyByChoice());
    }

    @Test
    void paramIsTakenOutOfSliceParams() {
        Map<String, String> g = given("a");
        SliceProjectNarrowing.apply(SCOPED, g, null);
        assertFalse(g.containsKey(SliceProjectNarrowing.PARAM), "срез не знает параметра — иначе 400 unknown param");
    }

    /** Без ограничения прав (admin) выбор и есть скоуп. */
    @Test
    void unrestrictedCallerGetsTheChoice() {
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply(SCOPED, given("a,b"), null);
        assertEquals(Set.of("a", "b"), r.scope());
        assertEquals(true, r.meta().get("applied"));
        assertEquals(List.of(), r.meta().get("dropped"));
    }

    /** Выбор сужает права, но не расширяет: чужой проект отброшен и назван. */
    @Test
    void choiceIsIntersectedWithRights() {
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply(SCOPED, given("a,z"), Set.of("a", "b"));
        assertEquals(Set.of("a"), r.scope());
        assertEquals(List.of("z"), r.meta().get("dropped"));
    }

    /** Ни один выбранный не доступен — пусто ПО ВЫБОРУ, а не «нет прав вообще». */
    @Test
    void nothingAllowedIsEmptyByChoice() {
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply(SCOPED, given("z"), Set.of("a"));
        assertTrue(r.emptyByChoice());
        assertTrue(r.scope().isEmpty());
    }

    /** Срез без привязки к проектам: сузить нечем — так и сказано, выдача прежняя. */
    @Test
    void unscopedSliceSaysItCannotNarrow() {
        Map<String, String> g = new LinkedHashMap<>();
        g.put(SliceProjectNarrowing.PARAM, "a");
        SliceProjectNarrowing.Result r = SliceProjectNarrowing.apply(UNSCOPED, g, null);
        assertNull(r.scope());
        assertEquals(false, r.meta().get("applied"));
        assertTrue(String.valueOf(r.meta().get("reason")).contains("не привязан к проектам"));
    }

    @Test
    void badValueIsRejected() {
        assertThrows(IllegalArgumentException.class,
            () -> SliceProjectNarrowing.apply(SCOPED, given("a;DROP"), null));
    }
}
