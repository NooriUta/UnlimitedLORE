package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Проверка полноты БЕЗ записи, пачкой (QUAL-7, ADR-LORE-039).
 *
 * <p>Линтер {@link WorkQuality} — чистая функция, и ему безразлично, зовут его
 * из write-пути или отдельно. Этот эндпоинт даёт второй способ вызова: спросить
 * вердикт по уже существующим объектам, ничего не меняя. Прецедент в корпусе —
 * {@code uc_quality} (re-lint UC без записи).
 *
 * <p><b>Только по списку id, режима «весь слой» нет</b> (решение владельца
 * 2026-08-23: «сессии не будут проверять всё, иначе просто протянет — будут
 * запрашивать кусками»). Пустой список и превышение потолка — 400 с явным
 * текстом, а не тихое усечение: молча укоротить пачку значит отдать неполный
 * ответ под видом полного.
 *
 * <p>Один запрос к графу на всю пачку ({@code WHERE … IN [...]}), а не N
 * обходов: сотня объектов иначе стала бы сотней round-trip'ов.
 */
@Path("/lore")
public class LoreQualityResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreQualityResource.class);

    /** Потолок пачки. «Кусок» не должен превращаться во весь слой обходным путём. */
    static final int MAX_BATCH = 200;

    public record QualityRequest(String type, List<String> ids) {}

    @POST
    @Path("quality")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response checkQuality(QualityRequest req) {
        if (!enabled) return disabled();
        if (req == null || req.type() == null || req.type().isBlank())
            return badParams("type required: " + Kind.names());
        Kind kind = Kind.of(req.type());
        if (kind == null) return badParams("unknown type \"" + req.type() + "\"; expected one of " + Kind.names());
        if (req.ids() == null || req.ids().isEmpty())
            return badParams("ids required — режима «весь слой» нет намеренно, спрашивайте кусками");
        if (req.ids().size() > MAX_BATCH)
            return badParams("batch too large: " + req.ids().size() + " > " + MAX_BATCH
                + " — разбейте на куски (усечение молча не делаем: неполный ответ под видом полного хуже отказа)");

        List<String> ids = new ArrayList<>();
        for (String id : req.ids()) {
            if (id == null || id.isBlank()) continue;
            if (!SAFE_ID.matcher(id).matches())
                return badParams("id contains illegal characters: " + id);
            if (!ids.contains(id)) ids.add(id);   // дубликаты в запросе не должны двоить ответ
        }
        if (ids.isEmpty()) return badParams("ids required — все переданные значения пусты");

        try {
            List<Map<String, Object>> rows = ingestService.queryPublic(
                kind.selectFor(ids), Map.of());

            // Найденное судим, ненайденное называем отдельно: «нет вердикта» и
            // «объекта нет» — разные ответы, и молчать про второе нельзя.
            Map<String, WorkQuality.Result> byId = new LinkedHashMap<>();
            for (Map<String, Object> r : rows) {
                String id = str(r.get("_id"));
                if (id == null) continue;
                byId.put(id, kind.judge(r));
            }

            List<Map<String, Object>> failed = new ArrayList<>();
            List<String> missing = new ArrayList<>();
            int passed = 0;
            for (String id : ids) {
                WorkQuality.Result q = byId.get(id);
                if (q == null) { missing.add(id); continue; }
                List<Map<String, Object>> bad = new ArrayList<>();
                for (WorkQuality.Finding f : q.findings()) {
                    if (f.required() && !f.ok())
                        bad.add(Map.of("code", f.code(), "message", f.message()));
                }
                if (bad.isEmpty()) { passed++; continue; }
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", id);
                item.put("score", q.score());
                item.put("max", q.max());
                item.put("findings", bad);
                failed.add(item);
            }
            // Худшие сверху: список, где проблемное перемешано со «слегка
            // неполным», читают до первого экрана и бросают.
            failed.sort(Comparator.comparingDouble(m -> {
                int mx = (int) m.get("max");
                return mx == 0 ? 1.0 : ((int) m.get("score")) / (double) mx;
            }));

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("kind", kind.name);
            out.put("checked", ids.size() - missing.size());
            out.put("passed", passed);
            out.put("failed", failed);
            if (!missing.isEmpty()) out.put("missing", missing);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE QUALITY BATCH] %s ×%d: %s", kind.name, ids.size(), LoreUpstream.detail(e));
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── Типы: проекция фактов + судья ────────────────────────────────────────
    //
    // Проекции повторяют те, что собирают вердикт на записи, и это осознанный
    // временный дубль: свести их в один источник — отдельный шаг (иначе правка
    // API тронула бы все write-пути разом). Расхождение ловится тем, что судья
    // здесь тот же самый WorkQuality — разойтись могут только ФАКТЫ, не оценки.
    private enum Kind {
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

        final String name;
        private final String vertex;
        private final String idField;
        private final String projection;

        Kind(String name, String vertex, String idField, String projection) {
            this.name = name; this.vertex = vertex; this.idField = idField; this.projection = projection;
        }

        static Kind of(String s) {
            for (Kind k : values()) if (k.name.equalsIgnoreCase(s)) return k;
            return null;
        }

        static String names() {
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
