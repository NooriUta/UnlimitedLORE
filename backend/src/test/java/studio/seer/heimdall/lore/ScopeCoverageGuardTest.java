package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-SCOPE-HOLES. Первый живой вход пользователя без ролей
 * после включения скоупа (06.11.2026): «в выпадающем списке все проекты видны».
 * Под скоупом было 9 срезов из 141 — остальные отдавали проектные данные мимо него.
 *
 * <p>Лечится не дырой за дырой, а правилом: КАЖДЫЙ срез обязан быть либо под
 * скоупом, либо в явном списке «общих» (с причиной), либо в списке «ждёт решения».
 * Новый срез, не попавший ни в один, — красный тест, а не тихая новая дыра.
 */
class ScopeCoverageGuardTest {

    @Test
    void everySliceIsClassified() {
        List<String> unclassified = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            boolean ok = LoreSlices.PROJECT_SCOPED.containsKey(id)
                || LoreSlices.BODY_SCOPED.containsKey(id)
                || LoreSlices.SHARED_SLICES.containsKey(id)
                || LoreSlices.SCOPE_PENDING.containsKey(id);
            if (!ok) unclassified.add(id);
        }
        assertEquals(List.of(), unclassified,
            "срез не отнесён ни к скоупным, ни к общим, ни к «ждёт решения» — это новая дыра скоупа");
    }

    @Test
    void noSliceIsBothScopedAndShared() {
        for (String id : LoreSlices.SHARED_SLICES.keySet())
            assertFalse(LoreSlices.PROJECT_SCOPED.containsKey(id), id + " и общий, и скоупный");
        for (String id : LoreSlices.SCOPE_PENDING.keySet())
            assertFalse(LoreSlices.PROJECT_SCOPED.containsKey(id), id + " и «ждёт», и скоупный");
    }

    @Test
    void projectDropdownIsScoped() {
        // Дыра, которую увидела владелица: выпадающий список проектов.
        String sql = LoreSlices.compose("git_projects", Map.of(), Set.of("org/a")).sql();
        assertTrue(sql.contains("slug = :__scope0"), "сравнение по самому slug, а не обход рёбер: " + sql);
    }

    @Test
    void scopeConditionGoesBeforeTrailingOrderByAndLimit() {
        // ORDER BY у части срезов — в тексте запроса, а не в хвосте; условие,
        // дописанное после ORDER BY, сломало бы SQL на каждом из них.
        for (String id : LoreSlices.PROJECT_SCOPED.keySet()) {
            Map<String, String> given = new HashMap<>();
            for (String r : LoreSlices.get(id).required()) given.put(r, "X");
            String sql = LoreSlices.compose(id, given, Set.of("org/a")).sql();
            int cond = sql.indexOf(":__scope0");
            assertTrue(cond > 0, id + ": условия скоупа нет: " + sql);
            int order = sql.lastIndexOf(" ORDER BY ");
            if (order > 0 && !sql.substring(order).contains("(SELECT"))
                assertTrue(cond < order, id + ": условие скоупа после ORDER BY: " + sql);
            int limit = sql.lastIndexOf(" LIMIT ");
            if (limit > 0 && !sql.substring(limit).contains("(SELECT"))
                assertTrue(cond < limit, id + ": условие скоупа после LIMIT: " + sql);
        }
    }

    @Test
    void newsKeepsOnlyAllowedProjectsAndDropsProjectless() {
        List<Map<String, Object>> items = List.of(
            Map.of("title", "a", "projects", List.of("org/a")),
            Map.of("title", "ab", "projects", List.of("org/b", "org/a")),
            Map.of("title", "b", "projects", List.of("org/b")),
            Map.of("title", "none", "projects", List.of()));
        List<Map<String, Object>> out = AidaLoreResource.scopeNews(items, Set.of("org/a"));
        assertEquals(List.of("a", "ab"), out.stream().map(m -> (String) m.get("title")).toList(),
            "видно событие, у которого хотя бы один проект разрешён; ничьё — нет");
    }

    @Test
    void tasksReachTheirProjectThroughTheSprint() {
        String sql = LoreSlices.compose("open_tasks", Map.of(), Set.of("org/a")).sql();
        assertTrue(sql.contains("out('PART_OF').out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0"), sql);
    }
}
