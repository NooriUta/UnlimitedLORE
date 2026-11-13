package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-20 — правила ссылок в MD по общим тест-примерам
 * {@code shared/md-refs/cases.json} (их же читает Python-скрипт PU-19). Чистый JUnit:
 * Quarkus и база не поднимаются.
 */
class MdRefRulesTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    static JsonNode cases() throws Exception {
        Path p = Path.of("..", "shared", "md-refs", "cases.json");
        if (!Files.exists(p)) p = Path.of("shared", "md-refs", "cases.json");
        return JSON.readTree(Files.readString(p));
    }

    static Set<String> strings(JsonNode arr) {
        Set<String> out = new HashSet<>();
        if (arr != null) arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    static List<String> list(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr != null) arr.forEach(n -> out.add(n.asText()));
        return out;
    }

    static MdRefRules.Ctx ctx(JsonNode root, boolean withContext) {
        Map<String, Set<String>> ids = new HashMap<>();
        root.get("ids").fields().forEachRemaining(e -> ids.put(e.getKey(), strings(e.getValue())));
        if (!withContext) return new MdRefRules.Ctx(ids, Set.of(), null, null);
        JsonNode c = root.get("context");
        Map<String, MdRefRules.Scope> sprints = new HashMap<>();
        Set<String> all = new HashSet<>();
        c.get("sprint_projects").fieldNames().forEachRemaining(all::add);
        c.get("sprint_components").fieldNames().forEachRemaining(all::add);
        for (String s : all)
            sprints.put(s, new MdRefRules.Scope(strings(c.get("sprint_projects").get(s)), strings(c.get("sprint_components").get(s))));
        Map<String, Set<String>> taskComps = new HashMap<>();
        c.get("task_components").fields().forEachRemaining(e -> taskComps.put(e.getKey(), strings(e.getValue())));
        return new MdRefRules.Ctx(ids, Set.of(), sprints, taskComps);
    }

    @TestFactory
    Stream<DynamicTest> sharedCases() throws Exception {
        JsonNode root = cases();
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode c : root.get("cases")) {
            tests.add(DynamicTest.dynamicTest(c.get("name").asText(), () -> {
                boolean withCtx = c.path("context").asBoolean(false);
                MdRefRules.Ctx ctx = ctx(root, withCtx);
                // Без контекста (режим скрипта) включено всё, как в Python; с контекстом — умолчания бэкенда.
                Set<String> enabled = withCtx ? MdRefRules.defaults() : new HashSet<>(MdRefRules.RULES);
                enabled.removeAll(strings(c.get("disabled")));
                MdRefRules.Scope rec = new MdRefRules.Scope(strings(c.get("rec_projects")), strings(c.get("rec_components")));
                String owner = c.hasNonNull("owner_sprint") ? c.get("owner_sprint").asText() : null;
                String text = c.get("text").asText();
                MdRefRules.Result r = MdRefRules.fix(text, ctx, owner, rec, enabled);
                if (c.path("idempotent").asBoolean(false)) {
                    assertEquals(r.text(), MdRefRules.fix(r.text(), ctx, owner, rec, enabled).text(), "повтор ничего не меняет");
                    assertFalse(r.changes().isEmpty(), "первый проход что-то правит");
                    return;
                }
                assertEquals(c.get("expect").asText(), r.text());
                Set<String> rules = new HashSet<>();
                r.changes().forEach(ch -> rules.add(MdRefRules.baseRule(ch.rule())));
                for (String want : strings(c.get("rules"))) assertTrue(rules.contains(want), "правило " + want + " среди " + rules);
                if (c.has("issues"))
                    assertEquals(list(c.get("issues")), r.issues().stream().map(MdRefRules.Issue::kind).toList(), "места для ручного разбора");
                if (c.has("suggest"))
                    assertEquals(list(c.get("suggest")), r.issues().get(0).suggest(), "подсказка-кандидаты");
            }));
        }
        return tests.stream();
    }

    @Test
    void defaultsLeaveUnconfirmedUniqueOff() {
        assertFalse(MdRefRules.defaults().contains("lone_unique"));
        assertTrue(MdRefRules.defaults().containsAll(List.of("lone_ctx", "lone_unique_ctx", "lone_own_sprint", "shape")));
    }
}
