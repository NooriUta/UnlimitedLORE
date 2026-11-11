package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Разовая миграция «задача → компонент»: старое ребро BELONGS_TO KnowTask → LoreComponent
 * (так его ставил промоушен находки QG до PR #1265) переводится на TAGGED_WITH — ребро,
 * которое читают паспорт задачи, срез component_tasks и граф.
 *
 * <p>Чистая логика плана и применения, без БД: выбор задач, дедупликация, идемпотентность.
 * Работа на живой базе — {@code LoreTaskComponentEdgeMigrationLiveDbTest} (гоняет CI).
 */
class LoreTaskComponentEdgeMigrationTest {

    private static Map<String, Object> legacy(String rid, String oc, String ic, String task, String comp, String src) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("rid", rid);
        m.put("oc", oc);
        m.put("ic", ic);
        m.put("task_uid", task);
        m.put("component_id", comp);
        m.put("src", src);
        return m;
    }

    private static Map<String, Object> qgTask(String rid, String task, String comp) {
        return legacy(rid, "KnowTask", "LoreComponent", task, comp, "qg");
    }

    private static Map<String, Object> tagged(String oc, String ic, String task, String comp) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("oc", oc);
        m.put("ic", ic);
        m.put("task_uid", task);
        m.put("component_id", comp);
        return m;
    }

    @Test
    void ребро_задачи_к_компоненту_по_каталогу_TAGGED_WITH() {
        // Миграция обязана вести туда же, куда пишет новый код — одно правило с каталогом.
        assertEquals(LoreLinkTypes.componentEdgeOf("KnowTask"), LoreTaskComponentEdgeMigration.TARGET_EDGE);
        assertEquals("BELONGS_TO", LoreTaskComponentEdgeMigration.LEGACY_EDGE);
    }

    @Test
    void в_план_попадает_только_задача_к_компоненту() {
        var plan = LoreTaskComponentEdgeMigration.plan(List.of(
                qgTask("#10:1", "S/T-1", "C1"),
                legacy("#10:2", "KnowADR", "LoreComponent", null, "C1", null),     // ADR → компонент: законный BELONGS_TO
                legacy("#10:3", "KnowTask", "KnowSprint", "S/T-2", null, "qg"),     // задача → не компонент
                legacy("#10:4", "KnowDoc", "LoreComponent", null, "C2", null)),
            List.of());
        assertEquals(1, plan.items().size());
        assertEquals(List.of("S/T-1"), plan.taskUids());
        var it = plan.items().get(0);
        assertEquals("C1", it.componentId());
        assertTrue(it.createTagged());
        assertEquals(List.of("#10:1"), it.deleteRids());
        assertEquals(1, plan.toCreate());
        assertEquals(1, plan.toDelete());
        assertEquals(0, plan.unchanged());
        assertFalse(plan.noop());
    }

    @Test
    void уже_есть_TAGGED_WITH__не_создаём_второе_только_удаляем_старое() {
        var plan = LoreTaskComponentEdgeMigration.plan(
            List.of(qgTask("#10:1", "S/T-1", "C1")),
            List.of(tagged("KnowTask", "LoreComponent", "S/T-1", "C1"),
                    tagged("KnowADR", "KnowTag", null, null)));
        var it = plan.items().get(0);
        assertFalse(it.createTagged(), "TAGGED_WITH уже есть — дубль не нужен");
        assertEquals(List.of("#10:1"), it.deleteRids());
        assertEquals(0, plan.toCreate());
        assertEquals(1, plan.toDelete());
        assertEquals(1, plan.unchanged());
    }

    @Test
    void два_старых_ребра_одной_пары__одно_новое_и_оба_старых_на_удаление() {
        var plan = LoreTaskComponentEdgeMigration.plan(
            List.of(qgTask("#10:7", "S/T-1", "C1"), qgTask("#10:2", "S/T-1", "C1"), qgTask("#10:3", "S/T-1", "C2")),
            List.of());
        assertEquals(2, plan.items().size(), "пара (задача, компонент) — один пункт");
        assertEquals(List.of("S/T-1"), plan.taskUids(), "задача одна, хоть компонентов два");
        assertEquals(2, plan.toCreate());
        assertEquals(3, plan.toDelete());
        assertEquals(List.of("#10:2", "#10:7"), plan.items().get(0).deleteRids(), "порядок детерминирован");
    }

    @Test
    void ребро_с_подозрительным_rid_или_без_ключей__пропуск_а_не_запись() {
        var plan = LoreTaskComponentEdgeMigration.plan(List.of(
                qgTask("#10:1; DELETE FROM KnowTask", "S/T-1", "C1"),
                qgTask("#10:2", null, "C1"),
                qgTask("#10:3", "S/T-3", "")),
            List.of());
        assertTrue(plan.items().isEmpty());
        assertEquals(3, plan.skipped().size());
        assertTrue(plan.noop());
    }

    @Test
    void ответ_плана_несёт_счёты_и_список_задач() {
        var plan = LoreTaskComponentEdgeMigration.plan(
            List.of(qgTask("#10:1", "S/T-1", "C1"), legacy("#10:2", "KnowTask", "LoreComponent", "S/T-2", "C2", null)),
            List.of());
        Map<String, Object> out = plan.toMap();
        assertEquals("migration_id", out.keySet().iterator().next(), "первым *_id полем — его пишет журнал AO-01");
        assertEquals("qg-task-component-edge", out.get("migration_id"));
        assertEquals(true, out.get("dry_run"));
        assertEquals(2, out.get("tasks"));
        assertEquals(List.of("S/T-1", "S/T-2"), out.get("task_uids"));
        assertEquals(2, out.get("to_create"));
        assertEquals(2, out.get("to_delete"));
        @SuppressWarnings("unchecked")
        Map<String, Integer> bySrc = (Map<String, Integer>) out.get("by_src");
        assertEquals(1, bySrc.get("qg"));
        assertEquals(1, bySrc.get("(нет)"));
    }

    // ── применение ──────────────────────────────────────────────────────────

    /** Граф в памяти: старые рёбра по rid и множество пар TAGGED_WITH. */
    static final class FakeGraph implements LoreTaskComponentEdgeMigration.Ops {
        final Map<String, Map<String, Object>> legacy = new LinkedHashMap<>();
        final Set<String> taggedPairs = new HashSet<>();
        final List<String> log = new ArrayList<>();
        final Map<String, RuntimeException> failCreate = new HashMap<>();
        boolean createIsSilentNoop;

        FakeGraph with(Map<String, Object> row) { legacy.put((String) row.get("rid"), row); return this; }

        List<Map<String, Object>> legacyRows() { return new ArrayList<>(legacy.values()); }

        List<Map<String, Object>> taggedRows() {
            List<Map<String, Object>> out = new ArrayList<>();
            for (String p : taggedPairs) {
                String[] a = p.split("\\|");
                out.add(tagged("KnowTask", "LoreComponent", a[0], a[1]));
            }
            return out;
        }

        @Override public void createTagged(String taskUid, String componentId) {
            log.add("create " + taskUid + "|" + componentId);
            RuntimeException e = failCreate.get(taskUid);
            if (e != null) throw e;
            if (!createIsSilentNoop) taggedPairs.add(taskUid + "|" + componentId);
        }

        @Override public boolean taggedExists(String taskUid, String componentId) {
            return taggedPairs.contains(taskUid + "|" + componentId);
        }

        @Override public void deleteLegacy(String rid) {
            log.add("delete " + rid);
            legacy.remove(rid);
        }
    }

    @Test
    void применение_создаёт_новое_удаляет_старое_и_повтор_без_изменений() {
        FakeGraph g = new FakeGraph()
            .with(qgTask("#10:1", "S/T-1", "C1"))
            .with(qgTask("#10:2", "S/T-2", "C2"));
        g.taggedPairs.add("S/T-2|C2");   // у второй задачи новое ребро уже есть

        var plan = LoreTaskComponentEdgeMigration.plan(g.legacyRows(), g.taggedRows());
        var res = LoreTaskComponentEdgeMigration.apply(plan, g);
        assertEquals(2, res.found());
        assertEquals(1, res.created());
        assertEquals(2, res.deleted());
        assertEquals(1, res.unchanged());
        assertEquals(0, res.failed());
        assertTrue(g.legacy.isEmpty(), "старых рёбер не осталось");
        assertEquals(Set.of("S/T-1|C1", "S/T-2|C2"), g.taggedPairs);
        assertEquals("migration_id", res.toMap().keySet().iterator().next());
        assertEquals(false, res.toMap().get("dry_run"));

        // Второй прогон: искать нечего, писать нечего.
        var again = LoreTaskComponentEdgeMigration.plan(g.legacyRows(), g.taggedRows());
        assertTrue(again.noop());
        g.log.clear();
        var res2 = LoreTaskComponentEdgeMigration.apply(again, g);
        assertEquals(0, res2.found());
        assertEquals(0, res2.created() + res2.deleted() + res2.failed());
        assertTrue(g.log.isEmpty(), "повтор не трогает граф: " + g.log);
    }

    @Test
    void сбой_создания__старое_ребро_не_удаляется_и_задача_в_провалах() {
        FakeGraph g = new FakeGraph()
            .with(qgTask("#10:1", "S/T-1", "C1"))
            .with(qgTask("#10:2", "S/T-2", "C2"));
        g.failCreate.put("S/T-1", new IllegalStateException("arcade 500"));

        var res = LoreTaskComponentEdgeMigration.apply(
            LoreTaskComponentEdgeMigration.plan(g.legacyRows(), g.taggedRows()), g);
        assertEquals(1, res.failed());
        assertEquals(1, res.created());
        assertEquals(1, res.deleted());
        assertTrue(g.legacy.containsKey("#10:1"), "без нового ребра старое не удаляем — связь не должна пропасть");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> failed = (List<Map<String, Object>>) res.toMap().get("failed_items");
        assertEquals("S/T-1", failed.get(0).get("task_uid"));
        assertTrue(String.valueOf(failed.get(0).get("error")).contains("arcade 500"));
    }

    @Test
    void создание_прошло_молча_но_ребра_нет__провал_а_не_удаление() {
        FakeGraph g = new FakeGraph().with(qgTask("#10:1", "S/T-1", "C1"));
        g.createIsSilentNoop = true;   // CREATE EDGE по пустой выборке отвечает «ок» и ничего не пишет
        var res = LoreTaskComponentEdgeMigration.apply(
            LoreTaskComponentEdgeMigration.plan(g.legacyRows(), g.taggedRows()), g);
        assertEquals(1, res.failed());
        assertEquals(0, res.created());
        assertEquals(0, res.deleted());
        assertTrue(g.legacy.containsKey("#10:1"));
    }
}
