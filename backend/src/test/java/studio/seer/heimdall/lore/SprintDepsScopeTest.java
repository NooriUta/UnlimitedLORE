package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Решение владелицы 11.11.2026: «поставить sprint_deps под скоуп».
 *
 * <p>Находка в данных: 20 зависимостей (DWL — 17, MIDGARD — 3) вели на спринты,
 * которых нет в выдаче {@code sprints}. Корень: агент видит только проекты
 * своего владельца, срез {@code sprints} под скоупом, а {@code sprint_deps}
 * лежал в {@code SCOPE_PENDING} (SPRINT_LORE_PROJECT_SCOPE/AL-SCOPE-HOLES) и
 * отдавал рёбра на невидимые спринты. Два среза одной системы противоречили друг
 * другу.
 *
 * <p>У зависимости ДВА конца, и показывать её можно, только если видны ОБА
 * спринта: иначе ребро снова ведёт в невидимое. Поэтому механизм скоупа получает
 * обязательные концы: пути через «&» — каждый обязан привести в разрешённый
 * проект (внутри пути, как и прежде, «|» — «хотя бы один»). Сколько рёбер
 * скрыто — говорится числом ({@code scope.hidden}), а не молча.
 */
class SprintDepsScopeTest {

    private static Set<String> set(String... s) { return new LinkedHashSet<>(java.util.List.of(s)); }

    @Test
    void sprintDepsIsScopedNotPending() {
        assertTrue(LoreSlices.PROJECT_SCOPED.containsKey("sprint_deps"), "sprint_deps под скоупом");
        assertFalse(LoreSlices.SCOPE_PENDING.containsKey("sprint_deps"), "и больше не в «ждёт решения»");
    }

    @Test
    void bothEndsMustBeVisible() {
        String sql = LoreSlices.compose("sprint_deps", Map.of(), set("org/a", "org/b")).sql();
        int from = sql.indexOf("@out.out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0");
        int to = sql.indexOf("@in.out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0");
        assertTrue(from > 0, "конец «откуда» проверяется: " + sql);
        assertTrue(to > 0, "конец «куда» проверяется: " + sql);
        assertTrue(sql.contains(") AND ("), "концы соединены через И, а не ИЛИ: " + sql);
        // Внутри конца проекты — по-прежнему ИЛИ.
        assertTrue(sql.contains("@out.out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0 OR @out.out('BELONGS_TO_PROJECT').slug CONTAINS :__scope1"),
            "внутри конца — любой из разрешённых проектов: " + sql);
    }

    @Test
    void emptyScopeHidesEverythingOnBothEnds() {
        var c = LoreSlices.compose("sprint_deps", Map.of(), Set.of());
        assertEquals(LoreSlices.SCOPE_NONE, c.params().get("__scope0"));
        assertFalse(c.sql().contains("__scope1"), "одна заглушка на оба конца");
        assertTrue(c.sql().contains("@in.out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0"), c.sql());
    }

    @Test
    void singleEndSlicesUnchanged() {
        // Обычные срезы по-прежнему одно условие без «И» между группами.
        String sql = LoreSlices.compose("adrs", Map.of(), set("org/a", "org/b")).sql();
        assertFalse(sql.contains(") AND ("), sql);
        assertTrue(sql.contains(":__scope0 OR"), sql);
    }

    @Test
    void hiddenCountIsSaidAsNumber() {
        Map<String, Object> marker = new LinkedHashMap<>(AidaLoreResource.scopeMeta("sprint_deps", set("org/a")));
        AidaLoreResource.putHidden(marker, 114, 94);
        assertEquals(20, marker.get("hidden"));
        assertTrue(String.valueOf(marker.get("hidden_note")).contains("20"), "число скрытых названо словами");
    }

    @Test
    void nothingHiddenSaysNothing() {
        Map<String, Object> marker = new LinkedHashMap<>(AidaLoreResource.scopeMeta("sprint_deps", set("org/a")));
        AidaLoreResource.putHidden(marker, 94, 94);
        assertEquals(0, marker.get("hidden"));
        assertNull(marker.get("hidden_note"), "скрытых нет — без оговорки");
    }

    @Test
    void hiddenCountedOnlyForListedSlices() {
        assertTrue(AidaLoreResource.HIDDEN_COUNTED.contains("sprint_deps"));
        assertFalse(AidaLoreResource.HIDDEN_COUNTED.contains("sprints"));
    }
}
