package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Разовая миграция «задача → компонент»: BELONGS_TO KnowTask → LoreComponent → TAGGED_WITH.
 *
 * <h2>Зачем</h2>
 * Промоушен находки QG в задачу ({@code POST /lore/qg/promote}, {@link LoreQgResource})
 * ставил задаче ребро к компоненту BELONGS_TO, а паспорт задачи, срез component_tasks
 * и граф читают TAGGED_WITH — компонент таких задач не виден нигде. PR #1265 перевёл
 * запись на {@link LoreLinkTypes#componentEdgeOf}; старые рёбра на проде переводит
 * эта миграция (слово владелицы 11.11: «пиши скрипт миграции, запускаем отдельным yaml»).
 *
 * <h2>Что считается старым ребром</h2>
 * Любое BELONGS_TO из KnowTask в LoreComponent: по каталогу {@link LoreLinkTypes#PAIRS}
 * у задачи к компоненту только TAGGED_WITH, законного BELONGS_TO этой пары нет.
 * Поле {@code src} задачи в отчёт идёт разбивкой ({@code by_src}) — если сухой прогон
 * покажет задачи не из QG, это видно до применения.
 *
 * <h2>Порядок и идемпотентность</h2>
 * На пару (задача, компонент): нет TAGGED_WITH → создать ({@code IF NOT EXISTS}) и
 * ПРОВЕРИТЬ чтением, что оно есть; только потом удалить старые BELONGS_TO по {@code @rid}
 * ({@code DELETE EDGE} в ArcadeDB нет, см. NoDeleteEdgeSyntaxTest). Сбой создания —
 * старое ребро остаётся: связь не должна пропасть ни на миг. Повторный прогон старых
 * рёбер не находит и ничего не пишет.
 */
final class LoreTaskComponentEdgeMigration {

    static final String MIGRATION_ID = "qg-task-component-edge";
    static final String LEGACY_EDGE = "BELONGS_TO";
    static final String TARGET_EDGE = LoreLinkTypes.componentEdgeOf("KnowTask");
    static final String TASK_CLASS = "KnowTask";
    static final String COMPONENT_CLASS = "LoreComponent";

    /** Старые рёбра. Фильтр по классам концов — в Java ({@link #plan}): проекция @out.@type проверена на ArcadeDB, WHERE по ней — нет. */
    static final String LEGACY_SQL =
        "SELECT @rid AS rid, @out.@type AS oc, @in.@type AS ic, @out.task_uid AS task_uid, "
        + "@out.src AS src, @in.component_id AS component_id FROM " + LEGACY_EDGE;

    /** Уже стоящие рёбра нового вида — чтобы не плодить дубли. */
    static final String TARGET_SQL =
        "SELECT @out.@type AS oc, @in.@type AS ic, @out.task_uid AS task_uid, "
        + "@in.component_id AS component_id FROM " + TARGET_EDGE;

    /** rid уходит в SQL литералом (DELETE FROM … WHERE @rid=…) — только канонический вид. */
    private static final Pattern RID = Pattern.compile("#\\d+:\\d+");

    private LoreTaskComponentEdgeMigration() { }

    /** Операции над графом — в ресурсе через ArcadeDB, в тесте в памяти. */
    interface Ops {
        void createTagged(String taskUid, String componentId);
        boolean taggedExists(String taskUid, String componentId);
        void deleteLegacy(String rid);
    }

    record Item(String taskUid, String componentId, String src, boolean createTagged, List<String> deleteRids) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("task_uid", taskUid);
            m.put("component_id", componentId);
            m.put("src", src);
            m.put("create", createTagged ? TARGET_EDGE : null);
            m.put("delete", deleteRids.stream().map(r -> LEGACY_EDGE + " " + r).toList());
            return m;
        }
    }

    record Plan(List<Item> items, List<Map<String, Object>> skipped) {
        List<String> taskUids() {
            Set<String> s = new TreeSet<>();
            for (Item i : items) s.add(i.taskUid());
            return List.copyOf(s);
        }
        int toCreate()  { return (int) items.stream().filter(Item::createTagged).count(); }
        int toDelete()  { return items.stream().mapToInt(i -> i.deleteRids().size()).sum(); }
        int unchanged() { return (int) items.stream().filter(i -> !i.createTagged()).count(); }
        boolean noop()  { return items.isEmpty(); }

        Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("migration_id", MIGRATION_ID);
            out.put("dry_run", true);
            out.put("edge_from", LEGACY_EDGE);
            out.put("edge_to", TARGET_EDGE);
            out.put("tasks", taskUids().size());
            out.put("pairs", items.size());
            out.put("to_create", toCreate());
            out.put("to_delete", toDelete());
            out.put("unchanged", unchanged());
            out.put("noop", noop());
            Map<String, Integer> bySrc = new TreeMap<>();
            for (Item i : items) bySrc.merge(i.src() == null || i.src().isBlank() ? "(нет)" : i.src(), 1, Integer::sum);
            out.put("by_src", bySrc);
            out.put("task_uids", taskUids());
            out.put("items", items.stream().map(Item::toMap).toList());
            out.put("skipped", skipped);
            return out;
        }
    }

    record Result(int found, int created, int deleted, int unchanged,
                  List<Map<String, Object>> done, List<Map<String, Object>> failedItems,
                  List<Map<String, Object>> skipped) {
        int failed() { return failedItems.size(); }

        Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("migration_id", MIGRATION_ID);
            out.put("dry_run", false);
            out.put("edge_from", LEGACY_EDGE);
            out.put("edge_to", TARGET_EDGE);
            out.put("found", found);
            out.put("created", created);
            out.put("deleted", deleted);
            out.put("unchanged", unchanged);
            out.put("failed", failed());
            out.put("noop", found == 0);
            out.put("items", done);
            out.put("failed_items", failedItems);
            out.put("skipped", skipped);
            return out;
        }
    }

    /** План из сырых строк выборок {@link #LEGACY_SQL} и {@link #TARGET_SQL}. */
    static Plan plan(List<Map<String, Object>> legacyRows, List<Map<String, Object>> targetRows) {
        Set<String> tagged = new java.util.HashSet<>();
        for (Map<String, Object> r : targetRows) {
            if (!TASK_CLASS.equals(str(r.get("oc"))) || !COMPONENT_CLASS.equals(str(r.get("ic")))) continue;
            String t = str(r.get("task_uid")), c = str(r.get("component_id"));
            if (t != null && c != null) tagged.add(t + "|" + c);
        }
        // Ключ (задача, компонент) → rid'ы старых рёбер; TreeMap — порядок не зависит от выдачи БД.
        Map<String, List<String>> rids = new TreeMap<>();
        Map<String, String> srcOf = new LinkedHashMap<>();
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (Map<String, Object> r : legacyRows) {
            if (!TASK_CLASS.equals(str(r.get("oc"))) || !COMPONENT_CLASS.equals(str(r.get("ic")))) continue;
            String rid = str(r.get("rid")), t = str(r.get("task_uid")), c = str(r.get("component_id"));
            String why = rid == null || !RID.matcher(rid).matches() ? "bad_rid"
                : t == null ? "no_task_uid"
                : c == null ? "no_component_id" : null;
            if (why != null) {
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("rid", rid);
                s.put("task_uid", t);
                s.put("component_id", c);
                s.put("reason", why);
                skipped.add(s);
                continue;
            }
            String key = t + "|" + c;
            rids.computeIfAbsent(key, k -> new ArrayList<>()).add(rid);
            srcOf.putIfAbsent(key, str(r.get("src")));
        }
        List<Item> items = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : rids.entrySet()) {
            String[] tc = e.getKey().split("\\|", 2);
            List<String> sorted = new ArrayList<>(e.getValue());
            sorted.sort(null);
            items.add(new Item(tc[0], tc[1], srcOf.get(e.getKey()), !tagged.contains(e.getKey()), List.copyOf(sorted)));
        }
        return new Plan(List.copyOf(items), List.copyOf(skipped));
    }

    /** Применение плана. Сбой пары не останавливает остальные — он попадает в failed_items. */
    static Result apply(Plan plan, Ops ops) {
        int created = 0, deleted = 0, unchanged = 0;
        List<Map<String, Object>> done = new ArrayList<>();
        List<Map<String, Object>> failed = new ArrayList<>();
        for (Item it : plan.items()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("task_uid", it.taskUid());
            row.put("component_id", it.componentId());
            int del = 0;
            boolean made = false;
            try {
                if (it.createTagged()) {
                    ops.createTagged(it.taskUid(), it.componentId());
                    if (!ops.taggedExists(it.taskUid(), it.componentId()))
                        throw new IllegalStateException(TARGET_EDGE + " после создания не читается — старое ребро не тронуто");
                    made = true;
                } else if (!ops.taggedExists(it.taskUid(), it.componentId())) {
                    // План устарел: новое ребро пропало между сухим прогоном и применением.
                    ops.createTagged(it.taskUid(), it.componentId());
                    if (!ops.taggedExists(it.taskUid(), it.componentId()))
                        throw new IllegalStateException(TARGET_EDGE + " не читается — старое ребро не тронуто");
                    made = true;
                }
                if (made) created++; else unchanged++;
                for (String rid : it.deleteRids()) {
                    ops.deleteLegacy(rid);
                    del++;
                    deleted++;
                }
                row.put("created", made);
                row.put("deleted", del);
                done.add(row);
            } catch (RuntimeException e) {
                if (made) created++;
                row.put("created", made);
                row.put("deleted", del);
                row.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                failed.add(row);
            }
        }
        return new Result(plan.items().size(), created, deleted, unchanged, done, failed, plan.skipped());
    }

    private static String str(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() || "null".equals(s) ? null : s;
    }
}
