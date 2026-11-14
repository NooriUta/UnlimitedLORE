package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-02: журнал действий админки для экрана —
 * GET /lore/admin/actions. Тот же ряд AO-01 (metric='lore.action'), что и срез
 * admin_actions, но с периодом (ts — LONG epoch millis, срез строковыми
 * параметрами его не отберёт) и с честной полнотой: сколько всего, обрезано ли.
 * Без живой базы: SQL, разбор параметров, тело ответа.
 */
class LoreAdminActionsTest {

    @Test
    void readsOnlyAdminFamiliesOfTheActionSeriesNewestFirst() {
        LoreAdminActions.Query q = LoreAdminActions.build(null, null, null, null, null, 50);
        assertTrue(q.sql().contains("FROM AgentActionLog"), q.sql());
        for (String f : LoreSlices.ADMIN_FAMILIES)
            assertTrue(q.sql().contains("'" + f + "'"), "семейство " + f + ": " + q.sql());
        assertTrue(q.sql().contains("ORDER BY ts DESC"), q.sql());
        assertTrue(q.sql().endsWith(" LIMIT 51"), "на одну строку больше — так видно, что обрезано: " + q.sql());
        assertTrue(q.countSql().contains("count(*)"), q.countSql());
        assertFalse(q.countSql().contains("ORDER BY") || q.countSql().contains("LIMIT"), q.countSql());
        assertTrue(q.params().isEmpty(), q.params().toString());
    }

    @Test
    void filtersByWhoWhatAndPeriodWithTypedParams() {
        LoreAdminActions.Query q = LoreAdminActions.build("omiloreadmin", "agent", "dict", 1000L, 2000L, 10);
        for (String s : new String[] {q.sql(), q.countSql()}) {
            assertTrue(s.contains("source = :caller"), s);
            assertTrue(s.contains("segment = :axis"), s);
            assertTrue(s.contains("object_type = :family"), s);
            assertTrue(s.contains("ts >= :from"), s);
            assertTrue(s.contains("ts <= :to"), s);
        }
        assertEquals(Map.of("caller", "omiloreadmin", "axis", "agent", "family", "dict",
            "from", 1000L, "to", 2000L), q.params());
    }

    @Test
    void periodAcceptsEpochMillisIsoInstantAndDate() {
        assertEquals(1730000000000L, LoreAdminActions.parseTime("from", "1730000000000", false));
        assertEquals(Instant.parse("2026-11-10T12:00:00Z").toEpochMilli(),
            LoreAdminActions.parseTime("from", "2026-11-10T12:00:00Z", false));
        assertEquals(Instant.parse("2026-11-10T00:00:00Z").toEpochMilli(),
            LoreAdminActions.parseTime("from", "2026-11-10", false));
        assertEquals(Instant.parse("2026-11-11T00:00:00Z").toEpochMilli() - 1,
            LoreAdminActions.parseTime("to", "2026-11-10", true), "to=дата — весь день включительно");
        assertNull(LoreAdminActions.parseTime("from", null, false));
        assertNull(LoreAdminActions.parseTime("from", " ", false));
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
            () -> LoreAdminActions.parseTime("from", "вчера", false));
        assertTrue(e.getMessage().contains("from"), e.getMessage());
    }

    @Test
    void unknownFamilyOrAxisIsRefusedByNameNotAnsweredEmpty() {
        // Опечатка в фильтре даёт 0 строк, неотличимые от «никто ничего не делал».
        IllegalArgumentException f = assertThrows(IllegalArgumentException.class,
            () -> LoreAdminActions.build(null, null, "task", null, null, 10));
        assertTrue(f.getMessage().contains("dict"), "отказ перечисляет допустимые: " + f.getMessage());
        IllegalArgumentException a = assertThrows(IllegalArgumentException.class,
            () -> LoreAdminActions.build(null, "robot", null, null, null, 10));
        assertTrue(a.getMessage().contains("human") && a.getMessage().contains("agent"), a.getMessage());
        assertThrows(IllegalArgumentException.class,
            () -> LoreAdminActions.build(null, null, null, 2000L, 1000L, 10), "from позже to");
    }

    @Test
    void limitDefaultsAndIsBounded() {
        assertEquals(LoreAdminActions.DEFAULT_LIMIT, LoreAdminActions.limitOf(null));
        assertEquals(5, LoreAdminActions.limitOf(5));
        assertThrows(IllegalArgumentException.class, () -> LoreAdminActions.limitOf(0));
        assertThrows(IllegalArgumentException.class, () -> LoreAdminActions.limitOf(LoreAdminActions.MAX_LIMIT + 1));
    }

    private static List<Map<String, Object>> rows(int n) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < n; i++) out.add(Map.of("ts", 1000L + i, "caller", "c" + i));
        return out;
    }

    @Test
    void bodySaysHowManyInTotalAndWhetherCut() {
        Map<String, Object> cut = LoreAdminActions.body(rows(4), 37L, 3);
        assertEquals(3, ((List<?>) cut.get("rows")).size(), "лишняя строка-маркер наружу не идёт");
        assertEquals(3, cut.get("shown"));
        assertEquals(37L, cut.get("total"));
        assertEquals(true, cut.get("truncated"));
        assertEquals(3, cut.get("limit"));

        Map<String, Object> full = LoreAdminActions.body(rows(2), 2L, 3);
        assertEquals(2, full.get("shown"));
        assertEquals(false, full.get("truncated"));
        assertEquals(2L, full.get("total"));
    }

    /**
     * S7B-13: запись журнала о пачке массовых правок несёт batch_id — по нему пачку
     * раскрывают (GET /lore/admin/actions/batch/{id}) и откатывают. У прочих записей
     * поле есть и равно null: «не пачка», а не «забыли отдать».
     */
    @Test
    void journalRowOfBatchCarriesItsBatchIdOthersSayNull() {
        String id = "rb-0000000001000-0000abcd";
        List<Map<String, Object>> out = LoreAdminActions.withBatch(List.of(
            Map.of("entity_id", id, "family", "user"),
            Map.of("entity_id", "SPRINT_X/CO-1", "family", "task")));
        assertEquals(id, out.get(0).get("batch_id"), out.toString());
        assertTrue(out.get(1).containsKey("batch_id") && out.get(1).get("batch_id") == null, out.toString());
        assertEquals("user", out.get(0).get("family"), "остальные поля строки на месте");
    }

    @Test
    void filtersByBatchIdAndRefusesWhatIsNotOne() {
        String id = "rb-0000000001000-0000abcd";
        LoreAdminActions.Query q = LoreAdminActions.build(null, null, null, id, null, null, 10);
        for (String s : new String[] {q.sql(), q.countSql()})
            assertTrue(s.contains("object_id = :batch"), s);
        assertEquals(Map.of("batch", id), q.params());
        assertThrows(IllegalArgumentException.class,
            () -> LoreAdminActions.build(null, null, null, "rb-garbage", null, null, 10));
    }

    @Test
    void totalThatCouldNotBeCountedIsSaidSoNotZero() {
        Map<String, Object> b = LoreAdminActions.body(rows(2), null, 3);
        assertTrue(b.containsKey("total") && b.get("total") == null, b.toString());
        assertEquals("unknown", b.get("total_state"), b.toString());
        // Счёт меньше показанного — счёту верить нельзя (count под нехваткой heap врёт).
        Map<String, Object> lie = LoreAdminActions.body(rows(4), 1L, 3);
        assertEquals("unknown", lie.get("total_state"), lie.toString());
        assertNull(lie.get("total"), lie.toString());
        assertEquals(true, lie.get("truncated"), "обрезку видно и без счёта");
        assertEquals("exact", LoreAdminActions.body(rows(1), 1L, 3).get("total_state"));
    }
}
