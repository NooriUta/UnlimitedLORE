package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24: срез task_identities — выпадающий список автора,
 * исполнителя и принимающего. Список обязан совпадать с тем, по которому TR-05 проверяет
 * запись роли и перечисляет кандидатов в отказе: иначе форма предложит одно, а сервер
 * откажет по другому.
 */
class LoreTaskIdentitiesTest {

    private static final List<String> PEOPLE = List.of("Ольга", "anna");
    private static final List<String> AGENTS = List.of("claude-code", "codex");
    private static final Map<String, String> TITLES = Map.of("claude-code", "Claude Code (full)");

    @Test
    void codesAreExactlyTheCandidatesTr05ChecksAgainst() {
        List<Map<String, Object>> rows = LoreTaskIdentities.rows(PEOPLE, AGENTS, TITLES);
        Set<Object> codes = new HashSet<>();
        for (Map<String, Object> r : rows) codes.add(r.get("code"));
        assertEquals(Set.copyOf(TaskRoleWriter.candidates(PEOPLE, AGENTS)), codes,
            "одна правда о кандидатах: выбор = проверка записи");
        assertEquals(codes.size(), rows.size(), "без дублей");
    }

    @Test
    void rowShapeKindAndTitle() {
        List<Map<String, Object>> rows = LoreTaskIdentities.rows(PEOPLE, AGENTS, TITLES);
        for (Map<String, Object> r : rows) assertEquals(Set.of("code", "title", "kind"), r.keySet());
        assertEquals(List.of(
            Map.of("code", "anna", "title", "anna", "kind", "person"),
            Map.of("code", "Ольга", "title", "Ольга", "kind", "person"),
            Map.of("code", "claude-code", "title", "Claude Code (full)", "kind", "agent"),
            Map.of("code", "codex", "title", "codex", "kind", "agent")), rows,
            "люди, затем агенты; внутри — по подписи; подпись агента — его имя, без имени — код");
    }

    @Test
    void orderIsDeterministicWhateverTheInputOrder() {
        List<Map<String, Object>> a = LoreTaskIdentities.rows(PEOPLE, AGENTS, TITLES);
        List<Map<String, Object>> b = LoreTaskIdentities.rows(
            List.of("anna", "Ольга"), List.of("codex", "claude-code"), TITLES);
        assertEquals(a, b);
    }

    @Test
    void personWinsOverSameNamedAgentLikeCandidates() {
        // candidates() ставит людей первыми; та же строка у агента — тот же кандидат.
        List<Map<String, Object>> rows = LoreTaskIdentities.rows(List.of("x"), List.of("x"), Map.of());
        assertEquals(List.of(Map.of("code", "x", "title", "x", "kind", "person")), rows);
    }

    @Test
    void projectlessOrMissingTaskIsAnErrorNotAnEmptyList() {
        assertEquals("TASK_NOT_FOUND", LoreTaskIdentities.problem(List.of()));
        assertEquals("TASK_NOT_FOUND", LoreTaskIdentities.problem(null));
        assertEquals("TASK_PROJECT_NOT_FOUND",
            LoreTaskIdentities.problem(List.of(Map.of("task_uid", "S/T", "projects", List.of()))));
        java.util.Map<String, Object> noKey = new java.util.HashMap<>();
        noKey.put("task_uid", "S/T");
        noKey.put("projects", null);
        assertEquals("TASK_PROJECT_NOT_FOUND", LoreTaskIdentities.problem(List.of(noKey)));
        assertNull(LoreTaskIdentities.problem(List.of(Map.of("task_uid", "S/T", "projects", List.of("org/a")))));
    }

    /** Бин берёт людей и агентов теми же методами, что проверка записи роли (TaskRoleService.apply). */
    @Test
    void serviceBuildsFromTheSameSourcesAsRoleCheck() {
        TaskRoleService svc = new TaskRoleService() {
            @Override List<String> peopleOfTaskProject(String taskUid) {
                assertEquals("S/T", taskUid);
                return PEOPLE;
            }
            @Override List<String> declaredAgents() { return AGENTS; }
            @Override Map<String, String> agentTitles() { return TITLES; }
        };
        assertEquals(LoreTaskIdentities.rows(PEOPLE, AGENTS, TITLES), svc.identitiesOfTask("S/T"));
    }

    @Test
    void sliceIsRegisteredByIdAndProjectScoped() {
        LoreSlices.SliceDef def = LoreSlices.get(LoreTaskIdentities.SLICE);
        assertNotNull(def, "срез task_identities объявлен");
        assertEquals(List.of("id"), def.required());
        assertEquals("out('PART_OF').out('BELONGS_TO_PROJECT').slug",
            LoreSlices.PROJECT_SCOPED.get(LoreTaskIdentities.SLICE),
            "скоуп — как у остальных срезов задач: через спринт в проект");
        String sql = LoreSlices.compose(LoreTaskIdentities.SLICE, Map.of("id", "S/T"), Set.of("org/a")).sql();
        assertTrue(sql.contains(":__scope0"), "условие скоупа в запросе: " + sql);
        assertTrue(sql.contains("task_uid = :id"), sql);
    }
}
