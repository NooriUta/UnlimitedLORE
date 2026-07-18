package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-17: вторая ось RBAC. Тест пинует ровно то, что ломается тихо.
 */
class AgentScopeFilterTest {

    // ── Разбор пути ──────────────────────────────────────────────────────────
    // Ошибка здесь не даёт отказа — она даёт МОЛЧАЛИВЫЙ ПРОПУСК: семейство не
    // распозналось, значит проверять нечего, значит пишет кто угодно.

    @Test
    void семействоБерётсяИзПервогоСегментаПослеLore() {
        assertEquals("task", AgentScopeFilter.familyOf("/lore/task"));
        assertEquals("task", AgentScopeFilter.familyOf("lore/task/link"));
        assertEquals("adr", AgentScopeFilter.familyOf("/lore/adr/new"));
        assertEquals("kc", AgentScopeFilter.familyOf("/lore/kc/users"));
    }

    @Test
    void чужиеПутиНеТрогаем() {
        assertNull(AgentScopeFilter.familyOf("/api/v1/ready"));
        assertNull(AgentScopeFilter.familyOf("/bench/mart/slice/x"));
        assertNull(AgentScopeFilter.familyOf("/lore"));
        assertNull(AgentScopeFilter.familyOf(null));
    }

    // ── Содержание матрицы ───────────────────────────────────────────────────

    @Test
    void словариИучёткиЗакрытыДляАгентовСовсем() {
        assertEquals(Set.of("dict", "kc"), AgentScopeFilter.humanOnlyFamilies());
    }

    @Test
    void fullПрисутствуетВоВсехСемействах() {
        // Профиль full — «полный доступ». Если он выпал хоть из одной строки,
        // сессия, работающая под ним, упрётся в 403 на ровном месте.
        for (String f : AgentScopeFilter.enforcedFamilies()) {
            assertTrue(allowedFor(f).contains("full"), "full должен писать в " + f);
        }
    }

    @Test
    void узкиеПрофилиНеПишутВЧужиеСемейства() {
        assertTrue(!allowedFor("adr").contains("marketer"), "маркетолог не правит ADR");
        assertTrue(!allowedFor("release").contains("marketer"), "маркетолог не выпускает релизы");
        assertTrue(!allowedFor("qg").contains("pm"), "PM не трогает quality gates");
        assertTrue(!allowedFor("sprint").contains("tester"), "тестировщик не правит спринты");
    }

    /**
     * Матрица бэкенда — копия таблицы в админ-панели. Копии расходятся молча:
     * UI показывает одни права, применяются другие, и заметно это только когда
     * агент упрётся в отказ, которого «по интерфейсу быть не должно».
     *
     * Тест сверяет пересечение — те семейства, что перечислены в обеих таблицах.
     * Строки UI, которых нет в бэкенде (feature/uc/…), намеренно вне проверки:
     * они пропускаются фильтром и это задокументировано.
     */
    @Test
    void матрицаБэкендаСовпадаетСТаблицейАдминПанели() throws Exception {
        Path tsx = Path.of("../src/components/lore/LoreAdminPanel.tsx");
        if (!Files.exists(tsx)) return;   // тест запущен вне монорепозитория — не падаем
        String src = Files.readString(tsx);

        Matcher m = Pattern.compile(
            "api:\\s*'([^']*)'[^}]*?agents:\\s*\\[([^\\]]*)\\]", Pattern.DOTALL).matcher(src);
        int checked = 0;
        while (m.find()) {
            String api = m.group(1);
            Set<String> uiAgents = Set.of(m.group(2).split("\\s*,\\s*")).stream()
                .map(s -> s.replace("'", "").trim()).filter(s -> !s.isEmpty())
                .collect(java.util.stream.Collectors.toSet());
            if (uiAgents.contains("все агенты")) continue;   // строка про чтение

            for (String family : familiesFromApiCell(api)) {
                Set<String> backend = allowedFor(family);
                if (backend.isEmpty()) continue;             // семейства нет в бэкенд-таблице
                assertEquals(uiAgents, backend,
                    "права на '" + family + "' разошлись: UI=" + uiAgents + " бэкенд=" + backend);
                checked++;
            }
        }
        assertTrue(checked >= 5, "сверено слишком мало строк (" + checked + ") — регулярка перестала попадать в таблицу");
    }

    /** "/lore/adr*, /lore/decision*" → [adr, decision] */
    private static List<String> familiesFromApiCell(String cell) {
        Matcher m = Pattern.compile("/?lore/([a-z]+)|(?<![/\\w])([a-z]+)\\*").matcher(cell);
        java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
        while (m.find()) {
            String v = m.group(1) != null ? m.group(1) : m.group(2);
            if (v != null && !v.isBlank()) out.add(v);
        }
        return List.copyOf(out);
    }

    private static Set<String> allowedFor(String family) {
        try {
            var f = AgentScopeFilter.class.getDeclaredField("FAMILY_AGENTS");
            f.setAccessible(true);
            @SuppressWarnings("unchecked")
            var map = (java.util.Map<String, Set<String>>) f.get(null);
            return map.getOrDefault(family, Set.of());
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
