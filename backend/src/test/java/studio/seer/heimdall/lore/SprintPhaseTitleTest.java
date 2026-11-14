package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-22 — строка фазы в дереве задач спринта показывала «📋 PLANNED»
 * вместо названия и полный uid в «Код». Корень — не данные: срез phases_of_sprint сам отдавал
 * {@code status_raw AS title}, поэтому любое название фазы подменялось её статусом. Прогресс
 * «6/6» был верным; рядом с подменённым названием он выглядел противоречием.
 */
class SprintPhaseTitleTest {

    @Test
    void phaseTitleIsTheNameNotTheStatus() {
        String sql = LoreSlices.get("phases_of_sprint").baseSql();
        assertFalse(sql.contains("status_raw[0]  AS title") || sql.matches("(?s).*status_raw\\[0\\]\\s+AS title.*"),
            "статус фазы не может приходить полем title: " + sql);
        assertTrue(sql.contains("coalesce(title, name"), "название фазы — из title или name вершины: " + sql);
        assertTrue(sql.matches("(?s).*status_raw\\[0\\]\\s+AS status_raw.*"), "статус — своим полем: " + sql);
    }

    @Test
    void phaseItemCarriesTheShortCodeAndAComputedStatus() {
        Map<String, Object> row = new HashMap<>();
        row.put("phase_uid", "SPRINT_X/PHASE_A");
        row.put("phase_id", "Фаза A");
        row.put("title", "Разведка");
        Map<String, Object> done = Map.of("values", Map.of("phase_uid", "SPRINT_X/PHASE_A", "status", "done"));
        Map<String, Object> item = LoreRecordValues.phaseItem(row, List.of(done, done));
        @SuppressWarnings("unchecked") Map<String, Object> v = (Map<String, Object>) item.get("values");
        assertEquals("Разведка", v.get("title"));
        assertEquals("Фаза A", v.get("code"), "в «Код» — короткий код фазы, а не её uid");
        assertEquals("2/2", v.get("progress"));
        assertEquals("done", v.get("status"), "статус фазы — вычисленный по задачам, согласован с прогрессом");
    }

    @Test
    void phaseWithoutNameFallsBackToItsCode() {
        Map<String, Object> row = new HashMap<>();
        row.put("phase_uid", "SPRINT_X/PHASE_B");
        row.put("phase_id", "Фаза B");
        @SuppressWarnings("unchecked") Map<String, Object> v =
            (Map<String, Object>) LoreRecordValues.phaseItem(row, List.of()).get("values");
        assertEquals("Фаза B", v.get("title"));
        assertNull(v.get("status"), "задач нет — статуса не выдумываем");
    }
}
