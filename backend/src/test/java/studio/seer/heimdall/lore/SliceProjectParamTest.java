package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-05, заметка 21.11.2026: «один параметр проекта у всех срезов и у find; прежнее
 * имя принимается с предупреждением в ответе; ключ проекта — короткий код 1.18, прежние «владелец/репо» — через
 * aliases». Повод: Mobilepoc не смогла отфильтровать ADR по проекту — срез {@code adrs} отвечал 400
 * «unknown param: project», а фильтр у него назывался {@code scope_projects}.
 *
 * <p>Каноническое имя — {@code project}: так параметр называется у ~40 срезов, его читает MCP (ADR-LORE-017,
 * подстановка LORE_ACTIVE_PROJECT) и паспорт проекта. {@code scope_projects} — прежнее имя выбора в шапке.
 */
class SliceProjectParamTest {

    private static final Map<String, String> KEYS = SliceProjectParam.keys(List.of(
        row("NooriUta/UnlimitedLORE", "LORE", List.of()),
        row("AIDA/miniLORE", "MINILORE", List.of("NooriUta/miniLORE"))));

    private static Map<String, Object> row(String slug, String code, List<String> aliases) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("slug", slug);
        r.put("short_code", code);
        r.put("aliases", aliases);
        return r;
    }

    private static Map<String, String> given(String... kv) {
        Map<String, String> g = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) g.put(kv[i], kv[i + 1]);
        return g;
    }

    /** Значение-заглушка обязательного параметра: проходит белый список и типизированные параметры. */
    private static String dummy(String sliceId, String param) {
        if (LoreSlices.isListParam(param)) return "X";
        String kind = LoreSlices.TYPED_PARAMS.getOrDefault(sliceId, Map.of()).get(param);
        if ("epoch_ms".equals(kind)) return "2026-11-01";
        if ("http_code".equals(kind)) return "500";
        return "X";
    }

    /** Сторож: у КАЖДОГО проектного среза параметр проекта называется project — и принимается, а не 400. */
    @Test
    void everyProjectSliceAcceptsProject() {
        List<String> refused = new ArrayList<>();
        for (String id : SliceProjectParam.projectSlices()) {
            Map<String, String> g = new LinkedHashMap<>();
            for (String req : LoreSlices.get(id).required()) if (!"project".equals(req)) g.put(req, dummy(id, req));
            g.put("project", "o/p");
            try {
                SliceProjectParam.normalize(id, g, Map.of());
                SliceProjectNarrowing.Result n = SliceProjectNarrowing.apply(id, g, null);
                LoreSlices.compose(id, g, n.scope());
            } catch (IllegalArgumentException e) {
                if (String.valueOf(e.getMessage()).startsWith("unknown param")) refused.add(id + ": " + e.getMessage());
            }
        }
        assertEquals(List.of(), refused, "проектный срез не принимает project: " + refused);
    }

    /** Реестр срезов (GET /lore/slices) объявляет project у каждого проектного среза — его читает MCP. */
    @Test
    void catalogDeclaresProjectForEveryProjectSlice() {
        List<String> missing = new ArrayList<>();
        for (String id : SliceProjectParam.projectSlices()) {
            LoreSlices.SliceDef def = LoreSlices.get(id);
            if (!def.required().contains("project") && !SliceProjectParam.catalogOptional(id).contains("project"))
                missing.add(id);
        }
        assertEquals(List.of(), missing);
        assertTrue(SliceProjectParam.projectSlices().contains("adrs"), "adrs — проектный срез");
        assertTrue(SliceProjectParam.catalogOptional("adrs").contains("project"));
        // Непроектный срез project не получает: сузить его нечем, и обещать фильтр нельзя.
        assertFalse(SliceProjectParam.catalogOptional("dictionary").contains("project"));
    }

    /** Боль из заметки: adrs?project= — сужение по проекту, а не 400. */
    @Test
    void adrsTakesProjectAsNarrowing() {
        Map<String, String> g = given("project", "AIDA/miniLORE");
        String warning = SliceProjectParam.normalize("adrs", g, KEYS);
        assertNull(warning);
        assertFalse(g.containsKey("project"), "срез adrs не знает project в SQL — уходит в сужение");
        assertEquals("AIDA/miniLORE", g.get(SliceProjectNarrowing.PARAM));
        SliceProjectNarrowing.Result n = SliceProjectNarrowing.apply("adrs", g, Set.of("AIDA/miniLORE", "o/x"));
        assertEquals(Set.of("AIDA/miniLORE"), n.scope());
    }

    /** Прежнее имя работает, но ответ говорит, что оно прежнее. */
    @Test
    void legacyScopeProjectsWorksWithWarning() {
        Map<String, String> g = given(SliceProjectNarrowing.PARAM, "AIDA/miniLORE");
        String warning = SliceProjectParam.normalize("adrs", g, KEYS);
        assertNotNull(warning);
        assertTrue(warning.contains("scope_projects") && warning.contains("project"), warning);
        assertEquals("AIDA/miniLORE", g.get(SliceProjectNarrowing.PARAM));
    }

    /** Оба имени сразу — пересечение, а не «победил кто-то один». */
    @Test
    void projectAndLegacyIntersect() {
        Map<String, String> g = given("project", "AIDA/miniLORE,NooriUta/UnlimitedLORE",
            SliceProjectNarrowing.PARAM, "NooriUta/UnlimitedLORE,o/x");
        SliceProjectParam.normalize("adrs", g, KEYS);
        assertEquals("NooriUta/UnlimitedLORE", g.get(SliceProjectNarrowing.PARAM));
    }

    /** Ключ проекта — короткий код; прежнее «владелец/репо» — через aliases. Регистр кода не важен. */
    @Test
    void shortCodeAndAliasResolveToTheKeyOfTheBase() {
        Map<String, String> g = given("project", "lore");
        SliceProjectParam.normalize("open_tasks", g, KEYS);
        assertEquals("NooriUta/UnlimitedLORE", g.get("project"), "open_tasks знает project сам — имя остаётся");

        Map<String, String> a = given("project", "NooriUta/miniLORE");
        SliceProjectParam.normalize("adrs", a, KEYS);
        assertEquals("AIDA/miniLORE", a.get(SliceProjectNarrowing.PARAM));

        Map<String, String> s = given(SliceProjectNarrowing.PARAM, "MINILORE,LORE");
        SliceProjectParam.normalize("adrs", s, KEYS);
        assertEquals("AIDA/miniLORE,NooriUta/UnlimitedLORE", s.get(SliceProjectNarrowing.PARAM));

        // Незнакомое — как есть: «нет такого проекта» скажет сам срез (пусто/скоуп), а не переводчик.
        Map<String, String> u = given("project", "o/unknown");
        SliceProjectParam.normalize("open_tasks", u, KEYS);
        assertEquals("o/unknown", u.get("project"));
    }

    /** Непроектный срез: project не переписывается — compose честно ответит unknown param. */
    @Test
    void nonProjectSliceIsLeftAlone() {
        Map<String, String> g = given("project", "LORE");
        assertNull(SliceProjectParam.normalize("dictionary", g, KEYS));
        assertEquals("LORE", g.get("project"));
    }
}
