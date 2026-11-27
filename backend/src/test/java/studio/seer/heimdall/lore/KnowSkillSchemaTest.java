package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-01 + SKILL-03 (SPEC-SKILLS-TAGS-062 §5, §6, §11):
 * V96 — вершина KnowSkill и рёбра скиллов; V97 — посев словаря skill_status и трёх скиллов окна
 * OQ-062-SKILL-SEED. Номера выделены линии скиллов (V94 — KREG-01, V95 — SKILL-05, V98–V99 — линия реестра).
 */
class KnowSkillSchemaTest {

    private static LoreSchemaMigrations.Step step(int version) {
        return LoreSchemaMigrations.STEPS.stream().filter(s -> s.version() == version)
            .findFirst().orElseThrow(() -> new AssertionError("нет шага V" + version));
    }

    @Test
    void v96DeclaresKnowSkillVertex() {
        LoreSchemaMigrations.Step s = step(96);
        assertEquals("know_skill", s.name());
        assertEquals(17, s.compatMajor(), "аддитивно — major 17");
        List<String> sql = s.sql();
        assertTrue(sql.contains("CREATE VERTEX TYPE KnowSkill IF NOT EXISTS"), sql.toString());
        for (String p : List.of("skill_id", "name", "title", "body_md", "version", "status", "source", "created_at", "updated_at"))
            assertTrue(sql.stream().anyMatch(x -> x.matches("CREATE PROPERTY KnowSkill\\." + p + "\\s+IF NOT EXISTS STRING")),
                "поле " + p + " объявлено: " + sql);
        assertTrue(sql.contains("CREATE INDEX IF NOT EXISTS ON KnowSkill (skill_id) UNIQUE"), "двойник скилла — отказ записи");
    }

    @Test
    void v96DeclaresSkillEdges() {
        List<String> sql = step(96).sql();
        assertTrue(sql.contains("CREATE EDGE TYPE APPLIES_TO_ROLE IF NOT EXISTS"), sql.toString());
        // EXTENDS — ключевое слово SQL ArcadeDB (CREATE TYPE … EXTENDS …): тип ребра назван по образцу UC_EXTENDS
        assertTrue(sql.contains("CREATE EDGE TYPE SKILL_EXTENDS IF NOT EXISTS"), sql.toString());
        // BELONGS_TO_PROJECT и OWNED_BY есть давно — шаг их не переобъявляет
        assertFalse(sql.stream().anyMatch(x -> x.contains("TYPE BELONGS_TO_PROJECT") || x.contains("TYPE OWNED_BY")), sql.toString());
    }

    @Test
    void v97IsReviewedJavaSeed() {
        LoreSchemaMigrations.Step s = step(97);
        assertEquals(SkillSeed.STEP, s.name());
        assertEquals(17, s.compatMajor());
        assertTrue(s.sql().isEmpty(), "Java-шаг: только INSERT недостающего");
        assertTrue(V1SchemaSafetyChecklist.JAVA_STEPS_REVIEWED.containsKey(SkillSeed.STEP));
    }

    @Test
    void skillStatusDictIsTheLifecycle() {
        List<String> codes = SkillSeed.STATUS_DICT.stream().map(StatusDictCoreSeed.Entry::code).toList();
        assertEquals(SkillRules.STATUSES, codes, "словарь и гард записи — один источник");
        List<StatusDictCoreSeed.Insert> plan = StatusDictCoreSeed.plan(SkillSeed.DICT_SEEDS, Map.of("skill_status", Set.of("draft")));
        assertEquals(List.of("active", "deprecated"), plan.stream().map(StatusDictCoreSeed.Insert::code).toList(),
            "существующие строки не трогаются");
    }

    @Test
    void threeSeedSkillsOfTheWindow() {
        assertEquals(List.of("skill:release-cutover", "skill:qg-triage", "skill:adr-review"),
            SkillSeed.SKILLS.stream().map(SkillSeed.Skill::skillId).toList());
        for (SkillSeed.Skill k : SkillSeed.SKILLS) {
            assertEquals("active", k.status(), k.skillId());
            assertEquals("seed", k.source(), k.skillId());
            assertFalse(k.projects().isEmpty(), k.skillId() + ": BELONGS_TO_PROJECT ≥1");
            assertFalse(k.roles().isEmpty(), k.skillId() + ": APPLIES_TO_ROLE ≥1");
            assertTrue(SkillRules.missingRequiredEdges(k.projects(), k.roles()).isEmpty(), k.skillId());
            assertTrue(k.bodyMd().contains("## Шаги"), k.skillId() + ": процедура — шаги");
            assertTrue(k.bodyMd().length() > 300, k.skillId() + ": тело не заглушка");
            assertEquals(k.skillId(), SkillRules.geoid(k.name()), "name = slug геоида");
        }
    }

    @Test
    void seedPlanSkipsExistingSkills() {
        assertEquals(List.of("skill:qg-triage", "skill:adr-review"),
            SkillSeed.plan(Set.of("skill:release-cutover")).stream().map(SkillSeed.Skill::skillId).toList());
        assertTrue(SkillSeed.plan(Set.of("skill:release-cutover", "skill:qg-triage", "skill:adr-review")).isEmpty());
    }

    @Test
    void outsideModelMarksSkillTypes() {
        // KREG-13 (владелец 26.11.2026: «всё, что есть в базе, должно быть описано в контракте модели»): KnowSkill — тип skill модели.
        assertFalse(ModelSchemaAdapter.OUTSIDE_MODEL.containsKey("KnowSkill"), "KnowSkill описан в модели — пометка «вне модели» снята");
        for (String t : List.of("APPLIES_TO_ROLE", "SKILL_EXTENDS"))
            assertTrue(ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t), t + " — рёбра скилла пока вне модели 1.18");
    }
}
