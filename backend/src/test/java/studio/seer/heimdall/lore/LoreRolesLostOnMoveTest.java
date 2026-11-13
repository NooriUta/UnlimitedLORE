package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** PU-17 шаг 3: свёртка строк среза в пары «перенос потерял роли» — точный признак, без угадывания. */
class LoreRolesLostOnMoveTest {

    static final String T = "2026-11-10T10:00:00.000Z";

    static Map<String, Object> row(String uid, String sprint, String title, String status, int roles, String openFrom,
                                   List<String> versions, String executor) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("task_uid", uid);
        m.put("title", title);
        m.put("sprint_id", sprint);
        m.put("status_raw", status);
        m.put("open_from", openFrom);
        m.put("version_froms", versions);
        m.put("open_roles", roles);
        m.put("executor", executor);
        return m;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> fold(List<Map<String, Object>> rows) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", new ArrayList<>(rows));
        LoreRolesLostOnMove.fold(out);
        return out;
    }

    @Test
    @SuppressWarnings("unchecked")
    void pairsByTitleAndSameMomentInAnotherSprint() {
        Map<String, Object> out = fold(List.of(
            row("A/1", "A", "задача", "🚫 CANCELLED", 2, T, List.of("2026-11-01T00:00:00Z", T), "dev"),
            row("B/1", "B", "задача", "📋 PLANNED", 0, T, List.of(T), null),
            // контроль: то же название, но другой момент — не перенос
            row("C/1", "C", "задача", "📋 PLANNED", 0, "2026-11-12T00:00:00Z", List.of("2026-11-12T00:00:00Z"), null),
            // контроль: тот же момент и название, но тот же спринт — не перенос
            row("A/2", "A", "задача", "📋 PLANNED", 0, T, List.of(T), null)));
        List<Map<String, Object>> rows = (List<Map<String, Object>>) out.get("rows");
        assertEquals(1, rows.size(), rows.toString());
        assertEquals("A/1", rows.get(0).get("from_task_uid"));
        assertEquals("B/1", rows.get(0).get("to_task_uid"));
        assertEquals("pair", rows.get(0).get("verdict"));
        assertEquals("dev", rows.get(0).get("executor"));
        Map<String, Object> checked = (Map<String, Object>) out.get("checked");
        assertEquals(1, checked.get("cancelled_with_roles"));
        assertEquals(1, checked.get("pairs"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void twoCandidatesAreAmbiguousAndNotAPair() {
        Map<String, Object> out = fold(List.of(
            row("A/1", "A", "x", "🚫 CANCELLED", 1, T, List.of(T), "dev"),
            row("B/1", "B", "x", "📋 PLANNED", 0, T, List.of(T), null),
            row("C/1", "C", "x", "📋 PLANNED", 0, T, List.of(T), null)));
        Map<String, Object> p = ((List<Map<String, Object>>) out.get("rows")).get(0);
        assertEquals("ambiguous", p.get("verdict"));
        assertNull(p.get("to_task_uid"), "неоднозначное не восстанавливается без разбора");
        assertEquals(List.of("B/1", "C/1"), p.get("candidates"));
        assertEquals(0, ((Map<String, Object>) out.get("checked")).get("pairs"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void notCancelledSourceWithRolesIsNotASource() {
        Map<String, Object> out = fold(List.of(
            row("A/1", "A", "x", "📋 PLANNED", 1, T, List.of(T), "dev"),
            row("B/1", "B", "x", "📋 PLANNED", 0, T, List.of(T), null)));
        assertTrue(((List<?>) out.get("rows")).isEmpty());
    }
}
