package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-02 — ось «Релиз» в сквозном списке задач и
 * SPRINT_UXR_S9_SCALE_OPT/S9-03 — закреплённые значения фасета (текущие релизы).
 *
 * <p>S9-02: срезы {@code open_tasks}/{@code closed_tasks} не отдавали релиз, и разделу
 * «Задачи» нечем было группировать по релизу. Релиз задачи — релиз её спринта
 * (PART_OF → IMPLEMENTED_IN_RELEASE), как в {@code tasks_of_sprint}.
 *
 * <p>S9-03: «текущий релиз» знает только сервер ({@code KnowRelease.is_current}); он едет
 * в том же ответе {@code /facets}, а не отдельным запросом на каждом экране.
 */
class TaskReleaseAxisAndPinnedTest {

    @Test
    void taskSlicesCarryTheirSprintRelease() {
        for (String id : List.of("open_tasks", "closed_tasks")) {
            String sql = LoreSlices.compose(id, Map.of()).sql();
            assertTrue(sql.contains("out('PART_OF').out('IMPLEMENTED_IN_RELEASE').release_id AS release_ids"),
                id + ": релиз спринта задачи: " + sql);
            assertFalse(sql.contains("note_md"), id + ": проекция остаётся облегчённой: " + sql);
        }
    }

    @Test
    void releaseIsAFacetAxisOfTaskSlices() {
        assertEquals(List.of("release_ids", "component_ids"),
            LoreListFacets.axes("open_tasks", "release_ids,component_ids"));
        assertEquals(List.of("release_ids"), LoreListFacets.axes("closed_tasks", "release_ids"));
    }

    /** Положительный контроль: поля, которого в срезе нет, ось не принимает. */
    @Test
    void unknownAxisStillRefused() {
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("open_tasks", "components"));
    }

    @Test
    void pinnedAskedOnlyForReleaseAxis() {
        assertTrue(LoreListFacets.wantsPinned(List.of("sprint_id", "release_ids")));
        assertFalse(LoreListFacets.wantsPinned(List.of("sprint_id", "component_ids")));
        assertTrue(LoreListFacets.CURRENT_RELEASES_SQL.contains("FROM KnowRelease"));
        assertTrue(LoreListFacets.CURRENT_RELEASES_SQL.contains("is_current = true"));
    }

    @Test
    void currentReleasesPinnedNewestFirstWithoutDuplicates() {
        List<Map<String, Object>> rows = List.of(
            Map.of("release_id", "v1.17.12", "git_project", "NooriUta/UnlimitedLORE"),
            Map.of("release_id", "link-v0.3.7", "git_project", "AIDA/miniLORE"),
            Map.of("release_id", "v1.17.12", "git_project", "NooriUta/UnlimitedLORE"),
            Map.of("release_id", "", "git_project", "x"));
        assertEquals(List.of("v1.17.12", "link-v0.3.7"), LoreListFacets.pinnedReleases(rows, null));
    }

    /** Выбор проектов сужает и закреплённые: текущий релиз чужого проекта — шум в фасете. */
    @Test
    void scopeNarrowsPinned() {
        List<Map<String, Object>> rows = List.of(
            Map.of("release_id", "v1.17.12", "git_project", "NooriUta/UnlimitedLORE"),
            Map.of("release_id", "link-v0.3.7", "git_project", "AIDA/miniLORE",
                "projects", List.of("AIDA/miniLORE")));
        assertEquals(List.of("link-v0.3.7"), LoreListFacets.pinnedReleases(rows, Set.of("AIDA/miniLORE")));
        assertEquals(List.of(), LoreListFacets.pinnedReleases(rows, Set.of()));
    }

    @Test
    void pinnedGoesIntoTheAnswerUnderTheAxis() {
        Map<String, Object> base = Map.of("rows", List.of());
        Map<String, Object> out = LoreListFacets.assemble("open_tasks", List.of("release_ids"), base,
            Map.of("release_ids", base), Map.of(), null, Map.of());
        LoreListFacets.putPinned(out, List.of("release_ids"), List.of("v1.17.12"), null);
        assertEquals(Map.of("release_ids", List.of("v1.17.12")), out.get("pinned"));
        assertNull(out.get("pinned_unavailable"));
    }

    /** Не прочитали текущие релизы — это сказано причиной, а не пустым набором. */
    @Test
    void pinnedFailureIsNamed() {
        Map<String, Object> base = Map.of("rows", List.of());
        Map<String, Object> out = LoreListFacets.assemble("open_tasks", List.of("release_ids"), base,
            Map.of("release_ids", base), Map.of(), null, Map.of());
        LoreListFacets.putPinned(out, List.of("release_ids"), null, "UPSTREAM: timeout");
        assertNull(out.get("pinned"));
        assertEquals(Map.of("release_ids", "UPSTREAM: timeout"), out.get("pinned_unavailable"));
    }
}
