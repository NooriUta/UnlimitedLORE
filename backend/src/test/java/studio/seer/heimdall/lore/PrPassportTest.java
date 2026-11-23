package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MD-05 · паспорт PR. Критерий задачи: «у PR есть паспорт с заголовком и ссылкой,
 * связи PR↔задача/релиз ставятся на мерже сами, HAS_PR снят; пустых заголовков нет». 21.11.2026 задача вернулась
 * из READY FOR DEPLOY: #1641 записал данные PR и связь CLOSED_BY при мерже, а типа {@code pr} в модели не было —
 * связи задачи и релиза вели на тип без паспорта (NO_PASSPORT). Владелица: «доделать».
 *
 * <p>PR — запись {@code KnowPR} (ключ {@code pr_uid} «проект#номер»), только чтение: пишут её мерж
 * ({@code forgejo_pr_merge}), привязка к релизу и к задаче. Связи — те же рёбра, что у задачи и релиза:
 * задача → PR ({@code CLOSED_BY}), PR → релиз ({@code SHIPPED_IN}).
 */
class PrPassportTest {

    private static final String UID = "NooriUta/UnlimitedLORE#1641";

    @Test
    void тип_pr_паспорт_только_чтение_проект_последним() {
        assertTrue(LoreRecordRegistry.TYPES.contains("pr"), "нет паспорта PR v2");
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("pr"), "PR пишет мост Forgejo, не паспорт — только чтение");
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1), "проект — последним");
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get("pr");
        assertNotNull(g, "нет вершины PR в модели");
        assertEquals("KnowPR", g.vertex());
        assertEquals("pr_uid", g.key());
        assertNull(g.hist(), "истории SCD2 у PR нет");
    }

    @Test
    void источник_одна_строка_по_ключу_pr_uid() {
        LoreRecordResource.Source s = LoreRecordResource.sourceOf("pr");
        assertNotNull(s, "нет главного среза");
        assertEquals("pr_by_id", s.slice());
        LoreSlices.SliceDef d = LoreSlices.get("pr_by_id");
        assertNotNull(d, "pr_by_id не зарегистрирован");
        assertEquals(List.of(s.param()), d.required());
        assertTrue(d.baseSql().contains("FROM KnowPR"), d.baseSql());
        assertTrue(d.baseSql().contains("pr_uid = :id"), d.baseSql());
        assertTrue(d.baseSql().contains("in('CLOSED_BY')"), "задачи PR — по ребру CLOSED_BY: " + d.baseSql());
        assertTrue(d.baseSql().contains("out('SHIPPED_IN')"), "релизы PR — по ребру SHIPPED_IN: " + d.baseSql());
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("pr_by_id"), "скоуп паспорта PR — как у release_prs: решение");
    }

    /** Ключ PR — «проект#номер»: «#» допустим (как у релиза), кавычка — нет. */
    @Test
    void ключ_pr_проект_решётка_номер() {
        assertTrue(LoreRecordResource.idAllowed("pr", UID));
        assertTrue(LoreRecordResource.idAllowed("pr", "AIDA/aida-root#204"));
        assertFalse(LoreRecordResource.idAllowed("pr", "x' OR 1=1"));
        assertFalse(LoreRecordResource.idAllowed("pr", "a#b#c d"));
    }

    @Test
    void значения_паспорта_из_строки_среза() {
        Map<String, Object> row = new HashMap<>();
        row.put("pr_uid", UID);
        row.put("pr_number", 1641);
        row.put("git_projects", List.of("NooriUta/UnlimitedLORE"));
        row.put("title", "feat(model): паспорт PR (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05)");
        row.put("url", "https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1641");
        row.put("state", "merged");
        row.put("merged_at", "2026-11-20T18:02:11Z");
        row.put("head_ref", "feat/md05");
        row.put("base_ref", "develop");
        Map<String, Object> v = LoreRecordValues.values("pr", row);
        assertEquals("feat(model): паспорт PR (SPRINT_LORE_MODEL_DOCS_TIDY/MD-05)", v.get("title"));
        assertEquals(UID, v.get("code"));
        assertEquals("https://git.seidrstudio.pro/AIDA/UnlimitedLORE/pulls/1641", v.get("url"));
        assertEquals("merged", v.get("state"));
        assertEquals("2026-11-20T18:02:11Z", v.get("merged_at"));
        assertEquals(List.of("NooriUta/UnlimitedLORE"), v.get("projects"));
        assertEquals("feat/md05", v.get("head_ref"));
        assertEquals("develop", v.get("base_ref"));
        row.put("title", "  ");
        assertEquals(UID, LoreRecordValues.values("pr", row).get("title"),
            "пустой заголовок (у старых PR его нет) — подпись ключом, а не пустая шапка");
    }

    /** Задачи, закрытые PR, и релизы, в которые он вошёл, — вкладками по рёбрам CLOSED_BY и SHIPPED_IN. */
    @Test
    void связи_pr_задачи_и_релизы() {
        Map<String, Object> row = new HashMap<>();
        row.put("task_uids", List.of("SPRINT_LORE_MODEL_DOCS_TIDY/MD-05"));
        row.put("release_uids", List.of("NooriUta/UnlimitedLORE#v1.18.0"));
        List<String> got = LoreRecordValues.rowLinks("pr", row).stream()
            .map(m -> m.get("rel") + ":" + m.get("dir") + ":" + m.get("type") + ":" + m.get("id")).toList();
        assertEquals(List.of(
            "CLOSED_BY:in:task:SPRINT_LORE_MODEL_DOCS_TIDY/MD-05",
            "SHIPPED_IN:out:release:NooriUta/UnlimitedLORE#v1.18.0"), got);
        Map<String, String[]> want = Map.of(
            "tasks", new String[]{"CLOSED_BY", "in", "task"},
            "releases", new String[]{"SHIPPED_IN", "out", "release"});
        for (Map.Entry<String, String[]> e : want.entrySet()) {
            LoreRecordRegistry.Relation r = LoreRecordRegistry.get("pr").relations().stream()
                .filter(x -> x.key().equals(e.getKey())).findFirst().orElse(null);
            assertNotNull(r, "pr." + e.getKey() + " не объявлена");
            assertEquals(List.of(e.getValue()[0], e.getValue()[1], e.getValue()[2], "link_tab"),
                List.of(r.rel(), r.dir(), r.targetType(), r.place()));
        }
    }

    /** С обратной стороны: у задачи и релиза связь «PR» ведёт на тип pr, у которого теперь есть паспорт. */
    @Test
    void задача_и_релиз_ведут_в_паспорт_pr() {
        for (String[] tk : List.of(new String[]{"task", "prs"}, new String[]{"release", "prs"})) {
            LoreRecordRegistry.Relation r = LoreRecordRegistry.get(tk[0]).relations().stream()
                .filter(x -> x.key().equals(tk[1])).findFirst().orElseThrow();
            assertEquals("pr", r.targetType());
            assertNotNull(LoreRecordRegistry.get(r.targetType()), tk[0] + "." + tk[1] + ": цель без паспорта");
        }
        // Вкладка PR релиза: пустой заголовок — ключ PR, а не пустая строка.
        LoreRecordFrom.SliceLink sl = LoreRecordFrom.sliceLinkDef("release", "prs");
        Map<String, Object> link = LoreRecordFrom.sliceLink(sl, Map.of("pr_uid", UID, "pr_number", 1641));
        assertEquals(UID, link.get("id"));
        assertEquals(UID, link.get("title"), "PR без заголовка — подпись ключом");
    }

    /**
     * MD-05, «единая связь PR↔задача/релиз/спринт»: своего ребра спринт → PR в модели нет (HAS_PR снят, перенос 1.18
     * спринт → PR не переносит), поэтому спринт PR — выводной: спринты задач, которые PR закрывает
     * (CLOSED_BY → PART_OF). Поле только чтения, без ребра (rel нет), ссылки на паспорт спринта, без повтора.
     */
    @Test
    void спринты_pr_выводятся_через_задачи_без_своего_ребра() {
        assertTrue(LoreSlices.get("pr_by_id").baseSql().contains("in('CLOSED_BY').out('PART_OF')"),
            "спринты PR — через задачи: " + LoreSlices.get("pr_by_id").baseSql());
        Map<String, Object> row = new HashMap<>();
        row.put("pr_uid", UID);
        row.put("sprint_ids", List.of("SPRINT_LORE_MODEL_DOCS_TIDY", "SPRINT_LORE_MODEL_DOCS_TIDY", "SPRINT_QG_REBUILD"));
        assertEquals(List.of("SPRINT_LORE_MODEL_DOCS_TIDY", "SPRINT_QG_REBUILD"), LoreRecordValues.values("pr", row).get("sprints"),
            "две задачи одного спринта — спринт один раз");
        row.put("sprint_ids", List.of(List.of("SPRINT_A"), List.of("SPRINT_A", "SPRINT_B")));
        assertEquals(List.of("SPRINT_A", "SPRINT_B"), LoreRecordValues.values("pr", row).get("sprints"),
            "вложенный список (путь в два шага) — разворачивается");
        LoreRecordRegistry.Field f = LoreRecordRegistry.get("pr").fields().stream().filter(x -> x.key().equals("sprints")).findFirst().orElse(null);
        assertNotNull(f, "pr.sprints не объявлено в модели");
        assertEquals("ref", f.kind());
        assertEquals("sprint", f.refType());
        assertNull(f.rel(), "своего ребра спринт → PR нет — поле выводное");
        assertTrue(LoreRecordValues.rowLinks("pr", row).isEmpty(), "выводной спринт — не ребро, во вкладки связей не идёт");
    }

    /** Конец ребра PR в общих вкладках (ссылки, граф) — тот же вид и ключ, что у паспорта. */
    @Test
    void конец_ребра_pr_вид_и_ключ() {
        assertEquals("pr", LoreRecordEdgeLinks.KIND_OF_VERTEX.get("KnowPR"));
        assertTrue(LoreRecordEdgeLinks.ID_FIELDS.contains("pr_uid"));
    }
}
