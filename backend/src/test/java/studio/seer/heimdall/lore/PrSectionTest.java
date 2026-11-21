package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 1.18, владелица 21.11.2026: «и в меню под релизы вход в PR сделай». Пункт меню «PR» сразу под «Релизами» в той же
 * группе; список всех PR со скоупом проекта (scope_projects / scope_products сужают, как у прочих проектных списков).
 */
class PrSectionTest {

    @Test
    void navHasPrRightUnderReleases() {
        List<String> work = null;
        for (LoreModelNav.Group g : LoreModelFile.content().nav()) {
            List<String> items = g.items().stream().map(LoreModelNav.Item::section).toList();
            if (items.contains("release")) work = items;
        }
        assertNotNull(work, "группа меню с релизами");
        assertEquals("pr", work.get(work.indexOf("release") + 1), "PR — сразу под «Релизами»: " + work);
        assertEquals("everywhere", LoreModelFile.content().audience().get("pr"));
    }

    @Test
    void prsSliceIsProjectScoped() {
        LoreSlices.SliceDef d = LoreSlices.get("prs");
        assertNotNull(d, "срез списка PR");
        String sql = d.baseSql();
        for (String col : List.of("pr_uid", "title", "state", "merged_at", "head_ref", "base_ref", "release_uid AS release_uids", "AS git_projects"))
            assertTrue(sql.contains(col), col + ": " + sql);
        assertTrue(sql.contains("ORDER BY merged_at DESC") || d.suffix().contains("ORDER BY merged_at DESC"), "свежие сверху");
        assertTrue(LoreSlices.PROJECT_SCOPED.containsKey("prs"), "скоуп проекта — как у прочих проектных списков");
        LoreSlices.Composed c = LoreSlices.compose("prs", Map.of(), Set.of("NooriUta/UnlimitedLORE"));
        assertTrue(c.sql().contains("git_project = :__scope0") && c.sql().contains("out('BELONGS_TO_PROJECT').slug CONTAINS :__scope0"),
            "проект PR — ребро или поле git_project: " + c.sql());
    }
}
