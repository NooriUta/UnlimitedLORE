package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-12, шаг 1 (ADR-LORE-061): язык отбора над строками среза — грамматика,
 * проверка полей по описанию среза (UNKNOWN_FIELD со списком), операторы in / not_in / range / empty / contains
 * и сравнения, and / or / not; страницы limit 1..3000 + page с total / has_more; потолок просмотра 20 000
 * (выше — complete:false).
 */
class SliceQueryTest {

    private static final Set<String> FIELDS = Set.of("task_uid", "status", "effort_days", "changed_at", "component_ids", "title");

    private static Map<String, Object> row(String uid, String status, Double effort, String changed, List<String> comps, String title) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("task_uid", uid);
        r.put("status", status);
        r.put("effort_days", effort);
        r.put("changed_at", changed);
        r.put("component_ids", comps);
        r.put("title", title);
        return r;
    }

    private static final List<Map<String, Object>> ROWS = List.of(
        row("S/A-1", "active", 1.0, "2026-11-20T10:00:00Z", List.of("LORE"), "Срез задач"),
        row("S/A-2", "planned", 0.5, "2026-11-21T10:00:00Z", List.of("OMILORE"), "Миниапп Forgejo"),
        row("S/A-3", "done", null, "2026-11-22T10:00:00Z", List.of(), "Экспорт модели"),
        row("S/A-4", "blocked", 3.0, "2026-11-25T10:00:00Z", List.of("LORE", "OMILORE"), "Язык отбора"));

    private static List<String> uids(SliceQuery.Result r) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> x : r.rows()) out.add(String.valueOf(x.get("task_uid")));
        return out;
    }

    private static Map<String, Object> cond(String field, String op, Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("op", op);
        if (value != null) m.put("value", value);
        return m;
    }

    private static SliceQuery.Result run(Object... conds) {
        return SliceQuery.apply(ROWS, Map.of("where", List.of(conds)), FIELDS, true);
    }

    @Test
    void in_иNotIn_несколькоЗначений() {
        assertEquals(List.of("S/A-1", "S/A-4"), uids(run(cond("status", "in", List.of("active", "blocked")))));
        assertEquals(List.of("S/A-2", "S/A-3"), uids(run(cond("status", "not_in", List.of("active", "blocked")))));
    }

    @Test
    void in_поСписочномуПолю_любоеСовпадение() {
        assertEquals(List.of("S/A-2", "S/A-4"), uids(run(cond("component_ids", "in", List.of("OMILORE")))));
    }

    @Test
    void range_поЧислуИДате_краяВключены_одинКрайМожноОпустить() {
        assertEquals(List.of("S/A-1", "S/A-2"), uids(run(cond("effort_days", "range", Map.of("from", 0.5, "to", 1.0)))));
        assertEquals(List.of("S/A-3", "S/A-4"), uids(run(cond("changed_at", "range", Map.of("from", "2026-11-22")))));
    }

    @Test
    void empty_пустоеИНеПустое() {
        assertEquals(List.of("S/A-3"), uids(run(cond("effort_days", "empty", true))));
        assertEquals(List.of("S/A-3"), uids(run(cond("component_ids", "empty", true))), "пустой список — пусто");
        assertEquals(3, run(cond("effort_days", "empty", false)).total());
    }

    @Test
    void contains_безРегистра_иКириллица() {
        assertEquals(List.of("S/A-2"), uids(run(cond("title", "contains", "forgejo"))));
        assertEquals(List.of("S/A-4"), uids(run(cond("title", "contains", "ОТБОР"))));
    }

    @Test
    void andOrNot() {
        Map<String, Object> or = Map.of("or", List.of(cond("status", "=", "done"), cond("effort_days", ">", 2)));
        assertEquals(List.of("S/A-3", "S/A-4"), uids(run(or)));
        Map<String, Object> not = Map.of("not", cond("status", "in", List.of("done", "blocked")));
        assertEquals(List.of("S/A-1", "S/A-2"), uids(run(not)));
    }

    @Test
    void неописанноеПоле_отказСоСпискомРазрешённых() {
        SliceQuery.Refusal e = assertThrows(SliceQuery.Refusal.class, () -> run(cond("secret", "=", "x")));
        assertEquals("UNKNOWN_FIELD", e.code());
        assertTrue(e.allowed().containsAll(FIELDS), String.valueOf(e.allowed()));
    }

    @Test
    void неизвестныйОператор_иПлохиеЗначения_отказ() {
        assertEquals("BAD_OP", assertThrows(SliceQuery.Refusal.class, () -> run(cond("status", "like", "a"))).code());
        assertEquals("BAD_VALUE", assertThrows(SliceQuery.Refusal.class, () -> run(cond("status", "in", "active"))).code(),
            "in — только список");
        assertEquals("BAD_VALUE", assertThrows(SliceQuery.Refusal.class, () -> run(cond("effort_days", "range", 5))).code(),
            "range — объект {from, to}");
    }

    @Test
    void страницы_limitPage_totalHasMore() {
        SliceQuery.Result p1 = SliceQuery.apply(ROWS, Map.of("limit", 3, "page", 1), FIELDS, true);
        assertEquals(List.of("S/A-1", "S/A-2", "S/A-3"), uids(p1));
        assertEquals(4, p1.total());
        assertTrue(p1.hasMore());
        SliceQuery.Result p2 = SliceQuery.apply(ROWS, Map.of("limit", 3, "page", 2), FIELDS, true);
        assertEquals(List.of("S/A-4"), uids(p2));
        assertFalse(p2.hasMore());
    }

    @Test
    void limit_вПределах1_3000() {
        assertEquals("BAD_PARAMS", assertThrows(SliceQuery.Refusal.class,
            () -> SliceQuery.apply(ROWS, Map.of("limit", 3001), FIELDS, true)).code());
        assertEquals("BAD_PARAMS", assertThrows(SliceQuery.Refusal.class,
            () -> SliceQuery.apply(ROWS, Map.of("limit", 0), FIELDS, true)).code());
        assertEquals(SliceQuery.DEFAULT_LIMIT, SliceQuery.apply(ROWS, Map.of(), FIELDS, true).limit());
    }

    @Test
    void шаг2_whereСтрокойJson_дляGetСреза() {
        List<Object> where = SliceQuery.parseWhere("[{\"field\":\"status\",\"op\":\"in\",\"value\":[\"active\",\"blocked\"]}]");
        SliceQuery.Filtered f = SliceQuery.filter(ROWS, where, FIELDS);
        assertEquals(List.of("S/A-1", "S/A-4"), f.rows().stream().map(r -> String.valueOf(r.get("task_uid"))).toList());
        assertEquals(2, f.matched());
        assertTrue(f.complete());
        assertEquals(1, SliceQuery.parseWhere("{\"field\":\"status\",\"op\":\"=\",\"value\":\"done\"}").size(), "одно условие объектом");
        assertEquals(null, SliceQuery.parseWhere(" "), "пусто — отбора нет");
        assertEquals("BAD_PARAMS", assertThrows(SliceQuery.Refusal.class, () -> SliceQuery.parseWhere("status=active")).code());
        assertEquals("UNKNOWN_FIELD", assertThrows(SliceQuery.Refusal.class,
            () -> SliceQuery.filter(ROWS, SliceQuery.parseWhere("[{\"field\":\"secret\",\"op\":\"=\",\"value\":1}]"), FIELDS)).code());
    }

    @Test
    void потолокПросмотра20000_completeFalse() {
        List<Map<String, Object>> many = new ArrayList<>();
        for (int i = 0; i < SliceQuery.SCAN_CAP + 5; i++) many.add(row("S/X-" + i, "active", 1.0, "2026-11-20", List.of(), "t"));
        SliceQuery.Result r = SliceQuery.apply(many, Map.of("limit", 10), FIELDS, true);
        assertFalse(r.complete(), "просмотрено не всё — честно complete:false");
        assertEquals(SliceQuery.SCAN_CAP, r.total(), "total — по просмотренным");
        assertTrue(SliceQuery.apply(ROWS, Map.of(), FIELDS, true).complete());
        assertFalse(SliceQuery.apply(ROWS, Map.of(), FIELDS, false).complete(), "срез сам обрезан — не complete");
    }
}
