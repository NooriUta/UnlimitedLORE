package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_PROJECT_SCOPE/AL-SCOPE-HOLES, часть A — /lore/search под проектным скоупом.
 * Правило то же, что у срезов и обратных ссылок: хит виден, если хотя бы один его проект
 * разрешён; тип, чей срез общий (AL-106, AL-113: акторы, боли/выгоды/работы) или ждёт
 * решения (quality_gate — как qg_*), не режется. Скрытое считается и называется числом.
 */
class SearchScopeTest {

    private static Map<String, Object> hit(String type, String... projects) {
        return new java.util.HashMap<>(Map.of("type", type, "ref_id", type + "-" + String.join("+", projects),
            "projects", List.of(projects)));
    }

    @Test
    void scopedType_hitOutsideAllowedProjects_hidden() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(hit("task", "org/a"), hit("task", "org/b"), hit("task", "org/b", "org/a")));
        int hidden = LoreSearchResource.scopeRows("task", rows, Set.of("org/a"));
        assertEquals(1, hidden);
        assertEquals(2, rows.size());
        assertTrue(rows.stream().allMatch(r -> ((List<?>) r.get("projects")).contains("org/a")));
    }

    @Test
    void scopedType_hitWithoutProject_hidden_likeSlices() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(hit("adr")));
        assertEquals(1, LoreSearchResource.scopeRows("adr", rows, Set.of("org/a")));
        assertTrue(rows.isEmpty());
    }

    @Test
    void sharedOrPendingTypes_notCut() {
        for (String t : List.of("actor", "agent_actor", "pain", "gain", "job", "quality_gate")) {
            List<Map<String, Object>> rows = new ArrayList<>(List.of(hit(t, "org/b"), hit(t)));
            assertEquals(0, LoreSearchResource.scopeRows(t, rows, Set.of("org/a")), t);
            assertEquals(2, rows.size(), t);
        }
    }

    @Test
    void scopeOff_nothingCut() {
        List<Map<String, Object>> rows = new ArrayList<>(List.of(hit("task", "org/b")));
        assertEquals(0, LoreSearchResource.scopeRows("task", rows, null));
        assertEquals(1, rows.size());
    }

    @Test
    void everyBranchTypeIsClassified() {
        for (String t : LoreSearchResource.branchTypes())
            assertTrue(LoreSearchResource.SCOPED_TYPES.contains(t) || LoreSearchResource.UNSCOPED_TYPES.containsKey(t),
                "тип поиска " + t + " не классифицирован: скоупный или общий (с причиной)");
    }
}
