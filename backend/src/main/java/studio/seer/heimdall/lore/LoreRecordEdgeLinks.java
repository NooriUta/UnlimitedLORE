package studio.seer.heimdall.lore;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-04 · SPRINT_UXR_POLISH_UAT_1113/PU-02 — вкладка связи, у которой
 * нет своего среза, читается прямо по ребру из модели: вершина и деловой ключ типа
 * ({@link LoreModelTypes#GRAPH}), ребро и направление ({@link LoreRecordRegistry.Relation}).
 *
 * <p>До этого пять видов связей (упоминания REFERENCES в обе стороны, публикации, инсайты,
 * рекомендации QG, ранбуки ADR) были объявлены вкладками, но читать их было нечем — паспорт
 * любой записи навсегда показывал «Часть сведений не загрузилась». Правило теперь общее:
 * вкладка связи читается всегда — из строки среза, отдельным срезом или по ребру
 * (сторож — ModelServerConsistencyGuardTest).
 *
 * <p>Концы ребра разнородны (REFERENCES ведёт к любой записи каталога), поэтому ключ, название
 * и статус берутся первым непустым из известных полей, а вид конца — из класса вершины.
 * Всё в SQL — из статических описаний реестра, значение id уходит связанным параметром.
 * Чистые функции, без БД.
 */
final class LoreRecordEdgeLinks {

    private LoreRecordEdgeLinks() {}

    /** Сколько концов ребра читается в паспорт: вкладка, а не выгрузка. */
    static final int LIMIT = 200;

    /** Деловые ключи концов — первый непустой. */
    static final List<String> ID_FIELDS = List.of("task_uid", "adr_id", "spec_id", "sprint_id", "decision_id",
        "question_id", "milestone_id", "release_uid", "component_id", "uc_id", "runbook_id", "doc_id",
        "publication_id", "insight_id", "rec_id", "pain_id", "gain_id", "job_id", "actor_id", "machine_id", "kc_sub", "slug");

    static final List<String> TITLE_FIELDS = List.of("title", "name", "label", "full_name", "display_name", "statement_md");

    /** Вид конца по классу вершины — тот же словарь видов, что у паспорта. */
    static final Map<String, String> KIND_OF_VERTEX = Map.ofEntries(
        Map.entry("KnowTask", "task"), Map.entry("KnowSprint", "sprint"), Map.entry("KnowADR", "adr"),
        Map.entry("KnowSpec", "spec"), Map.entry("KnowDecision", "decision"), Map.entry("KnowQuestion", "question"),
        Map.entry("KnowMilestone", "milestone"), Map.entry("KnowRelease", "release"),
        Map.entry("LoreComponent", "component"), Map.entry("KnowUseCase", "feature"),
        Map.entry("KnowRunbook", "runbook"), Map.entry("KnowDoc", "doc"), Map.entry("KnowGitProject", "project"),
        Map.entry("BragiPublication", "publication"), Map.entry("BragiInsight", "insight"),
        Map.entry("QGRecommendation", "qg_recommendation"), Map.entry("KnowPain", "pain"),
        Map.entry("KnowGain", "gain"), Map.entry("KnowJob", "job"), Map.entry("KnowProjectActor", "actor"),
        // S9-05 A: концы вкладок человека и агента.
        Map.entry("KnowUser", "user"), Map.entry("KnowActor", "agent"), Map.entry("KnowMachine", "machine"));

    /** Имя источника в meta.data_state: видно, что вкладка прочитана по ребру, а не срезом. */
    static String source(LoreRecordRegistry.Relation r) {
        return "edge:" + r.rel() + ":" + r.dir();
    }

    /** Запрос концов ребра записи; {@code :id} — деловой ключ записи. */
    static String sql(String type, LoreRecordRegistry.Relation r) {
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
        if (g == null) throw new IllegalArgumentException("тип " + type + " без вершины в модели");
        String dir = switch (r.dir()) {
            case "out" -> "out";
            case "in" -> "in";
            default -> throw new IllegalArgumentException("направление " + r.dir() + " у связи " + type + "." + r.key());
        };
        if (!r.rel().matches("[A-Z_]+")) throw new IllegalArgumentException("ребро " + r.rel());
        return "SELECT @type AS end_vertex, coalesce(" + String.join(", ", ID_FIELDS) + ") AS end_id, "
            + "coalesce(" + String.join(", ", TITLE_FIELDS) + ") AS end_title, "
            + "coalesce(status, status_raw, status_general) AS end_status, "
            + "unionall(out('BELONGS_TO_PROJECT').slug, out('PART_OF').out('BELONGS_TO_PROJECT').slug) AS end_projects "
            + "FROM (SELECT expand(" + dir + "('" + r.rel() + "')) FROM " + g.vertex() + " WHERE " + g.key() + " = :id) "
            + "LIMIT " + (LIMIT + 1);
    }

    /** Строки → связи {@code links[]}; под проектным скоупом — только концы из разрешённых проектов. */
    static List<Map<String, Object>> links(LoreRecordRegistry.Relation r, List<Map<String, Object>> rows,
                                           Set<String> scope) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if (scope != null && !inScope(row.get("end_projects"), scope)) continue;
            String id = LoreRecordValues.str(row.get("end_id"));
            if (id == null) continue;
            String vertex = LoreRecordValues.str(row.get("end_vertex"));
            String kind = kindOf(vertex, id);
            String status = LoreRecordValues.docToken(row.get("end_status"));
            Map<String, Object> l = LoreRecordValues.link(r.rel(), r.dir(), id, kind,
                LoreRecordValues.str(row.get("end_title")), status);
            out.add(l);
            if (out.size() >= LIMIT) break;
        }
        return out;
    }

    /** Спека SPEC-TECH-* — паспорт технологии (как в остальном паспорте). */
    static String kindOf(String vertex, String id) {
        String k = vertex == null ? null : KIND_OF_VERTEX.get(vertex);
        if ("spec".equals(k) && id.startsWith(LoreRecordValues.TECH_SPEC_PREFIX)) return "tech";
        return k != null ? k : (vertex == null ? "any" : vertex);
    }

    private static boolean inScope(Object projects, Set<String> scope) {
        for (String p : LoreRecordValues.arr(projects)) if (scope.contains(p)) return true;
        return false;
    }
}
