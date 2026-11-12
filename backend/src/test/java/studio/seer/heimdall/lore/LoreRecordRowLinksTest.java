package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * S4-29 v3: вкладки связей, которые читаются из строки основного среза записи
 * ({@link LoreRecordValues#rowLinks}). Вкладка паспорта без данных показала бы «0 — пусто
 * (проверено)», не проверив ничего; поэтому каждая новая вкладка-связь здесь проверена на то,
 * что фасад кладёт её рёбра в {@code links[]} с теми же rel/dir, что у связи в реестре.
 */
class LoreRecordRowLinksTest {

    private static List<String> relDirs(List<Map<String, Object>> links) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> l : links) out.add(l.get("rel") + ":" + l.get("dir") + "=" + l.get("id") + "/" + l.get("type"));
        return out;
    }

    @Test
    void decisionAnswersAndSupersedes() {
        List<String> got = relDirs(LoreRecordValues.rowLinks("decision", Map.of(
            "supersedes_ids", List.of("D-OLD"), "answers_ids", List.of("Q-1"))));
        assertEquals(List.of("SUPERSEDES:out=D-OLD/decision", "ANSWERS:out=Q-1/question"), got);
    }

    @Test
    void questionAnsweredByAndGates() {
        List<String> got = relDirs(LoreRecordValues.rowLinks("question", Map.of(
            "answered_by", List.of("D-1"), "gating_tasks", List.of("SPRINT_X/A-1"))));
        assertEquals(List.of("ANSWERS:in=D-1/decision", "GATES:out=SPRINT_X/A-1/task"), got);
    }

    @Test
    void milestoneSprints() {
        assertEquals(List.of("TARGETS_MILESTONE:in=SPRINT_A/sprint"),
            relDirs(LoreRecordValues.rowLinks("milestone", Map.of("direct_sprint_ids", List.of("SPRINT_A")))));
    }

    @Test
    void componentTechSpecOpensTechPassport() {
        List<String> got = relDirs(LoreRecordValues.rowLinks("component", Map.of(
            "specs", List.of("SPEC-LORE-X", "SPEC-TECH-FORSETI-REACT"), "adrs", List.of("ADR-1"),
            "tech", List.of("react"), "sub_components", List.of("SUB"))));
        assertEquals(List.of("DOCUMENTED_IN:out=SPEC-LORE-X/spec", "DOCUMENTED_IN:out=SPEC-TECH-FORSETI-REACT/tech",
            "BELONGS_TO:in=ADR-1/adr", "USES:out=react/tech_ref", "PARENT_OF:in=SUB/component"), got,
            "SPEC-TECH-… — паспорт технологии; tech_id USES — не ключ паспорта, тип tech_ref");
    }

    @Test
    void featureChildrenTasksAndValue() {
        List<String> got = relDirs(LoreRecordValues.rowLinks("feature", Map.of(
            "child_uc_ids", List.of("UC-2"), "task_uids", List.of("S/T-1"), "actor_ids", List.of("A"),
            "pain_ids", List.of("P"), "gain_ids", List.of("G"), "job_ids", List.of("J"))));
        assertEquals(List.of("DECOMPOSES_INTO:out=UC-2/feature", "REALIZES:in=S/T-1/task", "HAS_ACTOR:out=A/actor",
            "ADDRESSES:out=P/pain", "PROMISES:out=G/gain", "HELPS_WITH:out=J/job"), got);
    }

    @Test
    void adrBlocksIsRead() {
        assertTrue(relDirs(LoreRecordValues.rowLinks("adr", Map.of("blocks_ids", List.of("ADR-2"))))
            .contains("DEPENDS_ON:in=ADR-2/adr"), "«блокирует» во вкладке «Связи ADR» читается из среза adr");
    }

    /**
     * Каждая вкладка-связь новых типов паспорта получает данные: rel/dir связи из реестра
     * встречается в rowLinks на полной строке. Типы задачи и релиза читают часть связей
     * отдельными срезами (adrs_of_task, gating_questions_of_task, release_sprints, release_prs).
     */
    @Test
    void everyNewLinkTabIsFilledFromTheRow() {
        List<String> x = List.of("x");
        Map<String, Map<String, Object>> full = Map.ofEntries(
            Map.entry("decision", Map.of("supersedes_ids", x, "answers_ids", x,
                "superseded_by_ids", x, "traced_by_ucs", x)),
            Map.entry("question", Map.of("answered_by", x, "gating_tasks", x)),
            Map.entry("milestone", Map.of("direct_sprint_ids", x, "feature_ids", x)),
            Map.entry("component", Map.of("specs", List.of("x", "SPEC-TECH-X-JAVA"), "adrs", x, "tech", x,
                "sub_components", x, "decisions", x, "questions", x, "features", x, "docs", x, "qgs", x, "products", x)),
            Map.entry("feature", Map.ofEntries(Map.entry("child_uc_ids", x), Map.entry("task_uids", x),
                Map.entry("actor_ids", x), Map.entry("pain_ids", x), Map.entry("gain_ids", x), Map.entry("job_ids", x),
                // 11.11 (полнота модели рёбер)
                Map.entry("relieved_pain_ids", x), Map.entry("delivered_gain_ids", x), Map.entry("performed_job_ids", x),
                Map.entry("traced_adrs", x), Map.entry("traced_decisions", x), Map.entry("milestone_ids", x),
                Map.entry("builds_on_ids", x), Map.entry("built_on_by_ids", x), Map.entry("includes_ids", x),
                Map.entry("included_by_ids", x), Map.entry("extends_ids", x), Map.entry("extended_by_ids", x))),
            Map.entry("sprint", Map.of("depends_on", x, "blocks", x, "adr_ids", x, "doc_ids", x)),
            Map.entry("task", Map.of("closed_by_prs", x, "realizes_uc", x)),
            Map.entry("adr", Map.of("depends_on_ids", x, "blocks_ids", x, "supersedes_ids", x, "superseded_by_ids", x,
                "implemented_in_ids", x, "release_ids", x, "justified_task_uids", x, "traced_by_ucs", x)),
            Map.entry("spec", Map.of()), Map.entry("release", Map.of("adr_ids", x)), Map.entry("tech", Map.of()),
            // S4-29 (53а): у проекта все вкладки читаются отдельными срезами — из строки ничего.
            Map.entry("project", Map.of()),
            // S4-PRODUCTS-NODE: компоненты и подпродукты — из строки; сценарии и профиль клиента — срезами.
            Map.entry("product", Map.of("components", x, "sub_products", x, "serves", x, "served_by", x, "milestone_ids", x)));
        assertEquals(Set.copyOf(LoreRecordRegistry.TYPES), full.keySet(), "проверены все типы паспорта");
        for (Map.Entry<String, Map<String, Object>> e : full.entrySet()) {
            String type = e.getKey();
            Set<String> have = new HashSet<>();
            Set<String> haveTyped = new HashSet<>();
            for (Map<String, Object> l : LoreRecordValues.rowLinks(type, e.getValue())) {
                have.add(l.get("rel") + ":" + l.get("dir"));
                haveTyped.add(l.get("rel") + ":" + l.get("dir") + ":" + l.get("type"));
            }
            Set<String> bySlice = LoreRecordValues.READ_BY_SLICE.getOrDefault(type, Map.of()).keySet();
            Set<String> unread = LoreRecordValues.UNREAD_LINK_TABS.getOrDefault(type, Set.of());
            // Одно ребро в двух вкладках (у компонента BELONGS_TO:in — ADR и спринты, S4-29) —
            // вкладки различаются типом цели, и сверка идёт с ним.
            Map<String, Long> relDirCount = new java.util.HashMap<>();
            for (LoreRecordRegistry.Relation r : LoreRecordRegistry.get(type).relations())
                if ("link_tab".equals(r.place())) relDirCount.merge(r.rel() + ":" + r.dir(), 1L, Long::sum);
            for (LoreRecordRegistry.Relation r : LoreRecordRegistry.get(type).relations()) {
                if (!"link_tab".equals(r.place())) continue;
                String rd = r.rel() + ":" + r.dir();
                boolean fromRow = relDirCount.get(rd) > 1 ? haveTyped.contains(rd + ":" + r.targetType()) : have.contains(rd);
                int ways = (fromRow ? 1 : 0) + (bySlice.contains(r.key()) ? 1 : 0)
                    + (unread.contains(r.key()) ? 1 : 0);
                assertEquals(1, ways, type + "/" + r.key()
                    + ": вкладка ровно одним способом — из строки, отдельным срезом или названа непрочитанной");
            }
            for (String k : unread)
                assertTrue(LoreRecordRegistry.get(type).relations().stream()
                    .anyMatch(r -> r.key().equals(k) && "link_tab".equals(r.place())), type + "/" + k + ": список непрочитанных не протух");
        }
    }

    @Test
    void unreadTabsAreNamedInDataStateNotSilentZero() {
        List<Map<String, Object>> st = LoreRecordValues.unreadState("spec");
        assertEquals(List.of("relation:refsIn", "relation:refsOut"), st.stream().map(m -> m.get("source")).toList());
        for (Map<String, Object> m : st) {
            assertEquals("error", m.get("state"), "не проверено ≠ пусто");
            assertNotNull(m.get("reason"));
        }
        // 11.11: у решения теперь объявлены «Ссылки» (REFERENCES) без среза — полностью прочитанный
        // тип для этой проверки — веха.
        assertTrue(LoreRecordValues.unreadState("milestone").isEmpty());
    }
}
