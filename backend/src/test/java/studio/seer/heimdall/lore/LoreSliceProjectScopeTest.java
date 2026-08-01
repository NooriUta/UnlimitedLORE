package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AL-94: компоновка read-скоупа поверх слайсов — чистая, без БД и HTTP.
 *
 * <p>Проверяется то, что ломается молча: условие должно вставать ПЕРЕД
 * ORDER BY/LIMIT (иначе синтаксическая ошибка на проде, а не пустая выдача),
 * связываться с уже существующими фильтрами через AND, а пустой скоуп —
 * давать заведомо ложное условие, а не «показать всё».</p>
 */
class LoreSliceProjectScopeTest {

    private static Set<String> set(String... xs) {
        return new LinkedHashSet<>(java.util.Arrays.asList(xs));
    }

    @Test
    void нетСкоупа_запросНеТрогается() {
        var withNull = LoreSlices.compose("sprints", Map.of(), null);
        var plain    = LoreSlices.compose("sprints", Map.of());
        assertEquals(plain.sql(), withNull.sql());
        assertEquals(plain.params(), withNull.params());
    }

    @Test
    void слайсВнеСпискаНеСкоупируется() {
        // dictionary не несёт проектной оси — скоуп к нему не применяется даже
        // при непустом множестве (иначе получили бы пустой справочник статусов).
        var c = LoreSlices.compose("dictionary", Map.of(), set("NooriUta/UnlimitedLORE"));
        assertFalse(c.sql().contains("__scope"));
    }

    @Test
    void условиеСтоитПередOrderByИLimit() {
        var c = LoreSlices.compose("docs", Map.of(), set("NooriUta/UnlimitedLORE"));
        int scopeAt = c.sql().indexOf("__scope0");
        int orderAt = c.sql().indexOf("ORDER BY");
        assertTrue(scopeAt > 0, "условие скоупа должно присутствовать");
        assertTrue(orderAt > scopeAt, "скоуп обязан стоять ДО ORDER BY/LIMIT, иначе это невалидный SQL");
        assertTrue(c.sql().trim().endsWith("LIMIT 200"), "хвост слайса сохраняется целиком");
    }

    @Test
    void несколькоПроектовДаютORАПараметрыСвязываются() {
        var c = LoreSlices.compose("adrs", Map.of(), set("org/a", "org/b"));
        assertTrue(c.sql().contains(":__scope0 OR"), "пересечение проектов = ИЛИ, не И");
        assertEquals("org/a", c.params().get("__scope0"));
        assertEquals("org/b", c.params().get("__scope1"));
    }

    @Test
    void пустойСкоупНеПоказываетНичего() {
        var c = LoreSlices.compose("releases", Map.of(), Set.of());
        assertEquals(LoreSlices.SCOPE_NONE, c.params().get("__scope0"),
            "пустой скоуп — заведомо ложное условие, а не отсутствие фильтра");
        // Ровно одно условие-заглушка: альтернатив (:__scope1) быть не должно.
        assertFalse(c.sql().contains("__scope1"), "одно условие-заглушка, без альтернатив");
    }

    @Test
    void скоупСоединяетсяССуществующимФильтромЧерезAND() {
        var c = LoreSlices.compose("sprints", Map.of("project", "org/a"), set("org/a"));
        assertTrue(c.sql().contains(" AND "), "явный project-фильтр и скоуп должны сосуществовать");
        assertEquals("org/a", c.params().get("project"));
        assertEquals("org/a", c.params().get("__scope0"));
    }

    @Test
    void скоупируемыеСлайсыВсеЗнаютПроСвоёРебро() {
        for (var e : LoreSlices.PROJECT_SCOPED.entrySet()) {
            assertNotNull(LoreSlices.get(e.getKey()), "слайс " + e.getKey() + " должен существовать");
            assertTrue(e.getValue().contains("BELONGS_TO_PROJECT"),
                "скоуп " + e.getKey() + " обязан идти по ребру проекта");
        }
    }
}
