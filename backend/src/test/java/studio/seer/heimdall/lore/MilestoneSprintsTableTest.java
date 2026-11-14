package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-05 (часть B) — у вехи «таблица детей» — её спринты с названием и
 * статусом. Раньше спринты вехи шли сырыми id из строки milestone_by_id (ROW_LINKS: название = id,
 * статус пуст), и таблица вехи показывала одни коды. Теперь — отдельный срез, как у компонента
 * (component_sprints): название, статус, под проектным скоупом спринтов.
 */
class MilestoneSprintsTableTest {

    @Test
    void milestoneSprintsSliceCarriesTitleAndStatusAndIsProjectScoped() {
        LoreSlices.SliceDef d = LoreSlices.get("milestone_sprints");
        assertNotNull(d, "срез спринтов вехи заведён");
        String sql = d.baseSql();
        assertTrue(sql.contains("out('TARGETS_MILESTONE').milestone_id CONTAINS :mid"), sql);
        assertTrue(sql.contains("name") && sql.contains("status_raw"), "название и статус спринта: " + sql);
        assertEquals(List.of("mid"), d.required());
        assertEquals(LoreSlices.PROJECT_SCOPED.get("component_sprints"), LoreSlices.PROJECT_SCOPED.get("milestone_sprints"),
            "спринты вехи — под тем же проектным скоупом, что спринты компонента");
    }

    @Test
    void milestoneSprintsTabIsReadBySliceNotFromRowIds() {
        assertEquals("milestone_sprints", LoreRecordValues.READ_BY_SLICE.get("milestone").get("sprints"));
        Map<String, Object> row = new HashMap<>();
        row.put("milestone_id", "M2");
        row.put("direct_sprint_ids", List.of("S1", "S2"));
        row.put("feature_ids", List.of("UC-1"));
        List<Map<String, Object>> links = LoreRecordValues.rowLinks("milestone", row);
        assertTrue(links.stream().noneMatch(l -> "sprint".equals(l.get("type"))),
            "спринты вехи не из сырых id строки (там нет ни названия, ни статуса): " + links);
        assertTrue(links.stream().anyMatch(l -> "UC-1".equals(l.get("id"))), "фичи вехи — по-прежнему из строки");
    }

    @Test
    void sliceRowBecomesAFullLink() {
        LoreRecordFrom.SliceLink sl = LoreRecordFrom.SLICE_LINKS.get("milestone").stream()
            .filter(s -> s.key().equals("sprints")).findFirst().orElseThrow();
        Map<String, Object> link = LoreRecordFrom.sliceLink(sl,
            Map.of("sprint_id", "SPRINT_X", "name", "Ядро", "status_raw", "🔄 IN PROGRESS"));
        assertEquals("SPRINT_X", link.get("id"));
        assertEquals("Ядро", link.get("title"));
        assertEquals("sprint", link.get("type"));
        assertNotNull(link.get("status"), "статус спринта есть — не пустая ячейка");
        assertEquals("TARGETS_MILESTONE", link.get("rel"));
        assertEquals("in", link.get("dir"));
    }
}
