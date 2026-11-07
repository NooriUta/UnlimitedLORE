package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/REL-UID-01: номер версии повторяется между
 * проектами (сайт и монорепо выпускали v1.4.1). Ключ релиза — release_uid
 * «проект#версия»; голый release_id — только для поиска. Без живой базы.
 */
class ReleaseUidKeyTest {

    @Test
    void freshInstallKeysReleasesByUidNotByVersion() {
        assertFalse(LoreSchemaInitializer.DDL.stream().anyMatch(s ->
                s.replaceAll("\s+", " ").contains("ON KnowRelease (release_id) UNIQUE")),
            "голый release_id не должен быть уникальным — второй проект с той же версией получит отказ");
        assertTrue(LoreSchemaInitializer.DDL.stream().anyMatch(s ->
                s.replaceAll("\s+", " ").contains("ON KnowRelease (release_uid) UNIQUE")),
            "уникальность — на паре проект#версия");
    }

    @Test
    void releaseIndexIngestTouchesOnlyItsProject() {
        assertEquals("NooriUta/AIDA", LoreIngestService.RELEASE_INDEX_PROJECT);
    }

    @Test
    void byTagSlicesNarrowToTheProject() {
        for (String slice : java.util.List.of("release_sprints_by_tag", "release_tasks_by_tag", "release_prs_by_tag")) {
            String sql = LoreSlices.compose(slice, java.util.Map.of("tag", "v1.4.1", "project", "NooriUta/seidr-site")).sql();
            assertTrue(sql.contains(":project"), slice + ": " + sql);
            assertFalse(sql.matches("(?s).*WHERE.*WHERE.*"), slice + " — два WHERE: " + sql);
        }
    }
}
