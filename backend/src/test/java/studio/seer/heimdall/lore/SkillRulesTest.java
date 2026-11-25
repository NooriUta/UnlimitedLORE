package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 + SKILL-02 (SPEC-SKILLS-TAGS-062 §5–§7): гарды записи скилла —
 * чистые функции, тот же код зовёт {@link LoreSkillResource}.
 *
 * <ul>
 *   <li>создание без BELONGS_TO_PROJECT ≥1 или APPLIES_TO_ROLE ≥1 → REFUSED со списком недостающих рёбер;</li>
 *   <li>цикл EXTENDS → REFUSED с цепочкой наследования;</li>
 *   <li>снятие последнего проекта/роли → REFUSED (висяк не оставляем);</li>
 *   <li>deprecated → active — только owner (OWNED_BY), иначе NOOP с подсказкой.</li>
 * </ul>
 */
class SkillRulesTest {

    // ── идентификатор skill:<slug> ─────────────────────────────────────────────

    @Test
    void geoidFromBareSlugOrGeoid() {
        assertEquals("skill:release-cutover", SkillRules.geoid("release-cutover"));
        assertEquals("skill:release-cutover", SkillRules.geoid("skill:release-cutover"));
        assertEquals("release-cutover", SkillRules.slug("skill:release-cutover"));
    }

    @Test
    void geoidRejectsNonKebab() {
        assertNull(SkillRules.geoid("Release Cutover"));
        assertNull(SkillRules.geoid("skill:"));
        assertNull(SkillRules.geoid(null));
        assertNull(SkillRules.geoid("tag:release"));
    }

    // ── обязательные рёбра при создании (SKILL-01) ─────────────────────────────

    @Test
    void createWithoutBothEdgesNamesBoth() {
        assertEquals(List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE"),
            SkillRules.missingRequiredEdges(List.of(), null));
    }

    @Test
    void createWithoutRoleNamesRoleOnly() {
        assertEquals(List.of("APPLIES_TO_ROLE"),
            SkillRules.missingRequiredEdges(List.of("NooriUta/UnlimitedLORE"), List.of(" ")));
    }

    @Test
    void createWithBothEdgesPasses() {
        assertTrue(SkillRules.missingRequiredEdges(List.of("NooriUta/UnlimitedLORE"), List.of("full")).isEmpty());
    }

    @Test
    void refusalCarriesSpec061Envelope() {
        Map<String, Object> r = SkillRules.refusedMissingEdges(List.of("APPLIES_TO_ROLE"));
        assertEquals("REFUSED", r.get("error"));
        assertEquals(List.of("APPLIES_TO_ROLE"), r.get("missing"));
        assertEquals(List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE"), r.get("allowed"));
        assertEquals("describe_full skill:*", r.get("hint"));
        assertTrue(String.valueOf(r.get("next")).contains("projects") && String.valueOf(r.get("next")).contains("roles"),
            "next step называет оба поля запроса: " + r.get("next"));
    }

    // ── EXTENDS без циклов (SKILL-02) ───────────────────────────────────────────

    @Test
    void selfExtendIsACycle() {
        assertEquals(List.of("skill:a", "skill:a"), SkillRules.extendsCycle(Map.of(), "skill:a", "skill:a"));
    }

    @Test
    void closingEdgeReturnsTheChain() {
        // a → b → c уже есть; добавляем c → a — цикл c → a → b → c
        Map<String, List<String>> g = Map.of("skill:a", List.of("skill:b"), "skill:b", List.of("skill:c"));
        assertEquals(List.of("skill:c", "skill:a", "skill:b", "skill:c"), SkillRules.extendsCycle(g, "skill:c", "skill:a"));
    }

    @Test
    void diamondIsNotACycle() {
        Map<String, List<String>> g = Map.of("skill:a", List.of("skill:b", "skill:c"), "skill:b", List.of("skill:d"));
        assertNull(SkillRules.extendsCycle(g, "skill:c", "skill:d"));
    }

    @Test
    void cycleRefusalShowsChain() {
        Map<String, Object> r = SkillRules.refusedCycle(List.of("skill:c", "skill:a", "skill:b", "skill:c"));
        assertEquals("REFUSED", r.get("error"));
        assertEquals("skill:c → skill:a → skill:b → skill:c", r.get("hint"));
        assertEquals(List.of("skill:c", "skill:a", "skill:b", "skill:c"), r.get("chain"));
    }

    // ── снятие обязательного ребра не оставляет висяка (SKILL-02) ───────────────

    @Test
    void removingLastRequiredEdgeIsRefused() {
        assertTrue(SkillRules.removalLeavesDangling("project", 1));
        assertTrue(SkillRules.removalLeavesDangling("role", 1));
        assertFalse(SkillRules.removalLeavesDangling("role", 2));
        assertFalse(SkillRules.removalLeavesDangling("extends", 1), "EXTENDS не обязателен");
        assertFalse(SkillRules.removalLeavesDangling("owner", 1), "OWNED_BY не обязателен");
    }

    @Test
    void relMapsToEdgeType() {
        assertEquals("APPLIES_TO_ROLE", SkillRules.edgeOf("role"));
        assertEquals("BELONGS_TO_PROJECT", SkillRules.edgeOf("project"));
        assertEquals("SKILL_EXTENDS", SkillRules.edgeOf("extends"));
        assertEquals("OWNED_BY", SkillRules.edgeOf("owner"));
        assertNull(SkillRules.edgeOf("tag"));
    }

    // ── жизненный цикл статуса (SKILL-01, §5 stateDiagram) ─────────────────────

    @Test
    void statusDictIsTheLifecycle() {
        assertEquals(List.of("draft", "active", "deprecated"), SkillRules.STATUSES);
    }

    @Test
    void allowedMoves() {
        assertEquals(SkillRules.Move.OK, SkillRules.move("draft", "active", false));
        assertEquals(SkillRules.Move.OK, SkillRules.move("active", "deprecated", false));
        assertEquals(SkillRules.Move.OK, SkillRules.move("draft", "deprecated", false));
        assertEquals(SkillRules.Move.SAME, SkillRules.move("active", "active", false));
    }

    @Test
    void reactivationOnlyByOwner() {
        assertEquals(SkillRules.Move.NOOP_OWNER_ONLY, SkillRules.move("deprecated", "active", false));
        assertEquals(SkillRules.Move.OK, SkillRules.move("deprecated", "active", true));
    }

    @Test
    void backToDraftAndUnknownAreRefused() {
        assertEquals(SkillRules.Move.BAD_TRANSITION, SkillRules.move("active", "draft", true));
        assertEquals(SkillRules.Move.BAD_STATUS, SkillRules.move("draft", "archived", true));
    }

    @Test
    void noopCarriesOwnerHint() {
        Map<String, Object> r = SkillRules.noopOwnerOnly("skill:a", "e8c633a1");
        assertEquals("NOOP", r.get("error"));
        assertEquals("deprecated", r.get("status"));
        assertTrue(String.valueOf(r.get("hint")).contains("OWNED_BY"), String.valueOf(r.get("hint")));
        assertEquals("e8c633a1", r.get("owner"));
    }

    // ── RBAC записи skill:* (§5) ────────────────────────────────────────────────

    @Test
    void writersAreFullAndArchitect() {
        assertEquals(List.of("full", "architect"), SkillRules.WRITERS);
        Map<String, Object> r = SkillRules.forbiddenForRole("developer");
        assertEquals("FORBIDDEN_FOR_ROLE", r.get("error"));
        assertEquals(List.of("full", "architect"), r.get("allowed"));
        assertTrue(String.valueOf(r.get("detail")).contains("developer"));
    }

    @Test
    void sourceIsSeedAgentHuman() {
        assertEquals(List.of("seed", "agent", "human"), SkillRules.SOURCES);
    }
}
