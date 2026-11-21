package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · «Готово, когда на препроде лог даёт топ шаблонов по суммарному времени».
 * Фильтр клиента (SlowQueryClientFilter) уже пишет медленные вызовы по одному; здесь — сводка по ВСЕМ вызовам:
 * шаблон запроса → число вызовов, суммарное и наибольшее время, источник, доля чтений и записей. Раз в интервал
 * строка [LORE SLOW-QUERY TOP] с первыми N по суммарному времени.
 */
class SlowQueryStatsTest {

    @Test
    void topByTotalTime() {
        SlowQueryStats s = new SlowQueryStats(100);
        s.record("SELECT FROM KnowTask WHERE task_uid = ?", "GET /lore/slice/{id}:tasks_by_uids", "read", 40);
        s.record("SELECT FROM KnowTask WHERE task_uid = ?", "GET /lore/slice/{id}:tasks_by_uids", "read", 60);
        s.record("UPDATE KnowPR SET title = ? WHERE pr_uid = ?", "POST /lore/forgejo/pr/merge", "write", 500);
        s.record("SELECT count(*) FROM KnowSprint", "background", "read", 5);
        List<SlowQueryStats.Row> top = s.top(2);
        assertEquals(2, top.size());
        assertEquals("UPDATE KnowPR SET title = ? WHERE pr_uid = ?", top.get(0).template());
        assertEquals(500, top.get(0).totalMs());
        assertEquals("SELECT FROM KnowTask WHERE task_uid = ?", top.get(1).template());
        assertEquals(2, top.get(1).count());
        assertEquals(100, top.get(1).totalMs());
        assertEquals(60, top.get(1).maxMs());
        assertEquals("GET /lore/slice/{id}:tasks_by_uids", top.get(1).source());
        assertEquals(3, s.reads());
        assertEquals(1, s.writes());
    }

    @Test
    void reportLineIsTemplateOnlyAndSorted() {
        SlowQueryStats s = new SlowQueryStats(100);
        s.record("SELECT FROM KnowADR WHERE adr_id = ?", "GET /lore/record/{type}/{id}", "read", 900);
        s.record("SELECT FROM KnowDoc", "background", "read", 1);
        String r = s.report(5);
        assertTrue(r.startsWith("[LORE SLOW-QUERY TOP] вызовов 2 · чтений 2 · записей 0"), r);
        assertTrue(r.indexOf("KnowADR") < r.indexOf("KnowDoc"), "по убыванию суммарного времени: " + r);
        assertTrue(r.contains("900 ms · 1 выз · макс 900 ms"), r);
    }

    /** Шаблонов не больше предела: самый «лёгкий» по суммарному времени вытесняется, память не растёт без края. */
    @Test
    void capEvictsLightest() {
        SlowQueryStats s = new SlowQueryStats(2);
        s.record("A", "x", "read", 10);
        s.record("B", "x", "read", 20);
        s.record("C", "x", "read", 30);
        assertEquals(List.of("C", "B"), s.top(10).stream().map(SlowQueryStats.Row::template).toList());
        assertEquals(1, s.evicted());
    }

    /** Строка сводки — раз в интервал, не на каждый вызов. */
    @Test
    void emitOncePerInterval() {
        SlowQueryStats s = new SlowQueryStats(10);
        assertFalse(s.dueAt(0, 60_000), "первый вызов только запускает отсчёт");
        assertFalse(s.dueAt(30_000, 60_000));
        assertTrue(s.dueAt(60_000, 60_000));
        assertFalse(s.dueAt(61_000, 60_000), "следующая — через интервал");
        assertTrue(s.dueAt(121_000, 60_000));
    }
}
