package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/MINI-04-LIST-ROWS-CATEGORY-PROJECTS — строки срезов-списков
 * проектных записей ВСЕГДА несут {@code status_category} и {@code projects} (массив слагов).
 * {@code adrs}/{@code sprints} исторически отдают ось проекта под именем {@code git_projects}
 * (на нём завязан веб) — {@code projects} добавляется аддитивно, {@code git_projects} остаётся.
 */
class LoreProjectsFieldTest {

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /** Тот же конвейер, что в AidaLoreResource.slice: категория статуса + ось проекта. */
    private static List<Map<String, Object>> pipeline(String slice, List<Map<String, Object>> rows) {
        return LoreProjectsField.enrich(slice, LoreStatusCategory.enrich(slice, rows));
    }

    @Test
    void adrs_sprints_specs_каждаяСтрокаНесётStatusCategoryИProjectsМассивом() {
        Map<String, List<Map<String, Object>>> cases = Map.of(
            "adrs", List.of(
                row("adr_id", "ADR-1", "status", "accepted", "git_projects", List.of("lore")),
                row("adr_id", "ADR-2", "status", "draft")),               // ось не пришла (null опущен)
            "sprints", List.of(
                row("sprint_id", "S1", "status_raw", "done", "git_projects", List.of("lore", "mini")),
                row("sprint_id", "S2")),
            "specs", List.of(
                row("spec_id", "SPEC-1", "status", "accepted", "projects", List.of("lore")),
                row("spec_id", "SPEC-2", "status", "draft")));
        for (var e : cases.entrySet()) {
            for (Map<String, Object> r : pipeline(e.getKey(), new ArrayList<>(e.getValue()))) {
                assertTrue(r.containsKey("status_category"), e.getKey() + ": нет status_category в " + r);
                assertInstanceOf(List.class, r.get("projects"), e.getKey() + ": projects не массив в " + r);
            }
        }
    }

    @Test
    void projects_тоЖеЗначениеЧтоGitProjects_аGitProjectsНеУдалён() {
        List<Map<String, Object>> out = pipeline("adrs",
            List.of(row("adr_id", "ADR-1", "status", "accepted", "git_projects", List.of("lore", "mini"))));
        assertEquals(List.of("lore", "mini"), out.get(0).get("projects"));
        assertEquals(List.of("lore", "mini"), out.get(0).get("git_projects"), "git_projects — веб на нём");
    }

    @Test
    void своёПолеProjectsНеПерезаписывается() {
        List<Map<String, Object>> out = LoreProjectsField.enrich("specs",
            List.of(row("spec_id", "S", "projects", List.of("a"), "git_projects", List.of("b"))));
        assertEquals(List.of("a"), out.get(0).get("projects"));
    }

    @Test
    void любойСрезСGitProjectsПолучаетProjects_иСкалярСтановитсяМассивом() {
        List<Map<String, Object>> out = LoreProjectsField.enrich("products",
            List.of(row("product_id", "P", "git_projects", "lore")));
        assertEquals(List.of("lore"), out.get(0).get("projects"));
    }

    @Test
    void чужойСрезБезОсиПроекта_тотЖеСписок() {
        List<Map<String, Object>> rows = List.of(row("tag_id", "T"));
        assertSame(rows, LoreProjectsField.enrich("tags_usage", rows));
    }
}
