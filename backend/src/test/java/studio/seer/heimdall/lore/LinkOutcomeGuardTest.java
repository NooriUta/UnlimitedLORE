package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_EXT_ISSUES_W2/ISS-06-LINK-FALSE-SUCCESS · сторож «связь без исхода».
 *
 * <p>Стенд-e2e RFD3 (run 11094): {@code entity_link type=sprint rel=project} на незарегистрированный проект отвечал
 * {@code {"ok":true,"action":"added"}} — {@code CREATE EDGE … TO (SELECT …)} по пустой выборке в ArcadeDB тихий no-op,
 * а ответ безусловный. Без {@code outcome} MCP-обёртка noopAsError (D-2026-LORE-MCP-LINK-NOOP-IS-ERROR, ADR-LORE-043)
 * не видит «не сделано» и отдаёт агенту успех.
 *
 * <p>Общее правило: каждый путь связи, который MCP вызывает из {@code entity_link} (LINK_DEFS в
 * {@code mcp-server/src/tools/entity.ts}) и который пишет {@code CREATE EDGE}, отвечает исходом по ФАКТУ ребра —
 * {@code linkOutcome}/{@code unlinkOutcome}/{@code linkFact} (LoreResourceBase) или {@code LoreOutcome.*}: конец не
 * найден → {@code outcome=noop} с причиной (у проекта — с кандидатами реестра), уже было → unchanged.
 * Сторож читает исходники: новый путь связи без исхода валит сборку.
 */
class LinkOutcomeGuardTest {

    private static final Path SRC = Path.of("src/main/java/studio/seer/heimdall/lore");
    private static final Path ENTITY_TS = Path.of("../mcp-server/src/tools/entity.ts");

    private static final Pattern OUTCOME = Pattern.compile("linkOutcome\\(|unlinkOutcome\\(|linkFact\\(|LoreOutcome\\.");
    private static final Pattern TS_PATH = Pattern.compile("path: '(/lore/[a-z_/-]+)'");
    private static final Pattern CLASS_PATH = Pattern.compile("(?m)^@Path\\(\"([^\"]*)\"\\)");
    private static final Pattern METHOD_PATH = Pattern.compile("(?m)^    @Path\\(\"([^\"]*)\"\\)");

    /** Пути связи из LINK_DEFS (entity_link → бэкенд). */
    static Set<String> linkPaths() throws IOException {
        String ts = Files.readString(ENTITY_TS, StandardCharsets.UTF_8);
        int from = ts.indexOf("const LINK_DEFS = {");
        int to = ts.indexOf("} satisfies Record<string, {", from);
        assertTrue(from >= 0 && to > from, "LINK_DEFS найден в entity.ts");
        Set<String> out = new TreeSet<>();
        Matcher m = TS_PATH.matcher(ts.substring(from, to));
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** Путь бэкенда → тело обработчика (от аннотации метода записи до следующей). */
    static Map<String, String> handlers() throws IOException {
        Map<String, String> out = new TreeMap<>();
        List<Path> files;
        try (Stream<Path> s = Files.list(SRC)) { files = s.filter(p -> p.toString().endsWith(".java")).toList(); }
        for (Path f : files) {
            String src = Files.readString(f, StandardCharsets.UTF_8);
            Matcher cm = CLASS_PATH.matcher(src);
            String cls = cm.find() ? cm.group(1) : "";
            for (String part : src.split("(?m)(?=^    @(?:POST|GET|PUT|DELETE)\\b)")) {
                if (!part.matches("(?s)^    @(?:POST|PUT|DELETE)\\b.*")) continue;
                Matcher mm = METHOD_PATH.matcher(part);
                if (!mm.find()) continue;
                out.put((cls + "/" + mm.group(1)).replace("//", "/"), part);
            }
        }
        return out;
    }

    @Test
    void путьСвязи_сCreateEdge_отвечаетИсходомПоФактуРебра() throws IOException {
        Set<String> links = linkPaths();
        Map<String, String> h = handlers();
        assertTrue(links.contains("/lore/sprint/project"), "положительный контроль: путь ISS-06 в LINK_DEFS: " + links);
        Set<String> bad = new TreeSet<>();
        int checked = 0;
        for (String p : links) {
            String body = h.get(p);
            if (body == null || !body.contains("CREATE EDGE")) continue;
            checked++;
            if (!OUTCOME.matcher(body).find()) bad.add(p);
        }
        assertTrue(checked >= 20, "сторож видит пути связи с CREATE EDGE (иначе разбор сломан): " + checked);
        assertEquals(Set.of(), bad, "пути связи без outcome по факту ребра — ответят ok:true на пустой конец (ISS-06)");
    }
}
