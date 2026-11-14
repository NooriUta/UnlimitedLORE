package studio.seer.heimdall.lore;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Владелица 14.11.2026: «почему эти задачи запланировано, когда к ним релизы привязаны —
 * это ошибка отображения или статуса?». Корень: колонка «Релиз» у задачи брала релизы
 * её СПРИНТА (PART_OF → IMPLEMENTED_IN_RELEASE), и запланированная задача из спринта,
 * где другие уже уехали, показывала «v1.17.20 +2». Правило PU-07: у задачи — релиз,
 * в который уехал ЕЁ PR (CLOSED_BY → SHIPPED_IN); нет такого — колонка пуста.
 */
class TaskReleaseColumnTest {

    @ParameterizedTest
    @ValueSource(strings = {"open_tasks", "closed_tasks"})
    void taskReleaseIsReleaseOfItsOwnPr(String id) {
        LoreSlices.SliceDef def = LoreSlices.get(id);
        assertNotNull(def, id);
        String sql = def.baseSql();
        assertTrue(sql.contains("out('CLOSED_BY').out('SHIPPED_IN').release_id AS release_ids"),
            id + ": релиз задачи — через её PR");
        assertFalse(sql.contains("out('PART_OF').out('IMPLEMENTED_IN_RELEASE').release_id AS release_ids"),
            id + ": релизы спринта не выдаются за релиз задачи");
    }
}
