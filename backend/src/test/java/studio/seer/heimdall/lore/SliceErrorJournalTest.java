package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-12, шаг 7 по [[ADR-LORE-061]]: ошибки GET-срезов считаются.
 * До правки журнал брал только изменяющие вызовы (LoreRequestStatsFilter → isJournalled), и отказ
 * среза (400 UNKNOWN_FIELD, 403, 404 UNKNOWN_SLICE, 5xx) не оставлял следа — «сколько агентов
 * спотыкаются о срезы» было не посчитать.
 */
class SliceErrorJournalTest {

    @Test
    void изменяющийВызовПишетсяКакРаньше() {
        assertTrue(LoreRequestStats.journalledCall("POST", "task", 200));
        assertTrue(LoreRequestStats.journalledCall("DELETE", "doc", 404));
    }

    @Test
    void отказСрезаПишется() {
        for (int code : new int[]{400, 403, 404, 422, 500, 502}) assertTrue(LoreRequestStats.journalledCall("GET", "slice", code), "код " + code);
    }

    @Test
    void удачноеЧтениеИЧужиеGetНеПишутся() {
        assertFalse(LoreRequestStats.journalledCall("GET", "slice", 200), "удачный срез — не журнал действий");
        assertFalse(LoreRequestStats.journalledCall("GET", "slice", 304));
        assertFalse(LoreRequestStats.journalledCall("GET", "task", 404), "ADR-061 считает ошибки срезов, не всех GET");
    }

    @Test
    void срезQueryErrorsЕстьИТолькоДляАдмина() {
        LoreSlices.SliceDef d = LoreSlices.get("query_errors");
        assertNotNull(d, "срез query_errors");
        String sql = d.baseSql() + d.suffix();
        assertTrue(sql.contains("object_type = 'slice'") && sql.contains("value >= 400"), sql);
        assertTrue(LoreSlices.ADMIN_ONLY.contains("query_errors"), "журнал ошибок — служебный, только админка");
        assertEquals(Set.of("caller", "since", "slice", "code"), d.optionalFilters().keySet());
    }
}
