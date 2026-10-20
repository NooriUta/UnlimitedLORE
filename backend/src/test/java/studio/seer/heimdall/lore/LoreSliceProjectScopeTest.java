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
        // Хвост среза сохраняется целиком, каким бы он ни был. Раньше здесь
        // стояло endsWith("LIMIT 200") — проверка «вставка не съела хвост»
        // оказалась привязана к КОНКРЕТНОМУ потолку и упала, когда потолки
        // сняли (решение владельца 30.08.2026: необоснованные лимиты убрать).
        // Проверяем то, ради чего проверка написана: хвост на месте.
        assertTrue(c.sql().trim().endsWith(LoreSlices.get("docs").suffix().trim()),
            "хвост слайса сохраняется целиком");
    }

    /**
     * AL-120 (20.10.2026): то же правило — по КАЖДОМУ проектному срезу, а не по
     * одному {@code docs}.
     *
     * <p>{@code compose()} вставляет условие скоупа перед хвостом среза, а хвост
     * узнаёт ТОЛЬКО из поля {@code suffix}. Срез, у которого {@code ORDER BY}
     * записан прямо в теле SQL при пустом {@code suffix}, получает условие ПОСЛЕ
     * сортировки — «… ORDER BY decision_id AND (…)» — и ArcadeDB отвечает
     * ошибкой разбора, наружу это 502. Так и нашлось: живой тест под включённым
     * {@code lore.scope.enforce} получил 502 на {@code decisions_of_adr}, то есть
     * паспорт ADR сломался бы у всех, кроме superadmin, в момент включения флага.
     *
     * <p>Проверка на одном срезе ({@code docs}, выше) этот случай не видела по
     * построению: у {@code docs} хвост лежит в {@code suffix}, как положено.
     * Правило формы «у каждого» проверяется только перебором каждого.
     */
    @Test
    void условиеСкоупаСтоитПередХвостомУКаждогоПроектногоСреза() {
        java.util.List<String> broken = new java.util.ArrayList<>();
        for (String id : LoreSlices.PROJECT_SCOPED.keySet()) {
            var def = LoreSlices.get(id);
            Map<String, String> given = new java.util.HashMap<>();
            for (String r : def.required()) given.put(r, "x");
            String sql = LoreSlices.compose(id, given, set("org/a")).sql();
            int scopeAt = sql.lastIndexOf(":__scope");
            if (scopeAt < 0) { broken.add(id + " — условия скоупа нет вовсе"); continue; }
            // Всё, что идёт ПОСЛЕ условия скоупа, — хвост. Ни одного ключевого
            // слова хвоста ДО условия на верхнем уровне быть не должно; проверяем
            // грубо, но надёжно: после условия хвост обязан встретиться, если он
            // есть в запросе вообще.
            for (String tail : new String[] {" ORDER BY ", " LIMIT ", " GROUP BY "}) {
                int lastTail = sql.lastIndexOf(tail);
                if (lastTail >= 0 && lastTail < scopeAt)
                    broken.add(id + " — «" + tail.trim() + "» стоит ДО условия скоупа");
            }
        }
        assertEquals(java.util.List.of(), broken,
            "условие скоупа дописывается после хвоста — под включённым скоупом эти срезы "
            + "отдают ошибку разбора (502). Вынесите хвост из тела SQL в suffix среза.");
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
