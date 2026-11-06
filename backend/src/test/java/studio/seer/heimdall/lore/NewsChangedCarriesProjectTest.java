package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелец 05.11.2026, лента «без проекта»: ADR-HND-016 и SPEC-SECRETS-001
 * с ребром BELONGS_TO_PROJECT показывались как «изменено» без проекта.
 *
 * <p>Причина: проект для события «изменено» брался из карты, которую
 * заполняют срезы «появилось» — а те обрезаны (timeline_adrs: 150 новейших,
 * timeline_specs: 400 без порядка). Старую сущность, исправленную сегодня,
 * карта не знала. Теперь строка истории несёт проект своей вершины сама.
 */
class NewsChangedCarriesProjectTest {

    @Test
    void historySlicesCarryTheOwnersProject() {
        for (String s : List.of("adr_history_all", "spec_history_all")) {
            String sql = LoreSlices.compose(s, Map.of()).sql();
            assertTrue(sql.contains("in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects"), s + ": " + sql);
        }
    }

    @Test
    void changedEventTakesProjectFromTheHistoryRowWhenTheCreatedMapMissesIt() {
        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Object> row = new HashMap<>();
        row.put("adr_id", "ADR-HND-016");
        row.put("valid_from", "2026-11-05 08:42:00");
        row.put("projects", List.of("NooriUta/AIDA"));
        AidaLoreResource.emitChanged(items, List.of(row), "adr_id", "adr",
            Map.of(), null, Map.of(), new HashSet<>());
        assertEquals(1, items.size());
        assertEquals(List.of("NooriUta/AIDA"), AidaLoreResource.projectList(items.get(0).get("projects")),
            "правка старого ADR не должна падать в «без проекта»: " + items.get(0));
    }

    @Test
    void mapStillServesRowsWithoutOwnProject() {
        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Object> row = new HashMap<>();
        row.put("decision_id", "D-X");
        row.put("valid_from", "2026-11-05 10:00:00");
        AidaLoreResource.emitChanged(items, List.of(row), "decision_id", "decision",
            Map.of(), null, Map.of("D-X", List.of("org/a")), new HashSet<>());
        assertEquals(List.of("org/a"), AidaLoreResource.projectList(items.get(0).get("projects")));
    }
}
