package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * SPRINT_LORE_SLICE_ERGONOMICS/SE-11: профили OpenCode
 * ({@code mcp-server/agent-profiles/*.json}) обязаны обещать только то, что
 * бэкенд пропустит.
 *
 * <p>До этого сторожа профили не проверял никто, и расхождения были: architect и
 * pm видели {@code project_new}, product-analyst — {@code task_set}/{@code status_set},
 * а бэкенд отвечал AGENT_SCOPE_FORBIDDEN. Решение владельца 20.10.2026 —
 * D-2026-LORE-AGENT-MATRIX-WIDEN-PROFILES: расширить матрицу.
 *
 * <p>Пути инструментов НЕ угадываются по имени: их снимает MCP-тест
 * {@code toolPaths.test.ts}, вызывая каждый инструмент во всех ветках, и кладёт в
 * {@code agent-profiles/tool-paths.json}. Решение берётся из
 * {@link AgentScopeFilter#decide} — той же функции, что отказывает на проде.
 *
 * <p>Направление одностороннее, как у {@link AgentDefinitionsMatchMatrixTest}:
 * профиль вправе брать меньше, чем разрешено, но не больше.
 */
class AgentProfilesMatchMatrixTest {

    /** Читающие инструменты — сервер GET не скоупит, в реестре записей их нет. */
    private static final Set<String> READ_TOOLS = Set.of(
        "list_slices", "query_slice", "search", "search_similar", "metric_get", "bragi_search");

    private static Path profilesDir() {
        for (String c : new String[]{"../mcp-server/agent-profiles", "mcp-server/agent-profiles"}) {
            Path p = Path.of(c);
            if (Files.isDirectory(p)) return p;
        }
        return fail("каталог mcp-server/agent-profiles не найден — сторож не может молча ничего не проверить");
    }

    static Map<String, List<String>> toolPaths() throws IOException {
        JsonObject j = new JsonObject(Files.readString(profilesDir().resolve("tool-paths.json"), StandardCharsets.UTF_8));
        Map<String, List<String>> out = new TreeMap<>();
        for (String tool : j.fieldNames()) {
            JsonArray a = j.getJsonArray(tool);
            List<String> paths = new ArrayList<>();
            for (int i = 0; i < a.size(); i++) paths.add(a.getString(i));
            out.put(tool, paths);
        }
        return out;
    }

    /** profile → разрешённые записи профиля (имена и маски с '*'). "full" пропускается: у него "*". */
    static Map<String, List<String>> profiles() throws IOException {
        Map<String, List<String>> out = new LinkedHashMap<>();
        try (Stream<Path> s = Files.list(profilesDir())) {
            for (Path f : s.filter(p -> p.toString().endsWith(".json")).sorted().toList()) {
                String name = f.getFileName().toString().replace(".json", "");
                if (name.equals("tool-paths") || name.equals("full")) continue;
                JsonObject perm = new JsonObject(Files.readString(f, StandardCharsets.UTF_8)).getJsonObject("permission");
                List<String> allow = new ArrayList<>();
                for (String k : perm.fieldNames()) if ("allow".equals(perm.getString(k)) && !k.equals("*")) allow.add(k);
                // Явный запрет поверх маски ("doc_*": allow, "doc_del": deny) — правила
                // OpenCode идут по порядку, последнее совпадение решает; запрет стоит после.
                for (String k : perm.fieldNames()) if ("deny".equals(perm.getString(k)) && !k.equals("*")) allow.add("!" + k);
                out.put(name, allow);
            }
        }
        return out;
    }

    /** Чистая проверка: список нарушений «профиль обещает → бэкенд откажет». */
    static List<String> violations(Map<String, List<String>> profiles, Map<String, List<String>> registry) {
        List<String> v = new ArrayList<>();
        for (var e : profiles.entrySet()) {
            String profile = e.getKey();
            List<String> denied = e.getValue().stream().filter(x -> x.startsWith("!")).map(x -> x.substring(1)).toList();
            for (String entry : e.getValue()) {
                if (READ_TOOLS.contains(entry) || entry.startsWith("!")) continue;
                List<String> tools = entry.endsWith("*")
                    ? registry.keySet().stream().filter(t -> t.startsWith(entry.substring(0, entry.length() - 1))).toList()
                    : registry.containsKey(entry) ? List.of(entry) : List.of();
                if (tools.isEmpty()) {
                    v.add(profile + ": '" + entry + "' не совпадает ни с одним инструментом записи");
                    continue;
                }
                for (String tool : tools) for (String path : denied.contains(tool) ? List.<String>of() : registry.get(tool)) {
                    AgentScopeFilter.Denial d = AgentScopeFilter.decide(profile, path);
                    if (d != null) v.add(profile + ": " + tool + " → " + path + " — бэкенд откажет (" + d.what() + ": " + d.why() + ")");
                }
            }
        }
        return v;
    }

    @Test
    void everyProfilePromiseIsHonouredByTheBackend() throws IOException {
        Map<String, List<String>> registry = toolPaths();
        Map<String, List<String>> profiles = profiles();
        assertTrue(registry.size() > 30, "реестр путей пуст — tool-paths.json не выгружен");
        assertTrue(profiles.size() >= 7, "профилей меньше семи — каталог не тот");
        assertEquals(List.of(), violations(profiles, registry),
            "профили обещают то, что бэкенд отказывает");
    }

    /** Положительный контроль: подмешанный лишний инструмент обязан ронять проверку. */
    @Test
    void injectedForbiddenToolIsCaught() throws IOException {
        Map<String, List<String>> registry = toolPaths();
        Map<String, List<String>> p = new LinkedHashMap<>();
        p.put("tester", List.of("qg_*", "decision_new"));
        List<String> v = violations(p, registry);
        assertEquals(1, v.size(), String.valueOf(v));
        assertTrue(v.get(0).startsWith("tester: decision_new → /lore/decision"), v.get(0));
    }

    @Test
    void unknownToolNameIsCaught() throws IOException {
        List<String> v = violations(Map.of("pm", List.of("sprnt_new")), toolPaths());
        assertFalse(v.isEmpty());
        assertTrue(v.get(0).contains("не совпадает ни с одним инструментом"), v.get(0));
    }
}
