package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Белые списки подагентов обязаны быть ЗЕРКАЛОМ серверной матрицы прав.
 *
 * <p><b>Зачем сторож.</b> Разграничение ролей у подагента живёт в
 * {@code .claude/agents/*.md} — в текстовом файле, который правится руками и
 * не компилируется. Матрица прав живёт в коде. Две правды об одном и том же
 * расходятся всегда, а расходятся они здесь МОЛЧА: подагент с лишним
 * инструментом ведёт себя как обычно ровно до дня, когда воспользуется им.
 *
 * <p>Отказ на сервере при этом останется — матрица главнее, — но пользы от
 * запрета, наступающего после того, как агент уже решил действовать, немного:
 * работа окажется недоделанной, а причина обнаружится в чужом логе.
 *
 * <p><b>Направление проверки одностороннее и это намеренно.</b> Требуется,
 * чтобы каждый инструмент из белого списка был РАЗРЕШЁН матрицей. Обратное —
 * «все разрешённые перечислены» — не требуется: роль вправе взять уже меньше,
 * чем ей положено, и сужение набора не должно ронять сборку.
 */
class AgentDefinitionsMatchMatrixTest {

    /** Читающие инструменты профилем не ограничены — сервер не скоупит GET. */
    private static final Set<String> READ_TOOLS = Set.of(
        "query_slice", "list_slices", "search", "search_similar",
        "bench_query_slice", "bench_list_slices", "bench_status", "metric_get");

    /**
     * Имя инструмента → семейство прав.
     *
     * <p>По умолчанию семейство — часть имени до первого подчёркивания
     * ({@code task_new} → {@code task}). Исключения ниже там, где имя
     * инструмента и первый сегмент пути расходятся.
     */
    private static final Map<String, String> FAMILY_OVERRIDE = Map.of(
        "quality_check", "quality",
        "uc_quality",    "uc");

    private static final Pattern TOOLS_LINE = Pattern.compile("(?m)^tools:\\s*(.+)$");
    private static final Pattern LORE_TOOL  = Pattern.compile("mcp__aida-lore__([\\w-]+)");

    /**
     * Каталог агентов лежит в корне репозитория, а тесты идут из {@code backend/}.
     *
     * <p>Не найденный каталог — ПАДЕНИЕ, а не пропуск. Молча пропущенный сторож
     * неотличим от сторожа, который ничего не нашёл, — и именно так проверки
     * годами «проходят», ничего не проверяя.
     */
    private static Path agentsDir() {
        for (String candidate : new String[]{"../.claude/agents", ".claude/agents"}) {
            Path p = Path.of(candidate);
            if (Files.isDirectory(p)) return p;
        }
        return fail("каталог .claude/agents не найден ни в корне репозитория, ни в backend/ — "
            + "сторож не может молча ничего не проверить");
    }

    private static String profileOf(Path file) {
        String n = file.getFileName().toString().replace(".md", "");
        return n.startsWith("lore-") ? n.substring("lore-".length()) : n;
    }

    @Test
    void everyToolInAnAgentAllowlistIsAllowedByTheServerMatrix() throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.list(agentsDir())) {
            files = s.filter(p -> p.toString().endsWith(".md")).sorted().toList();
        }
        assertFalse(files.isEmpty(), "в .claude/agents нет ни одного описания — сторожить нечего");

        List<String> violations = new ArrayList<>();
        int checkedTools = 0;

        for (Path f : files) {
            String profile = profileOf(f);
            String text = Files.readString(f, StandardCharsets.UTF_8);

            Matcher tl = TOOLS_LINE.matcher(text);
            assertTrue(tl.find(), "у " + f.getFileName() + " нет строки tools: — "
                + "без белого списка подагент наследует ВСЁ, включая чужие семейства");

            Matcher m = LORE_TOOL.matcher(tl.group(1));
            while (m.find()) {
                String tool = m.group(1);
                if (READ_TOOLS.contains(tool)) continue;
                checkedTools++;

                String family = FAMILY_OVERRIDE.get(tool);
                if (family == null) {
                    int us = tool.indexOf('_');
                    family = us < 0 ? tool : tool.substring(0, us);
                }

                Set<String> allowed = AgentScopeFilter.FAMILY_AGENTS.get(family);
                if (allowed == null) {
                    violations.add(f.getFileName() + ": инструмент " + tool
                        + " → семейство '" + family + "', которого в матрице нет вовсе");
                } else if (!allowed.contains(profile)) {
                    violations.add(f.getFileName() + ": " + tool + " (семейство " + family
                        + ") профилю '" + profile + "' матрицей НЕ разрешён; разрешены " + allowed);
                }
            }
        }

        assertTrue(checkedTools > 0,
            "ни одного пишущего инструмента LORE в белых списках не нашлось — "
                + "проверка прошла бы зелёной, ничего не проверив");
        assertEquals(List.of(), violations,
            "белые списки подагентов разошлись с матрицей прав:\n  " + String.join("\n  ", violations));
    }

    /**
     * Профиль из имени файла обязан существовать в матрице.
     *
     * <p>Опечатка в имени — {@code lore-marketeer.md} — дала бы белый список,
     * который сторож выше проверить не может: у несуществующего профиля нет
     * разрешений, и любая проверка на него отвечала бы «не разрешено» либо
     * «нечего сверять». Ловим отдельно, чтобы причина была названа.
     */
    @Test
    void everyAgentFileNamesAKnownProfile() throws IOException {
        Set<String> known = new java.util.HashSet<>();
        AgentScopeFilter.FAMILY_AGENTS.values().forEach(known::addAll);
        assertNotNull(known);

        try (Stream<Path> s = Files.list(agentsDir())) {
            for (Path f : s.filter(p -> p.toString().endsWith(".md")).toList()) {
                String profile = profileOf(f);
                assertTrue(known.contains(profile),
                    f.getFileName() + ": профиль '" + profile + "' в матрице не встречается ни разу — "
                        + "опечатка в имени файла либо профиль, которого нет. Известные: " + known);
            }
        }
    }
}
