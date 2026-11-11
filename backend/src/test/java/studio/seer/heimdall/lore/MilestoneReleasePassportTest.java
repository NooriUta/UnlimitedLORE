package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Kit 09.11: паспорта вехи и релиза (только чтение) с вычисляемыми полями — «там нужны
 * именно вычисляемые поля, а не статусы». Считает сервер, форма {value, known, of}.
 */
class MilestoneReleasePassportTest {

    @Test
    void readOnlyTypesWithComputedTotals() {
        for (String t : List.of("milestone", "release"))
            assertTrue(LoreRecordRegistry.READ_ONLY.contains(t), t);
        Map<String, Object> types = LoreModelTypes.build(Map.of());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> mc = (List<Map<String, Object>>) ((Map<String, Object>) types.get("milestone")).get("computed");
        assertEquals(List.of("sprints_total"), mc.stream().map(c -> c.get("key")).toList());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rc = (List<Map<String, Object>>) ((Map<String, Object>) types.get("release")).get("computed");
        assertEquals(List.of("sprints_total", "prs_total"), rc.stream().map(c -> c.get("key")).toList());
    }

    @Test
    @SuppressWarnings("unchecked")
    void milestoneValuesCountSprints() {
        Map<String, Object> row = new HashMap<>();
        row.put("milestone_id", "M2");
        row.put("label", "Ядро");
        row.put("direct_sprint_ids", List.of("S1", "S2", "S3"));
        Map<String, Object> v = LoreRecordValues.values("milestone", row);
        assertEquals("Ядро", v.get("title"));
        assertEquals("M2", v.get("code"));
        assertFalse(v.containsKey("sprints_total"), "итоги не в values");
        assertEquals(Map.of("value", 3, "known", 3, "of", 3), LoreRecordValues.computed("milestone", row).get("sprints_total"));
    }

    @Test
    void releaseValuesCountSprintsAndPrs() {
        Map<String, Object> row = new HashMap<>();
        row.put("release_uid", "AIDA/UnlimitedLORE#v1.17.4");
        row.put("release_id", "v1.17.4");
        row.put("version", "1.17.4");
        row.put("sprint_count", 4);
        row.put("pr_count", 12);
        Map<String, Object> v = LoreRecordValues.values("release", row);
        assertEquals("v1.17.4", v.get("code"));
        assertFalse(v.containsKey("prs_total"), "итоги не в values");
        Map<String, Object> c = LoreRecordValues.computed("release", row);
        assertEquals(Map.of("value", 4, "known", 4, "of", 4), c.get("sprints_total"));
        assertEquals(Map.of("value", 12, "known", 12, "of", 12), c.get("prs_total"));
    }

    @Test
    void byIdSlicesExistAndAreClassified() {
        assertTrue(LoreSlices.compose("milestone_by_id", Map.of("id", "M2")).sql().contains("milestone_id = :id"));
        assertTrue(LoreSlices.compose("release_by_id", Map.of("id", "AIDA/X#v1")).sql().contains("release_uid = :id"));
        assertEquals(LoreSlices.PROJECT_SCOPED.get("releases"), LoreSlices.PROJECT_SCOPED.get("release_by_id"));
        assertNotNull(LoreSlices.SCOPE_PENDING.get("milestone_by_id"));
    }

    /**
     * Kit 09.11: ключ релиза — «проект#тег», в нём И слэши, И решётка. Клиент кодирует по
     * сегментам: NooriUta/UnlimitedLORE%23v1.17.4. Если решётку не закодировать, браузер
     * отрежет её как якорь — и до сервера дойдёт «NooriUta/UnlimitedLORE»: это должно быть
     * ОТКАЗОМ (400), а не тихой подменой записи.
     */
    @Test
    void releaseKeyWithSlashesAndHashIsExactOrRefused() {
        assertTrue(LoreRecordResource.RELEASE_UID.matcher("NooriUta/UnlimitedLORE#v1.17.4").matches());
        assertTrue(LoreRecordResource.RELEASE_UID.matcher("ivanovalex32/UDWE#v0.3.42").matches());
        assertFalse(LoreRecordResource.RELEASE_UID.matcher("NooriUta/UnlimitedLORE").matches(),
            "решётку отрезали — отказ, а не чужая запись");
        assertFalse(LoreRecordResource.RELEASE_UID.matcher("v1.17.4").matches(),
            "release_id повторяется у разных проектов — ключом не годится");
        assertFalse(LoreRecordResource.RELEASE_UID.matcher("A/B#v1#x").matches(), "одна решётка");
    }
}
