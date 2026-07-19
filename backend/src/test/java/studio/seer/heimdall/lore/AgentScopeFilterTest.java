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
    void значениеКлеймаПриходитВКавычкахИЭтоНадоСнимать() {
        // Клейм многозначный → в токене это JSON-массив, элементы — JsonString,
        // и toString() у них отдаёт значение В КАВЫЧКАХ. Без обрезки
        // startsWith("agent-") не срабатывает, префикс остаётся, и скоуп не
        // совпадает НИ С ОДНОЙ строкой матрицы — отсекаются все агенты, включая full.
        //
        // Поймано первым живым запросом после включения auth, а не тестами:
        //   AGENT_SCOPE_FORBIDDEN: профиль agent-"agent-full" не пишет в 'status'
        // Двойной префикс в сообщении — след необрезанных кавычек. Прежние тесты
        // подставляли готовую строку и проверяли ТАБЛИЦУ, а не путь получения скоупа.
        assertEquals("agent-full", AgentScopeFilter.unquote("\"agent-full\""));
        assertEquals("agent-full", AgentScopeFilter.unquote("agent-full"),
            "строка без кавычек обязана пройти как есть — клейм может прийти "
            + "и обычной строкой от другого маппера");
        assertEquals("", AgentScopeFilter.unquote("\"\""));
        assertEquals("\"", AgentScopeFilter.unquote("\""),
            "одиночная кавычка — не пара, обрезать нечего");
        assertNull(AgentScopeFilter.unquote(null));
    }

    @Test
    void семействаСЖивойЗаписьюНеВыпадаютИзМатрицы() {
        // AL-62. Неперечисленное семейство фильтр ПРОПУСКАЕТ — решение осознанное
        // (иначе продуктовый слой отвалился бы у architect/pm посреди работы), но
        // из-за него дыра выглядит как штатная работа: ни отказа, ни лога об отказе.
        //
        // Эти три имели живой POST под /lore и в матрице отсутствовали. Самое
        // дорогое — forgejo: мерж PR мог сделать любой профиль, хотя ADR-LORE-024
        // говорит «merge только full».
        for (String f : Set.of("forgejo", "asset", "quality-gate")) {
            assertTrue(AgentScopeFilter.enforcedFamilies().contains(f),
                "семейство '" + f + "' обязано быть в матрице: под ним есть POST, "
                + "а вне матрицы оно молча пропускается");
        }
        assertEquals(Set.of("full"), allowedFor("forgejo"),
            "merge PR — full-only (ADR-LORE-024); подпутём его не выделить, "
            + "subPathOf сворачивает forgejo/pr/{n}/merge в forgejo/pr");
        assertEquals(Set.of("full"), allowedFor("asset"));
        assertEquals(allowedFor("qg"), allowedFor("quality-gate"),
            "создание гейта и запись прогона — одна деятельность; расхождение "
            + "дало бы «прогон записать нельзя, а гейт завести можно кому угодно»");
    }

    // ── Разрушающие операции внутри разрешённого семейства ───────────────────

    @Test
    void подпутьРазбираетсяИзДвухСегментов() {
        assertEquals("adr/delete", AgentScopeFilter.subPathOf("/lore/adr/delete"));
        assertEquals("adr/link", AgentScopeFilter.subPathOf("lore/adr/link"));
        assertEquals("", AgentScopeFilter.subPathOf("/lore/adr"));
        assertEquals("", AgentScopeFilter.subPathOf("/api/v1/ready"));
    }

    @Test
    void developerЗаводитADRноНеСноситИНеПереименовывает() {
        // Решение владельца: developer владеет adr_new. Создание и правка
        // неразделимы по пути (общий upsert), поэтому семейство ему открыто —
        // но снос и переименование изъяты отдельным правилом.
        assertTrue(allowedFor("adr").contains("developer"), "developer заводит ADR");
        assertTrue(!narrowedFor("adr/delete").contains("developer"), "developer не удаляет ADR");
        assertTrue(!narrowedFor("adr/rename").contains("developer"), "developer не переименовывает ADR");
        assertTrue(narrowedFor("adr/delete").contains("architect"), "architect удаляет");
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

    private static Set<String> narrowedFor(String subPath) {
        return tableOf("SUBPATH_AGENTS").getOrDefault(subPath, Set.of());
    }

    private static java.util.Map<String, Set<String>> tableOf(String fieldName) {
        try {
            var f = AgentScopeFilter.class.getDeclaredField(fieldName);
            f.setAccessible(true);
            @SuppressWarnings("unchecked")
            var map = (java.util.Map<String, Set<String>>) f.get(null);
            return map;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
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
