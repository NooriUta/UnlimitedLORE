package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 · Сторож чтения историчных связей.
 *
 * <p>У историчной связи (раздел {@code edge_history} модели) прежнее ребро не стирается, а закрывается
 * {@code valid_to}. Значит, любое чтение «текущих» связей без фильтра {@code valid_to IS NULL} молча
 * вернёт и закрытые: задача окажется в двух фазах, человек сохранит роль в проекте, с которой его сняли,
 * — а это уже права доступа. Правило для всех путей сразу, как у сторожа HAS_STATE:
 * <ul>
 *   <li>переход по вершинам {@code out('X')} / {@code in('X')} / {@code both('X')} запрещён вовсе —
 *       он не видит свойств ребра; нужен {@code outE('X')[valid_to IS NULL].inV()} ({@link LoreEdgeHistory});</li>
 *   <li>{@code outE('X')} / {@code inE('X')} — только с фильтром, где назван {@code valid_to};</li>
 *   <li>{@code FROM X} (чтение, правка, удаление) и {@code CREATE EDGE X} — в том же операторе Java
 *       должен быть назван {@code valid_to} (чтение/закрытие) или {@code valid_from} (создание).</li>
 * </ul>
 * Осознанное исключение (стирание учётки целиком) помечается в операторе словами {@code edge-history:}.
 * Шаги схемы старой базы (LoreSchemaMigrations / Runner / Initializer) не проверяются: это журнал
 * прошлого, по которому новая база не строится.
 */
class HistoricEdgeReadGuardTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");
    private static final Path MODEL = Path.of("..", "shared", "model", "lore-model.json");
    private static final Set<String> SCHEMA_HISTORY = Set.of(
        "LoreSchemaMigrations.java", "LoreSchemaMigrationRunner.java", "LoreSchemaInitializer.java");

    static Set<String> historicEdges() throws IOException {
        JsonObject eh = new JsonObject(Files.readString(MODEL)).getJsonObject("edge_history");
        return eh == null ? Set.of() : eh.getJsonObject("edges").fieldNames();
    }

    /** Нарушения в одном тексте исходника (вынесено ради проверки самого сторожа). */
    static List<String> violations(String file, String text, Set<String> edges) {
        List<String> hits = new ArrayList<>();
        String[] lines = text.split("\n", -1);
        for (String e : edges) {
            Pattern vertexHop = Pattern.compile("\\b(out|in|both)\\('" + e + "'\\)");
            Pattern edgeHop = Pattern.compile("\\b(outE|inE|bothE)\\('" + e + "'\\)(\\[[^\\]]*\\])?");
            Pattern stmt = Pattern.compile("(FROM|CREATE EDGE)\\s+" + e + "\\b");
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i];
                String trimmed = line.trim();
                if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
                String code = stripLineComment(line);
                String where = file + ":" + (i + 1) + "  ";
                String window = statement(lines, i);
                boolean excused = window.contains("edge-history:");
                if (vertexHop.matcher(code).find() && !excused) hits.add(where + "переход по вершинам без фильтра: " + trimmed);
                Matcher m = edgeHop.matcher(code);
                while (m.find())
                    if ((m.group(2) == null || !m.group(2).contains("valid_to")) && !window.contains("valid_to") && !excused)
                        hits.add(where + "ребро без фильтра valid_to: " + trimmed);
                Matcher s = stmt.matcher(code);
                while (s.find()) {
                    boolean create = s.group(1).startsWith("CREATE");
                    String need = create ? "valid_from" : "valid_to";
                    if (!window.contains(need) && !excused)
                        hits.add(where + (create ? "новое ребро без valid_from: " : "оператор без valid_to: ") + trimmed);
                }
            }
        }
        return hits;
    }

    private static String stripLineComment(String line) {
        int c = line.indexOf("//");
        // «//» внутри строкового литерала (URL) — не комментарий; грубо: до кавычки — комментарий.
        return c >= 0 && line.lastIndexOf('"', c) < 0 ? line.substring(0, c) : line;
    }

    /** Оператор Java вокруг строки: от конца предыдущего оператора до ближайшей «;». */
    private static String statement(String[] lines, int at) {
        int from = at;
        while (from > 0 && from > at - 25) {
            String prev = lines[from - 1].trim();
            if (prev.endsWith(";") || prev.endsWith("{") || prev.endsWith("}")) break;
            from--;
        }
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < lines.length && i < at + 25; i++) {
            sb.append(lines[i]).append('\n');
            if (i >= at && lines[i].trim().endsWith(";")) break;
        }
        return sb.toString();
    }

    @Test
    void everyReadOfAHistoricEdgeFiltersCurrent() throws IOException {
        if (!Files.isDirectory(SRC)) return;
        Set<String> edges = historicEdges();
        assertTrue(edges.size() >= 5, "положительный контроль: модель объявляет историчные связи (" + edges + ")");
        List<String> hits = new ArrayList<>();
        int touched = 0;
        try (Stream<Path> files = Files.list(SRC)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).sorted().toList()) {
                String name = file.getFileName().toString();
                if (SCHEMA_HISTORY.contains(name)) continue;
                String text = Files.readString(file).replace("\r\n", "\n");
                for (String e : edges) if (text.contains("'" + e + "'") || text.contains(" " + e + " ")) touched++;
                hits.addAll(violations(name, text, edges));
            }
        }
        assertTrue(touched > 20, "положительный контроль: сторож видит места работы с историчными связями (" + touched + ")");
        assertTrue(hits.isEmpty(), "чтение историчной связи без valid_to (закрытые рёбра попадут в «текущие»):\n"
            + String.join("\n", hits));
    }

    @Test
    void guardCatchesEachForm() {
        Set<String> e = Set.of("IN_PHASE");
        String bad = String.join("\n",
            "class X {",
            "  String a = \"SELECT out('IN_PHASE').phase_uid FROM KnowTask\";",
            "  String b = \"SELECT outE('IN_PHASE').size() FROM KnowTask\";",
            "  String c = \"SELECT @rid FROM IN_PHASE WHERE @out.task_uid = :t\";",
            "  String d = \"CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask) TO (SELECT FROM KnowPhase)\";",
            "  String f = \"SELECT out('CAMPAIGN_IN_PHASE').x FROM ExpCampaign\";",
            "}");
        List<String> hits = violations("X.java", bad, e);
        assertTrue(hits.size() == 4, "четыре формы пойманы, чужая связь с похожим именем — нет: " + hits);
        String good = String.join("\n",
            "class Y {",
            "  String a = \"SELECT outE('IN_PHASE')[valid_to IS NULL].inV().phase_uid FROM KnowTask\";",
            "  String c = \"SELECT @rid FROM IN_PHASE WHERE @out.task_uid = :t AND valid_to IS NULL\";",
            "  String d = \"CREATE EDGE IN_PHASE FROM (SELECT FROM KnowTask) TO (SELECT FROM KnowPhase) SET valid_from = :now\";",
            "}");
        assertTrue(violations("Y.java", good, e).isEmpty(), "правильные формы не ловятся: " + violations("Y.java", good, e));
    }
}
