package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-04 (SPEC-SKILLS-TAGS-062 §9) и RBAC записи skill:* (§5):
 * срезы skills (short, без body_md) / skills_full (с body_md) по project/role, карточки describe tag:* / skill:*
 * по форме SPEC-AGENT-SURFACE-061 §8, право записи — только full и architect.
 */
class SkillSurfaceTest {

    // ── срезы ───────────────────────────────────────────────────────────────────

    @Test
    void skillsShortOmitsBody() {
        LoreSlices.SliceDef d = LoreSlices.get("skills");
        assertNotNull(d, "срез skills объявлен");
        assertFalse(d.baseSql().contains("body_md"), "short: тело не отдаётся — " + d.baseSql());
        for (String col : List.of("skill_id", "title", "status", "version", "AS roles", "AS projects"))
            assertTrue(d.baseSql().contains(col), col + ": " + d.baseSql());
        assertEquals(Set.of("project", "role", "status"), d.optionalFilters().keySet());
        assertTrue(d.required().isEmpty());
    }

    @Test
    void skillsFullCarriesBody() {
        LoreSlices.SliceDef d = LoreSlices.get("skills_full");
        assertNotNull(d, "срез skills_full объявлен");
        assertTrue(d.baseSql().contains("body_md"), d.baseSql());
        assertEquals(LoreSlices.get("skills").optionalFilters(), d.optionalFilters(), "те же фильтры, что у short");
    }

    @Test
    void projectAndRoleFiltersCompose() {
        String sql = LoreSlices.compose("skills", Map.of("project", "NooriUta/UnlimitedLORE", "role", "full")).sql();
        assertTrue(sql.contains("out('BELONGS_TO_PROJECT').slug CONTAINS :project"), sql);
        assertTrue(sql.contains("out('APPLIES_TO_ROLE').code CONTAINS :role"), sql);
        assertEquals(1, sql.split(" WHERE ", -1).length - 1, "одно WHERE, второе условие — AND: " + sql);
    }

    @Test
    void skillSlicesAreProjectScoped() {
        assertEquals("out('BELONGS_TO_PROJECT').slug", LoreSlices.PROJECT_SCOPED.get("skills"));
        assertEquals("out('BELONGS_TO_PROJECT').slug", LoreSlices.PROJECT_SCOPED.get("skills_full"));
    }

    @Test
    void danglingSliceFeedsTheInvariant() {
        LoreSlices.SliceDef d = LoreSlices.get("skills_dangling");
        assertNotNull(d, "срез висяков для QG-инварианта §10.1");
        assertTrue(d.baseSql().contains("out('BELONGS_TO_PROJECT').size() = 0"), d.baseSql());
        assertTrue(d.baseSql().contains("out('APPLIES_TO_ROLE').size() = 0"), d.baseSql());
    }

    // ── describe-карточки (форма 061 §8) ────────────────────────────────────────

    /** Карточка — из реестра видов (один источник describe, KREG-07), не ручная. */
    private static Map<String, Object> card(String kind) {
        Map<String, Object> k = KnowDescribe.kindFor(kind, KnowRegistrySync.artifactKinds(), FieldDeclaredGuardTest.model());
        return k == null ? null : KnowDescribe.describeFull(k, Map.of("skill_status", SkillRules.STATUSES));
    }

    @Test
    void skillCardHasTheSpecShape() {
        Map<String, Object> c = card("skill:*");
        assertNotNull(c);
        assertEquals("skill:*", c.get("kind"));
        for (String k : List.of("params", "enums", "identities", "links", "guards", "errors"))
            assertTrue(c.containsKey(k), "карточка несёт " + k + ": " + c.keySet());
        @SuppressWarnings("unchecked") Map<String, Object> enums = (Map<String, Object>) c.get("enums");
        assertEquals(SkillRules.STATUSES, enums.get("skill_status"));
        assertEquals(SkillRules.SOURCES, enums.get("source"));
        assertEquals(List.of("architect", "full"), c.get("identities"));
        String errors = String.valueOf(c.get("errors"));
        for (String code : List.of("REFUSED", "NOOP", "INVALID_VALUE", "FORBIDDEN_FOR_ROLE"))
            assertTrue(errors.contains(code), code + " в errors: " + errors);
        String links = String.valueOf(c.get("links"));
        for (String rel : List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE", "SKILL_EXTENDS", "OWNED_BY"))
            assertTrue(links.contains(rel), rel + " в links: " + links);
    }

    @Test
    void skillCardIsReachableByGeoid() {
        assertEquals("skill:release-cutover", card("skill:release-cutover").get("kind"),
            "карточка вида отдаётся и по геоиду конкретного скилла");
    }

    @Test
    void tagCardHasTheSpecShape() {
        Map<String, Object> c = card("tag:*");
        assertNotNull(c);
        assertEquals("tag:*", c.get("kind"));
        for (String k : List.of("params", "enums", "identities", "links", "guards", "errors"))
            assertTrue(c.containsKey(k), k);
        assertTrue(String.valueOf(c.get("links")).contains("TAGGED_WITH"));
        assertTrue(String.valueOf(c.get("errors")).contains("partial_failure"), "rename с несопоставленными — §7");
    }

    @Test
    void unknownKindHasNoCard() {
        assertNull(card("adr:*"));
        assertNull(card(null));
    }

    // ── RBAC §5 ──────────────────────────────────────────────────────────────────

    @Test
    void onlyFullAndArchitectWriteSkills() {
        for (String p : List.of("full", "architect")) {
            assertNull(AgentScopeFilter.decide(p, "/lore/skill"), p);
            assertNull(AgentScopeFilter.decide(p, "/lore/skill/link"), p);
        }
        for (String p : List.of("developer", "pm", "tester", "marketer", "analyst", "product-analyst"))
            assertNotNull(AgentScopeFilter.decide(p, "/lore/skill"), p + " не пишет skill:*");
    }

    @Test
    void skillDenialSpeaksSpec061() {
        Object body = AgentScopeFilter.denialEntity("developer", "skill", "профилю доступны: full, architect");
        assertTrue(body instanceof Map<?, ?>, String.valueOf(body));
        Map<?, ?> m = (Map<?, ?>) body;
        assertEquals("FORBIDDEN_FOR_ROLE", m.get("error"));
        assertEquals(List.of("full", "architect"), m.get("allowed"));
        // прочие семейства — прежний код, клиенты его уже разбирают
        Object other = AgentScopeFilter.denialEntity("marketer", "adr", "x");
        assertTrue(other instanceof LoreResourceBase.LoreError e && "AGENT_SCOPE_FORBIDDEN".equals(e.error()), String.valueOf(other));
    }
}
