package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-06 (SPEC-SKILLS-TAGS-062 §10): QG-инварианты skill/tag рутиной канала 2 —
 * пороги явные, нарушений = 0, сторож краснеет (FAIL) при ≥1:
 * <ol>
 *   <li>скилл-висяк — KnowSkill без BELONGS_TO_PROJECT или без APPLIES_TO_ROLE;</li>
 *   <li>битая ссылка тега — токен {@code [[GEOID#тег]]} в теле без вершины тега.</li>
 * </ol>
 * Обратная проверка — сами тесты: добавили нарушение → красное, убрали → зелёное; срез не ответил →
 * NOT_MEASURED, а не PASS.
 */
class QgLoreSkillTagRoutineTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static Map<String, LoreQgResource.QGMetricEntry> byKey(List<LoreQgResource.QGMetricEntry> ms) {
        Map<String, LoreQgResource.QGMetricEntry> out = new HashMap<>();
        for (LoreQgResource.QGMetricEntry m : ms) out.put(m.key(), m);
        return out;
    }

    // ── 1. скилл-висяк ─────────────────────────────────────────────────────────

    @Test
    void danglingSkillTurnsRed() {
        var m = byKey(QgLoreSkillTagRoutine.normalizeFacts(QgLoreSkillTagRoutine.facts(
            List.of(row("skill_id", "skill:x", "projects", 0, "roles", 1)), List.of(), List.of(), live())));
        assertEquals(1.0, m.get("skills_dangling").value());
        assertEquals("FAIL", m.get("skills_dangling").status(), "порог 0, краснеет при ≥1");
    }

    @Test
    void noDanglingIsGreen() {
        var m = byKey(QgLoreSkillTagRoutine.normalizeFacts(QgLoreSkillTagRoutine.facts(List.of(), List.of(), List.of(), live())));
        assertEquals(0.0, m.get("skills_dangling").value());
        assertEquals("PASS", m.get("skills_dangling").status());
    }

    @Test
    void unreachableSliceIsNotMeasured() {
        var m = byKey(QgLoreSkillTagRoutine.normalizeFacts(QgLoreSkillTagRoutine.facts(null, null, null, null)));
        assertNull(m.get("skills_dangling").value());
        assertEquals("NOT_MEASURED", m.get("skills_dangling").status(), "не смогли проверить ≠ пусто");
        assertEquals("NOT_MEASURED", m.get("tag_broken_refs").status());
    }

    // ── 2. битая ссылка тега ────────────────────────────────────────────────────

    @Test
    void tokensAreParsedFromBodies() {
        assertEquals(List.of("security-review", "breaking-change"),
            QgLoreSkillTagRoutine.tagTokens("см. [[ADR-CI-001#security-review]] и [[D-2026-X#breaking-change]]; [[ADR-1]] без тега"));
    }

    /** Резолвер геоидов фикстуры: живые записи — ровно перечисленные. */
    private static TagRename.Geoids live(String... ids) {
        java.util.Set<String> s = java.util.Set.of(ids);
        return s::contains;
    }

    private static Map<String, LoreQgResource.QGMetricEntry> run(List<Map<String, Object>> bodies,
                                                                List<Map<String, Object>> tags, TagRename.Geoids g) {
        return byKey(QgLoreSkillTagRoutine.normalizeFacts(QgLoreSkillTagRoutine.facts(List.of(), bodies, tags, g)));
    }

    /** Геоид-вершина с бывшим именем в синонимах и легаси-вершина со свободным токеном (до V95). */
    private static final List<Map<String, Object>> TAGS = List.of(
        row("tag_id", "tag:security-review", "name", "security-review", "synonyms", List.of("sec-review")),
        row("tag_id", "customer-visible", "name", null, "synonyms", null));

    /**
     * Приёмка KREG-06: якорная вики-ссылка на раздел ([[DOC#раздел]], [[ADR-…#раздел]]) — не токен тега.
     * Формы — как в живых телах: кириллический раздел, раздел с заглавной, kebab-раздел, номер раздела.
     */
    @Test
    void anchorWikiLinksAreNotTagTokens() {
        List<Map<String, Object>> bodies = List.of(
            row("id", "doc_x", "body", "см. [[DOC-LORE-MODEL#раздел]], [[ADR-LORE-038#Context]], [[ADR-LORE-038#section-2]]"
                + " и [[SPEC-SKILLS-TAGS-062#6.5]]; заголовок ## раздел"));
        var m = run(bodies, TAGS, live("ADR-LORE-038", "DOC-LORE-MODEL", "SPEC-SKILLS-TAGS-062"));
        assertEquals(0.0, m.get("tag_broken_refs").value(), "якорь на раздел — не тег, сторож молчит");
        assertEquals("PASS", m.get("tag_broken_refs").status());
    }

    /** Приёмка KREG-06: хвост после rename — токен со старым именем (теперь синоним) — битая ссылка. */
    @Test
    void renameTailWithFormerNameIsBroken() {
        List<Map<String, Object>> bodies = List.of(row("id", "ADR-1", "body", "[[ADR-1#sec-review]] [[ADR-1#security-review]]"));
        var m = run(bodies, TAGS, live("ADR-1"));
        assertEquals(1.0, m.get("tag_broken_refs").value(), "sec-review — бывшее имя: rename его не переписал");
        assertEquals("FAIL", m.get("tag_broken_refs").status());
    }

    /** Приёмка KREG-06: живое имя тега при битом геоиде (записи нет) — битая ссылка. */
    @Test
    void liveTagWithBrokenGeoidIsBroken() {
        List<Map<String, Object>> bodies = List.of(row("id", "doc_x", "body", "[[GHOST-1#security-review]] [[ADR-1#customer-visible]]"));
        var m = run(bodies, TAGS, live("ADR-1"));
        assertEquals(1.0, m.get("tag_broken_refs").value(), "GHOST-1 не резолвится");
        assertEquals("FAIL", m.get("tag_broken_refs").status());
    }

    /** Живое имя (геоид-вершина и легаси-токен) с живым геоидом — PASS. */
    @Test
    void liveTagsWithLiveGeoidsAreGreen() {
        List<Map<String, Object>> bodies = List.of(row("id", "ADR-1", "body", "[[ADR-1#security-review]] [[ADR-1#customer-visible]]"));
        var m = run(bodies, TAGS, live("ADR-1"));
        assertEquals(0.0, m.get("tag_broken_refs").value());
        assertEquals("PASS", m.get("tag_broken_refs").status());
    }

    /** Резолвер геоидов не ответил — не измерено, а не PASS. */
    @Test
    void geoidResolverDownIsNotMeasured() {
        List<Map<String, Object>> bodies = List.of(row("id", "ADR-1", "body", "[[ADR-1#security-review]]"));
        var m = run(bodies, TAGS, null);
        assertNull(m.get("tag_broken_refs").value());
        assertEquals("NOT_MEASURED", m.get("tag_broken_refs").status());
    }

    @Test
    void routineIsNamedAndDaily() {
        assertEquals("qg-lore-skill-tag", QgLoreSkillTagRoutine.NAME);
        assertEquals(java.time.Duration.ofDays(1), new QgLoreSkillTagRoutine().cadence());
    }
}
