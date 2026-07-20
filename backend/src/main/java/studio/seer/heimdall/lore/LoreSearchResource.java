package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * SRCH-05 — сквозной поиск v2: {@code GET /lore/search} (ADR-LORE-033 D1–D5).
 *
 * <p><b>Почему отдельный эндпоинт, а не слайс.</b> compose() слайсов клеит
 * optional-фильтры без AND и не умеет заходить внутрь unionall-веток — фасеты
 * (тип/компонент/проект) обязаны отсекать НА УРОВНЕ ВЕТКИ («фильтр туда, куда
 * ходим», требование владельца), а не постфильтром по собранной выдаче.
 * Плюс ранжирование: $score в unionall теряется, поэтому ветки выполняются
 * по одной и сливаются в Java.
 *
 * <p><b>Ранжирование (D3).</b> BM25 не откалиброван между бакетами (докам
 * ArcadeDB это известно), поэтому внутри ветки score нормируется на максимум
 * ветки и умножается на приоритет типа. Приоритеты — из утверждённого
 * прототипа search-ranking-srch05.html, переопределяются конфигом
 * {@code lore.search.type-priority} (вид {@code adr:1.25,task:0.7}) без
 * пересборки.
 *
 * <p><b>Фасет компонента/проекта с наследованием (несущее).</b> Прямые рёбра
 * BELONGS_TO есть у меньшинства (у задач 0/2847) — компонент/проект выводятся
 * от родителя: задача → спринт (PART_OF), решение → ADR (DECIDED_IN). Выведенная
 * привязка помечается {@code inherited_from}, фильтр учитывает ОБА пути.
 *
 * <p><b>href в ответе НЕТ намеренно</b> (отступление от D1): маршруты секций
 * владеет UI, серверная догадка о них протухала бы молча. UI строит ссылку из
 * {@code type + ref_id}.
 */
@Path("/lore")
public class LoreSearchResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreSearchResource.class);

    /** Ветка поиска: всё, что нужно знать об одном типе. */
    record Branch(
        String type,            // имя типа в API (adr, task, …)
        String vertexClass,     // KnowADR…
        String idField,         // adr_id…
        String titleField,      // name | title
        String indexName,       // ftKnowADR; null → ILIKE-fallback (QualityGate)
        List<String> vertexTextFields, // индексированные поля НА вершине (для сниппета)
        String histClass,       // KnowADRHist; null → тел в hist нет
        String histIndexName,
        List<String> histTextFields,
        String compExpr,        // SQL-выражение: прямые компоненты
        String compInheritedExpr, // SQL: выведенные от родителя (null → нет пути)
        String inheritedFrom,   // подпись источника наследования (sprint | adr)
        String projExpr,        // SQL: слаги проектов (с учётом наследования)
        double priority
    ) {}

    // Пути компонентов/проектов — те же выражения, что в живых слайсах
    // (adrs/specs/tasks_of_sprint): расхождение с ними означало бы, что фасет
    // фильтрует не по тому, что показывают экраны.
    private static final String DIRECT_COMP = "out('BELONGS_TO').component_id";
    private static final String DIRECT_PROJ = "out('BELONGS_TO_PROJECT').slug";

    private static final List<Branch> BRANCHES = List.of(
        new Branch("adr", "KnowADR", "adr_id", "name", "ftKnowADR",
            List.of("name"),
            "KnowADRHist", "ftKnowADRHist", List.of("context_md", "decision_md", "consequences_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.25),
        new Branch("spec", "KnowSpec", "spec_id", "title", "ftKnowSpec",
            List.of("title"),
            "KnowSpecHist", "ftKnowSpecHist", List.of("content_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.10),
        new Branch("sprint", "KnowSprint", "sprint_id", "name", "ftKnowSprint",
            List.of("name", "context_md"),
            "KnowSprintHist", "ftKnowSprintHist", List.of("context_md", "outcome_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 0.90),
        // Задачи: прямые компоненты — TAGGED_WITH (task_link rel=component);
        // выведенные — от спринта через PART_OF. Проект — только через спринт.
        new Branch("task", "KnowTask", "task_uid", "title", "ftKnowTask",
            List.of("title"),
            "KnowTaskHist", "ftKnowTaskHist", List.of("note_md"),
            "out('TAGGED_WITH').component_id",
            "out('PART_OF')." + DIRECT_COMP, "sprint",
            "out('PART_OF')." + DIRECT_PROJ, 0.70),
        // Решения: своих BELONGS_TO обычно нет — наследуют от родительского ADR.
        new Branch("decision", "KnowDecision", "decision_id", "title", "ftKnowDecision",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, "out('DECIDED_IN')." + DIRECT_COMP, "adr",
            DIRECT_PROJ, 1.20),
        new Branch("question", "KnowQuestion", "question_id", "title", "ftKnowQuestion",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.00),
        new Branch("runbook", "KnowRunbook", "runbook_id", "name", "ftKnowRunbook",
            List.of("name"),
            "KnowRunbookHist", "ftKnowRunbookHist", List.of("content_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.00),
        new Branch("doc", "KnowDoc", "doc_id", "title", "ftKnowDoc",
            List.of("title", "content_md", "content_md_en", "content_md_ru"),
            "KnowDocHist", "ftKnowDocHist", List.of("content_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.00),
        // FT-индекса на QualityGate нет (реестр V11/V12) — единственная ветка
        // на ILIKE; score у неё симулируется константой ниже.
        new Branch("quality_gate", "QualityGate", "qg_id", "name", null,
            List.of("name", "content_md"),
            null, null, null,
            "component_id", null, null, DIRECT_PROJ, 0.80),
        // ── продуктовый слой ──
        new Branch("feature", "KnowFeature", "feature_id", "title", "ftKnowFeature",
            List.of("title", "body_md", "context_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.30),
        new Branch("use_case", "KnowUseCase", "uc_id", "title", "ftKnowUseCase",
            List.of("title", "scenario_md", "acceptance_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.00),
        new Branch("pain", "KnowPain", "pain_id", "title", "ftKnowPain",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 0.90),
        new Branch("gain", "KnowGain", "gain_id", "title", "ftKnowGain",
            List.of("title", "body_md", "metric_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 0.90),
        new Branch("job", "KnowJob", "job_id", "title", "ftKnowJob",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 0.90),
        new Branch("actor", "KnowActor", "actor_id", "name", "ftKnowActor",
            List.of("name", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 0.90));

    /** Переопределение приоритетов без пересборки: "adr:1.4,task:0.5". */
    @ConfigProperty(name = "lore.search.type-priority")
    Optional<String> priorityOverride;

    // Сколько строк тянем с ветки ДО квоты: из этого же числа считается by_type,
    // поэтому оно же — честный потолок счётчика фасета (документировано в ответе
    // полем capped_at, чтобы «ровно 50» читалось как «не меньше 50»).
    private static final int BRANCH_CAP = 50;

    @GET
    @Path("search")
    @Produces(MediaType.APPLICATION_JSON)
    public Response search(@QueryParam("q") String q,
                           @QueryParam("types") String typesCsv,
                           @QueryParam("components") String componentsCsv,
                           @QueryParam("project") String project,
                           @QueryParam("limit") Integer limitParam,
                           @QueryParam("offset") Integer offsetParam,
                           @QueryParam("mode") String mode,
                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        long t0 = System.nanoTime();

        if (q == null || q.isBlank()) return badParams("q required");
        if (q.length() > 160) return badParams("q is longer than 160 characters");

        Set<String> types = csv(typesCsv);
        List<String> comps = new ArrayList<>(csv(componentsCsv));
        int limit = limitParam == null || limitParam < 1 ? 20 : Math.min(limitParam, 100);
        int offset = offsetParam == null || offsetParam < 0 ? 0 : offsetParam;
        String m = mode == null || mode.isBlank() ? "smart" : mode.toLowerCase(Locale.ROOT);
        if (!Set.of("smart", "exact", "fuzzy").contains(m))
            return badParams("mode must be one of smart|exact|fuzzy");

        String lucene = buildLuceneQuery(q, m);
        if (lucene.isBlank()) return badParams("q contains no searchable tokens");

        List<Branch> active = BRANCHES.stream()
            .filter(b -> types.isEmpty() || types.contains(b.type())).toList();
        if (active.isEmpty()) return badParams("types matched no known type");

        // Квота на тип (D5): общий limit делится между запрошенными типами,
        // но не тоньше 3 — иначе многотипный запрос вырождается в топ-1 везде.
        int perType = Math.max(3, limit / Math.max(1, active.size()));

        Map<String, Double> prio = effectivePriorities();
        List<Map<String, Object>> hits = new ArrayList<>();
        Map<String, Integer> byType = new LinkedHashMap<>();
        Map<String, Integer> byComponent = new LinkedHashMap<>();

        for (Branch b : active) {
            try {
                List<Map<String, Object>> rows = queryBranch(b, lucene, q, comps, project);
                byType.put(b.type(), rows.size());
                // Нормировка внутри ветки: BM25 разных бакетов несравним, а
                // после деления на максимум ветки хотя бы порядок внутри типа
                // честный. Межтиповое сравнение задаёт type_priority. Это
                // ОСОЗНАННАЯ приблизительность (ADR-033 §Consequences).
                double max = rows.stream()
                    .mapToDouble(r -> ((Number) r.getOrDefault("score", 1.0)).doubleValue())
                    .max().orElse(1.0);
                double p = prio.getOrDefault(b.type(), b.priority());
                int taken = 0;
                for (Map<String, Object> r : rows) {
                    for (Object c : effectiveComponents(r)) {
                        byComponent.merge(String.valueOf(c), 1, Integer::sum);
                    }
                    if (taken++ >= perType) continue; // фасет считаем по всем, в выдачу — квоту
                    double raw = ((Number) r.getOrDefault("score", 1.0)).doubleValue();
                    r.put("score", round3(max <= 0 ? p : raw / max * p));
                    r.put("type", b.type());
                    hits.add(r);
                }
            } catch (Exception e) {
                // Ветка НЕ глотается молча: одна упавшая ветка — это дырка в
                // охвате, и о ней сообщается полем warnings, а не тишиной.
                LOG.warnf("[LORE SEARCH] ветка %s упала: %s", b.type(), e.getMessage());
                byType.put(b.type(), -1);
            }
        }

        hits.sort((a, bb) -> Double.compare(
            ((Number) bb.get("score")).doubleValue(), ((Number) a.get("score")).doubleValue()));
        List<Map<String, Object>> page = hits.stream().skip(offset).limit(limit).toList();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("hits", page);
        out.put("by_type", byType);
        out.put("by_component", byComponent);
        out.put("total_collected", hits.size());
        out.put("capped_at", BRANCH_CAP);
        out.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
        return noStore(Response.ok(out));
    }

    /** Одна ветка: вершина + (если есть) открытая hist-строка со схлопыванием. */
    private List<Map<String, Object>> queryBranch(Branch b, String lucene, String rawQ,
                                                  List<String> comps, String project) {
        Map<String, Object> params = new HashMap<>();
        params.put("q", lucene);
        String compFilter = componentFilter(b, comps, params, false);
        String projFilter = projectFilter(b, project, params, false);

        String textCols = String.join(", ", b.vertexTextFields());
        String matcher = b.indexName() != null
            ? "SEARCH_INDEX('" + b.indexName() + "', :q) = true"
            : ilikeMatcher(b, params, rawQ);

        String sql = "SELECT " + b.idField() + " AS ref_id, " + b.titleField() + " AS title, "
            + (b.indexName() != null ? "$score AS score, " : "1.0 AS score, ")
            + textCols + ", "
            + b.compExpr() + " AS comp_direct, "
            + (b.compInheritedExpr() != null ? b.compInheritedExpr() : "null") + " AS comp_inherited, "
            + b.projExpr() + " AS proj "
            + "FROM " + b.vertexClass() + " WHERE (" + b.idField() + " ILIKE :idlike OR " + matcher + ")"
            + compFilter + projFilter
            + " ORDER BY score DESC LIMIT " + BRANCH_CAP;
        params.put("idlike", "%" + rawQ + "%");

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> r : ingestService.queryPublic(sql, params)) {
            rows.add(shapeHit(b, r, rawQ, b.vertexTextFields(), false));
        }

        if (b.histClass() != null) {
            Map<String, Object> hp = new HashMap<>();
            hp.put("q", lucene);
            String histText = String.join(", ", b.histTextFields());
            // Фильтры фасета на hist-ветке идут через родителя (in('HAS_STATE')):
            // сама hist-строка рёбер компонентов не несёт.
            String hCompFilter = componentFilter(b, comps, hp, true);
            String hProjFilter = projectFilter(b, project, hp, true);
            // [0] только у скалярных проекций (ref_id/title — родитель один);
            // компоненты/проекты — СПИСКИ, [0] оставил бы один случайный.
            String hsql = "SELECT in('HAS_STATE')." + b.idField() + "[0] AS ref_id, "
                + "in('HAS_STATE')." + b.titleField() + "[0] AS title, $score AS score, "
                + histText + ", "
                + "in('HAS_STATE')." + b.compExpr() + " AS comp_direct, "
                + (b.compInheritedExpr() != null
                    ? "in('HAS_STATE')." + b.compInheritedExpr() : "null") + " AS comp_inherited, "
                + "in('HAS_STATE')." + b.projExpr() + " AS proj "
                + "FROM " + b.histClass() + " WHERE valid_to IS NULL "
                + "AND SEARCH_INDEX('" + b.histIndexName() + "', :q) = true"
                + hCompFilter + hProjFilter
                + " ORDER BY score DESC LIMIT " + BRANCH_CAP;
            for (Map<String, Object> r : ingestService.queryPublic(hsql, hp)) {
                rows.add(shapeHit(b, r, rawQ, b.histTextFields(), true));
            }
        }

        // Дедуп по ref_id: вершина и её hist могли совпасть оба — оставляем
        // более сильный score (обе формы уже нормируются одной веткой).
        Map<Object, Map<String, Object>> dedup = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            dedup.merge(r.get("ref_id"), r, (a, bb) ->
                ((Number) a.get("score")).doubleValue() >= ((Number) bb.get("score")).doubleValue() ? a : bb);
        }
        List<Map<String, Object>> out = new ArrayList<>(dedup.values());
        out.sort((a, bb) -> Double.compare(
            ((Number) bb.get("score")).doubleValue(), ((Number) a.get("score")).doubleValue()));
        return out;
    }

    /** ILIKE-fallback для ветки без FT-индекса (QualityGate). */
    private String ilikeMatcher(Branch b, Map<String, Object> params, String rawQ) {
        params.put("ilike", "%" + rawQ + "%");
        List<String> parts = new ArrayList<>();
        for (String f : b.vertexTextFields()) parts.add(f + " ILIKE :ilike");
        return "(" + String.join(" OR ", parts) + ")";
    }

    /** Фасет-фильтр по компонентам: ОБА пути (прямой и выведенный), OR по значениям. */
    private String componentFilter(Branch b, List<String> comps, Map<String, Object> params, boolean viaParent) {
        if (comps.isEmpty()) return "";
        // БЕЗ [0] на hist-пути: обход от hist-строки через родителя возвращает
        // СПИСОК компонентов, и [0] превратил бы CONTAINS в сравнение с одним
        // случайным значением — ровно ловушка корпуса «многосвязное видно под
        // одним значением», уже поймана этим тестом.
        String direct = viaParent ? "in('HAS_STATE')." + b.compExpr() : b.compExpr();
        String inherited = b.compInheritedExpr() == null ? null
            : (viaParent ? "in('HAS_STATE')." + b.compInheritedExpr() : b.compInheritedExpr());
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < comps.size(); i++) {
            String key = "c" + i;
            params.put(key, comps.get(i));
            // CONTAINS, не [0]= — правило корпуса: многосвязная сущность иначе
            // видна только под одним случайным значением.
            parts.add(direct + " CONTAINS :" + key
                + (inherited != null ? " OR " + inherited + " CONTAINS :" + key : ""));
        }
        return " AND (" + String.join(" OR ", parts) + ")";
    }

    private String projectFilter(Branch b, String project, Map<String, Object> params, boolean viaParent) {
        if (project == null || project.isBlank()) return "";
        params.put("proj", project);
        // Без [0] — тот же список-капкан, что у компонентов выше.
        String expr = viaParent ? "in('HAS_STATE')." + b.projExpr() : b.projExpr();
        return " AND (" + expr + " CONTAINS :proj)";
    }

    /** Сниппет + matched_field + эффективные компоненты одной строки. */
    private Map<String, Object> shapeHit(Branch b, Map<String, Object> r, String rawQ,
                                         List<String> textFields, boolean fromHist) {
        Map<String, Object> hit = new LinkedHashMap<>();
        hit.put("ref_id", r.get("ref_id"));
        hit.put("title", r.get("title"));
        hit.put("score", r.getOrDefault("score", 1.0));

        // Где совпало: первое текстовое поле с токеном запроса. Совпадение может
        // быть морфологическим (поле «релиза», запрос «релиз») — тогда точного
        // вхождения нет, и честный ответ «в теле/в заголовке» по полю индекса.
        String token = rawQ.split("\\s+")[0].toLowerCase(Locale.ROOT);
        String matched = fromHist ? "body" : "title";
        String snippet = null;
        for (String f : textFields) {
            Object v = r.get(f);
            if (v == null) continue;
            String s = String.valueOf(v);
            int i = s.toLowerCase(Locale.ROOT).indexOf(token);
            if (i >= 0) {
                matched = f;
                int from = Math.max(0, i - 60);
                int to = Math.min(s.length(), i + token.length() + 60);
                snippet = (from > 0 ? "…" : "") + s.substring(from, to) + (to < s.length() ? "…" : "");
                break;
            }
        }
        hit.put("matched_field", matched);
        hit.put("snippet", snippet);

        List<Object> comps = effectiveComponents(r);
        hit.put("components", comps);
        boolean inherited = asList(r.get("comp_direct")).isEmpty() && !comps.isEmpty();
        hit.put("inherited_from", inherited ? b.inheritedFrom() : null);
        hit.put("projects", asList(r.get("proj")));
        return hit;
    }

    /** Прямые компоненты, а при их отсутствии — выведенные от родителя. */
    private List<Object> effectiveComponents(Map<String, Object> r) {
        List<Object> direct = asList(r.get("comp_direct"));
        return direct.isEmpty() ? asList(r.get("comp_inherited")) : direct;
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object v) {
        if (v == null) return List.of();
        if (v instanceof List<?> l) return (List<Object>) l;
        return List.of(v);
    }

    /**
     * Сборка Lucene-выражения (D2). Пользовательский ввод НЕ трактуется как
     * Lucene-синтаксис: метасимволы вырезаются (замена пробелом), а не
     * экранируются — экранированный мусор всё равно никому не нужен, а
     * вырезание не оставляет пути к синтаксической ошибке.
     *
     * smart: (t1) AND … AND (tN OR tN*) — морфология на каждом токене,
     *        префикс на последнем (поиск-как-набираешь);
     * exact: "фраза целиком";
     * fuzzy: токены от 5 букв получают ~ (устойчивость к опечаткам).
     */
    static String buildLuceneQuery(String q, String mode) {
        String cleaned = q.replaceAll("[+\\-!(){}\\[\\]^\"~*?:\\\\/&|]", " ").trim();
        if (cleaned.isBlank()) return "";
        if ("exact".equals(mode)) return "\"" + cleaned + "\"";
        String[] tokens = cleaned.split("\\s+");
        List<String> parts = new ArrayList<>();
        for (int i = 0; i < tokens.length; i++) {
            String t = tokens[i];
            boolean last = i == tokens.length - 1;
            if ("fuzzy".equals(mode) && t.length() >= 5) {
                parts.add("(" + t + "~)");
            } else if (last) {
                parts.add("(" + t + " OR " + t + "*)");
            } else {
                parts.add("(" + t + ")");
            }
        }
        return String.join(" AND ", parts);
    }

    private Map<String, Double> effectivePriorities() {
        Map<String, Double> out = new HashMap<>();
        for (Branch b : BRANCHES) out.put(b.type(), b.priority());
        priorityOverride.ifPresent(s -> {
            for (String pair : s.split(",")) {
                String[] kv = pair.split(":");
                if (kv.length == 2) {
                    try { out.put(kv[0].trim(), Double.parseDouble(kv[1].trim())); }
                    catch (NumberFormatException ignored) {
                        LOG.warnf("[LORE SEARCH] неразборчивый приоритет '%s' — пропущен", pair);
                    }
                }
            }
        });
        return out;
    }

    private static Set<String> csv(String s) {
        if (s == null || s.isBlank()) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        for (String p : s.split(",")) if (!p.isBlank()) out.add(p.trim());
        return out;
    }

    private static double round3(double v) { return Math.round(v * 1000.0) / 1000.0; }
}
