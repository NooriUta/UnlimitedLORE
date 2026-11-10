package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S9_SCALE_OPT/S9-01 (серверная половина) — итоги и значения фасетов
 * списка считает сервер по ВСЕЙ отфильтрованной выдаче, а не клиент по странице.
 *
 * <p>Форма оси — {@code Facet} из {@code kit/src/list/filterModel.ts}:
 * {@code {values:[{value,count}] по убыванию, empty, nonempty, total}}. Ось считается
 * по выдаче БЕЗ фильтра своей оси, но с прочими фильтрами и текстом. Многозначные
 * поля дают Σcount &gt; total — это контракт, а не ошибка. Несосчитанная ось — в
 * {@code unavailable} с причиной, а не нулём.
 */
class LoreListFacetsTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) if (kv[i + 1] != null) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, Object> body(List<Map<String, Object>> rows) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("rows", new ArrayList<>(rows));
        return b;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> values(Map<String, Object> facet) {
        return (List<Map<String, Object>>) facet.get("values");
    }

    @Test
    void ось_поУбываниюСчёта_приРавенстве_поЗначению_иПустые() {
        Map<String, Object> f = LoreListFacets.facet(List.of(
            row("sprint_id", "S2"), row("sprint_id", "S1"), row("sprint_id", "S2"),
            row("sprint_id", null), row("sprint_id", " "), row("sprint_id", "S3")), "sprint_id");
        assertEquals(List.of("values", "empty", "nonempty", "total"), List.copyOf(f.keySet()),
            "порядок ключей — как Facet в kit/src/list/filterModel.ts");
        List<Map<String, Object>> v = values(f);
        assertEquals(3, v.size());
        assertEquals(Map.of("value", "S2", "count", 2), v.get(0));
        assertEquals("S1", v.get(1).get("value"), "равный счёт — по значению");
        assertEquals("S3", v.get(2).get("value"));
        assertEquals(2, f.get("empty"), "null и пробелы — «пусто», а не значение");
        assertEquals(4, f.get("nonempty"));
        assertEquals(6, f.get("total"));
    }

    @Test
    void многозначноеПоле_каждыйЭлементОтдельно_суммаБольшеTotal() {
        Map<String, Object> f = LoreListFacets.facet(List.of(
            row("component_ids", List.of("ui", "api")),
            row("component_ids", List.of("ui")),
            row("component_ids", List.of()),
            row("component_ids", Arrays.asList("api", null))), "component_ids");
        List<Map<String, Object>> v = values(f);
        assertEquals(Map.of("value", "api", "count", 2), v.get(0));
        assertEquals(Map.of("value", "ui", "count", 2), v.get(1));
        assertEquals(1, f.get("empty"), "пустой массив — пусто");
        assertEquals(3, f.get("nonempty"));
        assertEquals(4, f.get("total"));
        int sum = v.stream().mapToInt(m -> (Integer) m.get("count")).sum();
        assertTrue(sum > (Integer) f.get("total"), "многозначное поле: Σcount > total — по контракту");
    }

    @Test
    void числаИЛогика_строкой() {
        Map<String, Object> f = LoreListFacets.facet(List.of(row("effort_days", 1.5), row("effort_days", 1.5)), "effort_days");
        assertEquals("1.5", values(f).get(0).get("value"));
    }

    @Test
    void осьСчитаетсяБезСвоегоФильтра_прочиеИТекстОстаются() {
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("sprint", "S1");
        filters.put("component", "ui");
        filters.put("project", "UnlimitedLORE");
        Map<String, String> forSprint = LoreListFacets.withoutAxis("open_tasks", filters, "sprint_id");
        assertEquals(Map.of("component", "ui", "project", "UnlimitedLORE"), forSprint,
            "ось sprint_id снимает фильтр sprint, не трогая прочих");
        Map<String, String> forComp = LoreListFacets.withoutAxis("open_tasks", filters, "component_ids");
        assertEquals(Map.of("sprint", "S1", "project", "UnlimitedLORE"), forComp);
        Map<String, String> forCat = LoreListFacets.withoutAxis("open_tasks", filters, "status_category");
        assertEquals(filters, forCat, "у оси без своего фильтра — все фильтры");
        assertEquals(3, filters.size(), "исходные фильтры не мутируются");

        Map<String, String> q = new LinkedHashMap<>(Map.of("q", "кэш"));
        assertEquals(q, LoreListFacets.withoutAxis("all_tasks", q, "sprint_id"), "текст q остаётся у каждой оси");
    }

    @Test
    void оси_проверяются_неизвестная400_категорияСтатусаРазрешена() {
        assertEquals(List.of("sprint_id", "component_ids", "status_category"),
            LoreListFacets.axes("open_tasks", "sprint_id, component_ids,status_category"));
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("open_tasks", "no_such_field"));
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("open_tasks", ""));
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("open_tasks", null));
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("releases", "status_category"),
            "status_category есть только у срезов со статусом");
        assertThrows(IllegalArgumentException.class, () -> LoreListFacets.axes("open_tasks", "title;DROP"));
    }

    @Test
    void закрытыеЗадачи_постраничныйСписок_несутКатегориюСтатуса() {
        // closed_tasks — первый постраничный потребитель серверных фасетов: без категории
        // статуса у него нет ни оси «статус», ни итогов по группе, ни /count.
        assertEquals(List.of("status_category"), LoreListFacets.axes("closed_tasks", "status_category"));
        assertEquals("status_category", LoreListFacets.defaultGroupBy("closed_tasks"));
        List<Map<String, Object>> rows = LoreStatusCategory.enrich("closed_tasks",
            List.of(row("status_raw", "✅ DONE"), row("status_raw", "🚫 CANCELLED")));
        assertEquals("finished", rows.get(0).get("status_category"));
        assertEquals("withdrawn", rows.get(1).get("status_category"));
    }

    @Test
    void собственныеПараметры_иСтраница_неФильтры() {
        Map<String, String> given = new LinkedHashMap<>();
        given.put("axes", "sprint_id");
        given.put("group_by", "work_class");
        given.put("limit", "50");
        given.put("offset", "100");
        given.put("fields", "task_uid");
        given.put("sprint", "S1");
        assertEquals(Map.of("sprint", "S1"), LoreListFacets.filtersOf(given),
            "страница и параметры фасетов в compose не уходят — считается вся выдача");
    }

    @Test
    void итоги_всеИПоГруппе_поУмолчаниюКатегорияСтатуса() {
        List<Map<String, Object>> rows = LoreStatusCategory.enrich("open_tasks", List.of(
            row("status_raw", "🔄 IN PROGRESS"), row("status_raw", "🔄 IN PROGRESS"),
            row("status_raw", "📋 PLANNED")));
        assertEquals("status_category", LoreListFacets.defaultGroupBy("open_tasks"));
        assertNull(LoreListFacets.defaultGroupBy("releases"));
        Map<String, Object> t = LoreListFacets.totals(rows, "status_category");
        assertEquals(List.of("all", "group_by", "by_group"), List.copyOf(t.keySet()));
        assertEquals(3, t.get("all"));
        assertEquals("status_category", t.get("group_by"));
        @SuppressWarnings("unchecked")
        Map<String, Integer> by = (Map<String, Integer>) t.get("by_group");
        assertEquals(2, by.get("in_progress"));
        assertEquals(1, by.get("not_started"));

        Map<String, Object> noGroup = LoreListFacets.totals(rows, null);
        assertEquals(3, noGroup.get("all"));
        assertNull(noGroup.get("by_group"));
    }

    @Test
    void сборка_неСосчитаннаяОсь_вUnavailable_аНеНоль() {
        Map<String, Object> base = body(List.of(row("sprint_id", "S1", "work_class", "uc")));
        Map<String, Map<String, Object>> perAxis = new LinkedHashMap<>();
        perAxis.put("work_class", base);
        perAxis.put("sprint_id", null);
        Map<String, String> errors = Map.of("sprint_id", "LORE_UPSTREAM: timeout");
        Map<String, Object> out = LoreListFacets.assemble("open_tasks", List.of("sprint_id", "work_class"),
            base, perAxis, errors, null, Map.of());
        @SuppressWarnings("unchecked")
        Map<String, Object> facets = (Map<String, Object>) out.get("facets");
        @SuppressWarnings("unchecked")
        Map<String, Object> unavailable = (Map<String, Object>) out.get("unavailable");
        assertFalse(facets.containsKey("sprint_id"), "несосчитанная ось не выдаётся пустой осью");
        assertEquals("LORE_UPSTREAM: timeout", unavailable.get("sprint_id"));
        assertTrue(facets.containsKey("work_class"));
        assertEquals("complete", out.get("completeness"));
        assertNull(out.get("cap"));
    }

    @Test
    void сборка_обрезаннаяЧасть_partial_иCapГоворитЧтоОбрезано() {
        Map<String, Object> base = body(List.of(row("sprint_id", "S1")));
        Map<String, Object> cut = body(List.of(row("sprint_id", "S1")));
        cut.put("truncated", true);
        cut.put("limit", 20000);
        Map<String, Map<String, Object>> perAxis = new LinkedHashMap<>();
        perAxis.put("sprint_id", cut);
        Map<String, String> filters = new LinkedHashMap<>(Map.of("sprint", "S1"));
        Map<String, Object> out = LoreListFacets.assemble("open_tasks", List.of("sprint_id"),
            base, perAxis, Map.of(), "status_category", filters);
        assertEquals("partial", out.get("completeness"));
        @SuppressWarnings("unchecked")
        Map<String, Object> cap = (Map<String, Object>) out.get("cap");
        assertEquals(List.of("sprint_id"), cap.get("parts"), "названо, какая часть обрезана");
        assertEquals(20000, cap.get("limit"));

        Map<String, Object> unk = body(List.of());
        unk.put("truncated", "unknown");
        Map<String, Object> out2 = LoreListFacets.assemble("open_tasks", List.of("sprint_id"),
            unk, Map.of("sprint_id", unk), Map.of(), null, Map.of());
        assertEquals("unknown", out2.get("completeness"));
        assertEquals(List.of("totals", "sprint_id"), ((Map<?, ?>) out2.get("cap")).get("parts"));
    }

    @Test
    void сборка_порядокКлючей_иФильтрыВОтвете() {
        Map<String, Object> base = body(List.of());
        Map<String, Object> scope = new LinkedHashMap<>(Map.of("applied", true));
        base.put("scope", scope);
        Map<String, Object> out = LoreListFacets.assemble("open_tasks", List.of("sprint_id"),
            base, Map.of("sprint_id", base), Map.of(), "status_category", Map.of("project", "X"));
        assertEquals(List.of("section", "axes", "facets", "unavailable", "totals", "scope", "filters",
            "completeness", "cap"), List.copyOf(out.keySet()));
        assertEquals("open_tasks", out.get("section"));
        assertEquals(scope, out.get("scope"));
        assertEquals(Map.of("project", "X"), out.get("filters"));
        @SuppressWarnings("unchecked")
        Map<String, Object> sprint = (Map<String, Object>) ((Map<String, Object>) out.get("facets")).get("sprint_id");
        assertEquals(0, sprint.get("total"), "пустая выдача — нули по оси, а не отсутствие оси");
    }

    @Test
    void эндпоинт_GET_slice_id_facets_естьВРесурсе() {
        boolean found = false;
        for (Method m : AidaLoreResource.class.getDeclaredMethods()) {
            Path p = m.getAnnotation(Path.class);
            if (p != null && "slice/{id}/facets".equals(p.value()) && m.isAnnotationPresent(GET.class)) found = true;
        }
        assertTrue(found, "GET /lore/slice/{id}/facets — серверные фасеты и итоги списка");
    }
}
