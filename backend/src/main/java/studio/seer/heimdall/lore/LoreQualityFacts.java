package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Единственное место, где факты для линтера полноты достаются из графа.
 *
 * <p>Раньше каждая проекция жила в двух-трёх экземплярах: свой приватный метод в
 * каждом write-ресурсе плюс копия в батч-API. Судья ({@link WorkQuality}) при
 * этом один, поэтому разойтись могли не оценки, а ФАКТЫ — и расходились: за один
 * день трижды. Статус решения читался из {@code status}, хотя живёт в
 * {@code status_raw}; у спеки проверялось поле, которого в модели нет вовсе; у
 * релиза поиск шёл по {@code release_id}, неуникальному между репозиториями, и
 * вердикт отчитывался по ЧУЖОМУ релизу. Каждая правка чинила одну копию.
 *
 * <p>Здесь проекция и разбор ответа заданы по одному разу на тип. Write-путь и
 * батч-API зовут одно и то же — расхождение больше не «поймаем на ревью», а
 * невозможно по построению.
 */
@ApplicationScoped
public class LoreQualityFacts {

    private static final Logger LOG = Logger.getLogger(LoreQualityFacts.class);

    @Inject
    LoreIngestService ingestService;

    /** Вердикт для ОДНОГО объекта — путь записи. null, если объекта нет или проба не удалась. */
    public WorkQuality.Result forOne(Kind kind, String id) {
        if (id == null || id.isBlank()) return null;
        try {
            Map<String, WorkQuality.Result> m = forBatch(kind, List.of(id));
            return m.get(id);
        } catch (RuntimeException e) {
            // Вердикт вспомогательный: его отказ не имеет права превратить
            // успешную запись в ошибку.
            LOG.warnf("[LORE QUALITY] %s %s: вердикт не собран (%s)", kind.name, id, LoreUpstream.detail(e));
            return null;
        }
    }

    /** Вердикты пачкой: ОДИН запрос к графу, а не N обходов. */
    public Map<String, WorkQuality.Result> forBatch(Kind kind, List<String> ids) {
        Map<String, WorkQuality.Result> out = new LinkedHashMap<>();
        if (ids == null || ids.isEmpty()) return out;
        List<Map<String, Object>> rows = ingestService.queryPublic(kind.selectFor(ids), Map.of());
        for (Map<String, Object> r : rows) {
            Object idv = r.get("_id");
            if (idv == null) continue;
            out.put(String.valueOf(idv), kind.judge(r));
        }
        return out;
    }

    /** Типы, у которых есть вердикт полноты. UC не входит — у него свой линтер UcQuality. */
    public enum Kind {
        TASK("task", "KnowTask", "task_uid",
            "work_class, "
            + "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0]   AS status_raw, "
            + "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, "
            + "out('TAGGED_WITH').component_id                          AS own_components, "
            + "out('PART_OF').out('BELONGS_TO').component_id            AS sprint_components, "
            + "out('PART_OF').out('BELONGS_TO_PROJECT').slug            AS projects, "
            + "out('REALIZES').uc_id                                    AS realizes_uc, "
            + "out('JUSTIFIED_BY').adr_id                               AS justified_by"),
        SPRINT("sprint", "KnowSprint", "sprint_id",
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, "
            + "out('HAS_STATE')[planned_start_date IS NOT NULL].planned_start_date[0] AS planned_start_date, "
            + "out('HAS_STATE')[planned_end_date IS NOT NULL].planned_end_date[0]     AS planned_end_date, "
            + "out('BELONGS_TO_PROJECT').slug        AS projects, "
            + "out('BELONGS_TO').component_id        AS components, "
            + "out('TARGETS_MILESTONE').milestone_id AS milestones"),
        ADR("adr", "KnowADR", "adr_id",
            "status, "
            + "out('BELONGS_TO').component_id AS components, "
            + "out('BELONGS_TO_PROJECT').slug AS projects, "
            + "in('DECIDED_IN').size()        AS decision_count, "
            // in, а НЕ out: SUPERSEDES идёт FROM нового ADR TO старого, поэтому у
            // заменённого ребро входящее. Оно же отвечает на вопрос «кем заменён».
            + "in('SUPERSEDES').adr_id        AS superseded_by, "
            + "out('HAS_STATE')[valid_to IS NULL].context_md[0]      AS context_md, "
            + "out('HAS_STATE')[valid_to IS NULL].decision_md[0]     AS decision_md, "
            + "out('HAS_STATE')[valid_to IS NULL].consequences_md[0] AS consequences_md"),
        DECISION("decision", "KnowDecision", "decision_id",
            // status_raw, а не status — см. D-2026-LORE-QUALITY-NO-PHANTOM-CHECKS
            "status_raw AS status, body_md, "
            + "out('DECIDED_IN').size()       AS adr_count, "
            + "out('BELONGS_TO').component_id AS components, "
            + "out('TAGGED_WITH').tag_id      AS tags"),
        SPEC("spec", "KnowSpec", "spec_id",
            "title, "
            + "COALESCE(out('HAS_STATE')[valid_to IS NULL].content_md[0], content_md) AS content_md, "
            + "COALESCE(out('HAS_STATE')[valid_to IS NULL].version[0], version)       AS version, "
            + "out('DOCUMENTED_IN').component_id AS components, "
            + "out('BELONGS_TO_PROJECT').slug    AS projects"),
        // Релиз адресуется release_uid ("{git_project}#{release_id}"): номер
        // версии повторяется между репозиториями (13 пересечений на 2026-08-23),
        // и по голому release_id вердикт прочитал бы чужой релиз.
        RELEASE("release", "KnowRelease", "release_uid",
            "git_tag, description_md, "
            + "in('IMPLEMENTED_IN_RELEASE').sprint_id AS sprints, "
            + "in('SHIPPED_IN').pr_number             AS prs, "
            + "out('BELONGS_TO_PROJECT').slug         AS projects"),
        COMPONENT("component", "LoreComponent", "component_id",
            "full_name, area, owner, game_icon"),
        MILESTONE("milestone", "KnowMilestone", "milestone_id",
            "label, date_display, in('TARGETS_MILESTONE').sprint_id AS sprints"),
        QUESTION("question", "KnowQuestion", "question_id",
            "title, status, owner, due_date, out('RAISED_IN').adr_id AS links");

        public final String name;
        private final String vertex;
        private final String idField;
        private final String projection;

        Kind(String name, String vertex, String idField, String projection) {
            this.name = name; this.vertex = vertex; this.idField = idField; this.projection = projection;
        }

        public static Kind of(String s) {
            for (Kind k : values()) if (k.name.equalsIgnoreCase(s)) return k;
            return null;
        }

        public static String names() {
            List<String> n = new ArrayList<>();
            for (Kind k : values()) n.add(k.name);
            return String.join(" | ", n);
        }

        /**
         * Один запрос на всю пачку. Значения id уже проверены SAFE_ID (буквы,
         * цифры, {@code _./-}) — кавычек и пробелов в них быть не может, поэтому
         * список безопасно собрать литералом: именованный параметр-коллекция в
         * IN у ArcadeDB работает не во всех редакциях, а рвать пачку на N
         * запросов ради этого — терять весь смысл батча.
         */
        String selectFor(List<String> ids) {
            StringBuilder in = new StringBuilder();
            for (String id : ids) {
                if (in.length() > 0) in.append(", ");
                in.append('\'').append(id).append('\'');
            }
            return "SELECT " + idField + " AS _id, " + projection
                + " FROM " + vertex + " WHERE " + idField + " IN [" + in + "]";
        }

        WorkQuality.Result judge(Map<String, Object> r) {
            switch (this) {
                case TASK: {
                    Object comps = r.get("own_components");
                    if (!(comps instanceof java.util.Collection<?> c) || c.isEmpty()) comps = r.get("sprint_components");
                    Object eff = r.get("effort_days");
                    Double effort = eff instanceof Number n ? n.doubleValue() : null;
                    return WorkQuality.evaluateTask(s(r, "status_raw"), effort, s(r, "work_class"),
                        comps, r.get("projects"), r.get("realizes_uc"), r.get("justified_by"));
                }
                case SPRINT:
                    return WorkQuality.evaluateSprint(s(r, "status_raw"), r.get("projects"), r.get("components"),
                        s(r, "planned_start_date"), s(r, "planned_end_date"), r.get("milestones"));
                case ADR: {
                    boolean hasDecisions = r.get("decision_count") instanceof Number n && n.intValue() > 0;
                    Object sb = r.get("superseded_by");
                    boolean hasSupersedes = sb instanceof java.util.Collection<?> c2
                        ? c2.stream().anyMatch(o -> o != null && !String.valueOf(o).isBlank())
                        : sb != null && !String.valueOf(sb).isBlank();
                    return WorkQuality.evaluateAdr(s(r, "status"), r.get("components"), r.get("projects"),
                        hasDecisions, s(r, "context_md"), s(r, "decision_md"), s(r, "consequences_md"), hasSupersedes);
                }
                case DECISION: {
                    boolean hasAdr = r.get("adr_count") instanceof Number n && n.intValue() > 0;
                    return WorkQuality.evaluateDecision(s(r, "status"), s(r, "body_md"), hasAdr,
                        r.get("components"), r.get("tags"));
                }
                case SPEC:
                    return WorkQuality.evaluateSpec(s(r, "title"), s(r, "content_md"),
                        r.get("components"), r.get("projects"), s(r, "version"));
                case RELEASE:
                    return WorkQuality.evaluateRelease(s(r, "git_tag"), s(r, "description_md"),
                        r.get("sprints"), r.get("prs"), r.get("projects"));
                case COMPONENT:
                    return WorkQuality.evaluateComponent(s(r, "full_name"), s(r, "area"),
                        s(r, "owner"), s(r, "game_icon"));
                case MILESTONE:
                    return WorkQuality.evaluateMilestone(s(r, "label"), s(r, "date_display"), r.get("sprints"));
                case QUESTION:
                    return WorkQuality.evaluateQuestion(s(r, "title"), s(r, "status"), s(r, "owner"),
                        s(r, "due_date"), r.get("links"));
                default:
                    return null;
            }
        }

        private static String s(Map<String, Object> r, String key) {
            Object v = r.get(key);
            if (v instanceof List<?> l) v = l.isEmpty() ? null : l.get(0);
            return v == null ? null : String.valueOf(v);
        }
    }
}
