package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** S4-04: changed_at — максимум из открытой версии (DATETIME) и updated_at (строка ISO). */
class LoreChangedAtTest {

    private static Map<String, Object> row(Object changed, Object touched) {
        Map<String, Object> r = new HashMap<>();
        r.put("id", "X");
        r.put("changed_at", changed);
        r.put(LoreChangedAt.TOUCHED, touched);
        return r;
    }

    private static Map<String, Object> one(Map<String, Object> r) {
        List<Map<String, Object>> in = new ArrayList<>();
        in.add(r);
        Map<String, Object> out = LoreChangedAt.fold(in).get(0);
        assertFalse(out.containsKey(LoreChangedAt.TOUCHED), "служебная колонка наружу не выходит: " + out);
        return out;
    }

    @Test
    void laterInPlaceEdit_wins() {
        assertEquals("2026-11-10T12:00:00.500Z",
            one(row("2026-11-10 10:00:00.000", "2026-11-10T12:00:00.500Z")).get("changed_at"));
    }

    @Test
    void laterVersion_wins_overOlderEdit() {
        // Решение: правка полей (updated_at), потом смена статуса — версия позже.
        assertEquals("2026-11-10 12:00:00.000",
            one(row("2026-11-10 12:00:00.000", "2026-11-10T10:00:00Z")).get("changed_at"));
    }

    @Test
    void noEdit_keepsVersion_and_noVersion_takesEdit() {
        assertEquals("2026-11-10 12:00:00.000", one(row("2026-11-10 12:00:00.000", null)).get("changed_at"));
        assertEquals("2026-11-10T10:00:00.000Z", one(row(null, "2026-11-10T10:00:00Z")).get("changed_at"));
    }

    @Test
    void dateOnlyFallback_isComparable() {
        assertEquals("2026-11-10T10:00:00.000Z", one(row("2026-11-09", "2026-11-10T10:00:00Z")).get("changed_at"));
    }

    @Test
    void versionOpenedInTheSameMillisecond_afterTheEdit_wins() {
        // Замер CI 10.11: отметка правки 19:42:26.200587215Z, версия статуса — 19:42:26.200 (DATETIME, мс).
        assertEquals("2026-11-10 19:42:26.200",
            one(row("2026-11-10 19:42:26.200", "2026-11-10T19:42:26.200587215Z")).get("changed_at"));
    }

    @Test
    void unreadableTouched_doesNotWin_nor_break() {
        assertEquals("2026-11-10 12:00:00.000", one(row("2026-11-10 12:00:00.000", "вчера")).get("changed_at"));
    }

    @Test
    void rowsWithoutTheColumn_areUntouched() {
        Map<String, Object> r = new HashMap<>(Map.of("id", "Y", "changed_at", "2026-01-01"));
        assertTrue(LoreChangedAt.fold(List.of(r)).get(0) == r, "строка чужого среза не копируется");
    }

    @Test
    void sliceSql_carriesTouchedColumn() {
        for (String id : List.of("open_tasks", "closed_tasks", "specs", "adrs", "decisions", "sprints", "releases"))
            assertTrue(LoreSlices.get(id).baseSql().contains("updated_at AS " + LoreChangedAt.TOUCHED),
                id + ": changed_at без отметки правки на месте");
    }
}
