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
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-13 — сторож правила «статус элемента с историей
 * меняется ТОЛЬКО через {@link StatusHistoryService#transition}».
 *
 * <p>По исходникам ищется любая запись поля статуса ({@code status} /
 * {@code status_raw}) в вершину типа из реестра сервиса или в его Hist-строку
 * «на месте» — литералом {@code UPDATE <тип> SET … status=} или через
 * {@code StringBuilder("UPDATE <тип> SET …")} с последующим
 * {@code .append(", status=…")}. Такая запись обходит историю: статус меняется,
 * а версии нет (ровно так жили ADR и решения до S2-13).
 *
 * <p>Исключения — пофайлово, с ТОЧНЫМ числом и причиной: новая запись в уже
 * разрешённом файле тоже ловится. Схема/миграции не проверяются.
 */
class StatusWritesGoThroughServiceTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");

    private static final Set<String> EXEMPT = Set.of(
        "StatusHistoryService.java", "LoreSchemaInitializer.java", "LoreSchemaMigrations.java",
        "LoreSchemaMigrationRunner.java");

    /**
     * Известные обходы: файл → число находок. Каждый — СОЗДАНИЕ элемента со
     * стартовым статусом или массовый импорт корпуса, а не смена статуса
     * вызывающим. Перевод их на сервис — продолжение S2-13 (см. отчёт).
     */
    static final Map<String, Integer> ALLOWED = Map.of(
        // createSprint (создание; идемпотентный повтор правит вершину) + legacy-импорт
        // корпуса из docsRoot: upsertAdr, upsertSprint, импорт задач.
        "LoreIngestService.java", 4);

    private static final String TYPES = String.join("|", StatusHistoryService.KINDS.values().stream()
        .flatMap(k -> Stream.of(k.hist(), k.vertex())).toList());

    /** {@code UPDATE <тип> SET} — начало оператора записи. */
    private static final Pattern UPDATE = Pattern.compile("UPDATE\\s+(" + TYPES + ")\\s+SET\\b");
    /** {@code X = new StringBuilder("UPDATE <тип> SET} — оператор, собираемый по частям. */
    private static final Pattern BUILDER = Pattern.compile(
        "(\\w+)\\s*=\\s*new\\s+StringBuilder\\(\\s*\"UPDATE\\s+(" + TYPES + ")\\s+SET\\b");
    private static final Pattern STATUS_SET = Pattern.compile("\\bstatus(_raw)?\\s*=");
    private static final Pattern END = Pattern.compile("\\bWHERE\\b|\\bUPSERT\\b|;\\s*\"|\\);");

    /** Находки в одном исходнике: «файл:строка тип». Видимость пакетная — для положительного контроля. */
    static List<String> violations(String file, String src) {
        List<String> out = new ArrayList<>();
        Matcher m = UPDATE.matcher(src);
        while (m.find()) {
            int end = Math.min(src.length(), m.end() + 700);
            Matcher e = END.matcher(src).region(m.end(), end);
            if (e.find()) end = e.start();
            String set = src.substring(m.end(), end).replaceAll("\"\\s*\\+\\s*\"", "");
            if (STATUS_SET.matcher(set).find()) out.add(at(file, src, m.start()) + " " + m.group(1));
        }
        Matcher b = BUILDER.matcher(src);
        while (b.find()) {
            Pattern app = Pattern.compile("\\b" + Pattern.quote(b.group(1))
                + "\\.append\\(\\s*\"[^\"]*\\bstatus(_raw)?\\s*=");
            Matcher a = app.matcher(src).region(b.end(), Math.min(src.length(), b.end() + 4000));
            while (a.find()) out.add(at(file, src, a.start()) + " " + b.group(2) + " (builder)");
        }
        return out;
    }

    private static String at(String file, String src, int pos) {
        return file + ":" + (1 + (int) src.substring(0, pos).chars().filter(c -> c == '\n').count());
    }

    @Test
    void status_of_elements_with_history_is_written_only_by_the_service() throws IOException {
        List<String> all = new ArrayList<>();
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String name = p.getFileName().toString();
                if (EXEMPT.contains(name)) continue;
                all.addAll(violations(name, Files.readString(p, StandardCharsets.UTF_8)));
            }
        }
        Map<String, List<String>> byFile = all.stream().collect(Collectors.groupingBy(
            v -> v.substring(0, v.indexOf(':')), TreeMap::new, Collectors.toList()));
        List<String> bad = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : byFile.entrySet()) {
            int allowed = ALLOWED.getOrDefault(e.getKey(), 0);
            if (e.getValue().size() != allowed) bad.add(e.getKey() + " — найдено " + e.getValue().size()
                + ", разрешено " + allowed + ": " + e.getValue());
        }
        for (Map.Entry<String, Integer> e : ALLOWED.entrySet())
            if (!byFile.containsKey(e.getKey())) bad.add(e.getKey() + " — исключение больше не нужно, уберите его");
        assertTrue(bad.isEmpty(), "статус пишется в обход StatusHistoryService.transition "
            + "(смена статуса без версии истории):\n  " + String.join("\n  ", bad));
    }

    // ── положительный контроль: сторож ловит каждую форму обхода ──

    @Test
    void guard_catches_literal_builder_and_concatenated_bypasses() {
        assertEquals(1, violations("X.java",
            "cmd(\"UPDATE KnowADR SET status=:status WHERE adr_id=:id\");").size(), "литерал вершины");
        assertEquals(1, violations("X.java",
            "cmd(\"UPDATE KnowDecision SET \" +\n  \"title=:t, status_raw=:s WHERE decision_id=:d\");").size(),
            "склейка литералов");
        assertEquals(1, violations("X.java",
            "StringBuilder hsql = new StringBuilder(\"UPDATE KnowSpecHist SET spec_id=:id\");\n"
                + "if (x) { hsql.append(\", status=:status\"); }").size(), "builder Hist на месте");
        assertEquals(0, violations("X.java",
            "cmd(\"UPDATE KnowADR SET name=:n WHERE status = 'PROPOSED'\");").size(), "статус в WHERE — не запись");
        assertEquals(0, violations("X.java",
            "cmd(\"UPDATE KnowTaskHist SET note_md = :note, status_category = :c WHERE state_uid = :nsid\");").size(),
            "status_category — не поле статуса");
    }
}
