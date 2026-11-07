package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-09: срез {@code docs kind=claude-rules} под
 * проектным скоупом отдавал 1 документ из ~10.
 *
 * <p>Корень: решение владелицы 19.10.2026 («Claude rules infra пока ни к чему
 * не привязывай») оставляет доки {@code claude-rules} и ранбуки области
 * {@code infra} БЕЗ проекта намеренно — это знание о машине, а не о продукте.
 * А построчный скоуп отсекает всё, у чего нет ребра проекта. Виден оставался
 * только тот единственный док, которому ребро проекта всё же поставили.
 *
 * <p>Правило (обобщение): запись, по решению владелицы намеренно лишённая
 * проекта, построчным скоупом не режется. Записи того же вида, но С проектом,
 * подчиняются скоупу как обычно.
 */
class ScopeExemptRowsTest {

    private static Map<String, Object> row(String idField, String id, List<String> projects) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put(idField, id);
        r.put("projects", projects);
        return r;
    }

    @Test
    void claudeRulesDocsAndInfraRunbooksAreTheExemptKinds() {
        assertEquals(Map.of("kind", "claude-rules"), ScopeExemptRows.exemptParams("docs", Map.of(), Set.of("p")));
        assertEquals(Map.of("area", "infra"), ScopeExemptRows.exemptParams("runbooks", Map.of(), Set.of("p")));
        // Положительный контроль: исключение живёт только у срезов, где решение владелицы есть.
        assertNull(ScopeExemptRows.exemptParams("specs", Map.of(), Set.of("p")));
        assertNull(ScopeExemptRows.exemptParams("adrs", Map.of(), Set.of("p")));
    }

    @Test
    void exemptionKeepsTheCallersOtherFilters() {
        Map<String, String> p = ScopeExemptRows.exemptParams("docs",
            Map.of("kind", "claude-rules", "component", "FORSETI"), Set.of("p"));
        assertEquals(Map.of("kind", "claude-rules", "component", "FORSETI"), p);
    }

    @Test
    void noExemptionWhenItCannotMatchOrScopeIsOff() {
        assertNull(ScopeExemptRows.exemptParams("docs", Map.of("kind", "guide"), Set.of("p")),
            "просили другой вид — исключённые доки в выдачу не подмешиваются");
        assertNull(ScopeExemptRows.exemptParams("docs", Map.of("project", "x"), Set.of("p")),
            "явный фильтр по проекту — записи без проекта ему не отвечают");
        assertNull(ScopeExemptRows.exemptParams("docs", Map.of(), null),
            "скоупа нет — он и так видит всё, второй запрос не нужен");
        assertNull(ScopeExemptRows.exemptParams("docs", Map.of(), Set.of()),
            "пустой скоуп — честный 403 SCOPE_EMPTY, а не подмешивание");
    }

    @Test
    void projectlessExemptRowsAreMergedInSortedAndDeduped() {
        List<Map<String, Object>> scoped = new ArrayList<>(List.of(
            row("doc_id", "claude_rules_datawanderers_lore", List.of("AIDA/Datawanderers-ServerandLore"))));
        List<Map<String, Object>> exempt = List.of(
            row("doc_id", "claude_rules_global", List.of()),
            row("doc_id", "claude_rules_datawanderers_lore", List.of("AIDA/Datawanderers-ServerandLore")),
            row("doc_id", "claude_rules_aida_root", null),
            // С проектом, но не в разрешённых — подчиняется скоупу, не подмешивается.
            row("doc_id", "claude_rules_foreign", List.of("AIDA/Other")));

        ScopeExemptRows.Merged m = ScopeExemptRows.merge("docs", scoped, exempt);

        assertEquals(List.of("claude_rules_aida_root", "claude_rules_datawanderers_lore", "claude_rules_global"),
            m.rows().stream().map(r -> String.valueOf(r.get("doc_id"))).toList());
        assertEquals(2, m.added(), "добавлены ровно два дока без проекта");
    }

    @Test
    void scopeMarkerSaysHowManyRowsCameInByExemption() {
        Map<String, Object> marker = new LinkedHashMap<>(Map.of("applied", true));
        ScopeExemptRows.annotate(marker, "docs", 9);
        assertEquals(9, marker.get("exempt_rows"));
        assertTrue(String.valueOf(marker.get("exempt_note")).contains("claude-rules"), String.valueOf(marker));

        Map<String, Object> untouched = new LinkedHashMap<>(Map.of("applied", true));
        ScopeExemptRows.annotate(untouched, "docs", 0);
        assertFalse(untouched.containsKey("exempt_rows"), "ничего не подмешано — и сказать нечего");
    }
}
