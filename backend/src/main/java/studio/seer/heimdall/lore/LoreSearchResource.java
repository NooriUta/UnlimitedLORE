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
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.05),
        new Branch("doc", "KnowDoc", "doc_id", "title", "ftKnowDoc",
            List.of("title", "content_md", "content_md_en", "content_md_ru"),
            "KnowDocHist", "ftKnowDocHist", List.of("content_md"),
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.10),
        // FT-индекса на QualityGate нет (реестр V11/V12) — единственная ветка
        // на ILIKE; score у неё симулируется константой ниже.
        new Branch("quality_gate", "QualityGate", "qg_id", "name", null,
            List.of("name", "content_md"),
            null, null, null,
            "component_id", null, null, DIRECT_PROJ, 0.80),
        // ── продуктовый слой ──
        // PL-28: ветка ОДНА. Фича перестала быть отдельным типом (решение №141),
        // и две ветки над одним KnowUseCase дали бы дубли в выдаче: один и тот
        // же документ пришёл бы дважды с разным приоритетом.
        //
        // Приоритет взят верхний из прежней пары (1.30, был у фичи), а не
        // средний: слияние типов не повод понижать продуктовый слой, а «фича»
        // и «сценарий» теперь одинаково релевантны запросу о продукте.
        // Тела обоих прежних веток объединены — body_md/context_md пришли от
        // корня, scenario_md/acceptance_md от сценария, и оба живут на одном типе.
        new Branch("use_case", "KnowUseCase", "uc_id", "title", "ftKnowUseCase",
            List.of("title", "body_md", "context_md", "scenario_md", "acceptance_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.30),
        new Branch("pain", "KnowPain", "pain_id", "title", "ftKnowPain",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.25),
        new Branch("gain", "KnowGain", "gain_id", "title", "ftKnowGain",
            List.of("title", "body_md", "metric_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.25),
        new Branch("job", "KnowJob", "job_id", "title", "ftKnowJob",
            List.of("title", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.25),
        new Branch("actor", "KnowActor", "actor_id", "name", "ftKnowActor",
            List.of("name", "body_md"),
            null, null, null,
            DIRECT_COMP, null, null, DIRECT_PROJ, 1.20));

    /** Переопределение приоритетов без пересборки: "adr:1.4,task:0.5". */
    @ConfigProperty(name = "lore.search.type-priority")
    Optional<String> priorityOverride;

    // Сколько строк тянем с ветки ДО квоты: из этого же числа считается by_type,
    // поэтому оно же — честный потолок счётчика фасета (документировано в ответе
    // полем capped_at, чтобы «ровно 50» читалось как «не меньше 50»).
    private static final int BRANCH_CAP = 50;

    /**
     * SRCH-06 (ADR-LORE-033 D6): «похожие записи» на {@code SEARCH_INDEX_MORE}.
     *
     * <p><b>На вход идентификатор, а не строка.</b> Отдельный эндпоинт, а не
     * режим основного поиска: иначе {@code q} стал бы полиморфным — то запрос,
     * то ссылка, — и вызывающему пришлось бы догадываться, как его поймут.
     *
     * <p><b>Два ЗАМЕРЕННЫХ ограничения движка (26.7.2), оба вынесены в ответ,
     * а не спрятаны.</b>
     * <ul>
     *   <li><b>Похожесть работает ТОЛЬКО внутри своего типа.</b> Rid ADR против
     *       индекса спринтов возвращает пусто: функция ищет документ в том же
     *       индексе, где он лежит. Межтиповых «похожих» не существует, и
     *       обещать их в UI нельзя.</li>
     *   <li><b>{@code $similarity} возвращает 1.0 у всех строк</b> — ровно как
     *       CLASSIC-ловушка у обычного поиска. Ранжировать по нему нельзя,
     *       поэтому мы его и не отдаём: константа, выданная за меру близости,
     *       хуже её отсутствия. Порядок — тот, что вернул движок.</li>
     * </ul>
     *
     * <p>Исходная запись из выдачи исключается: «похоже на само себя» — не ответ.
     */
    @GET
    @Path("search/similar")
    @Produces(MediaType.APPLICATION_JSON)
    public Response similar(@QueryParam("ref") String ref,
                            @QueryParam("limit") Integer limitParam,
                            @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        long t0 = System.nanoTime();
        if (ref == null || ref.isBlank()) return badParams("ref required");
        if (ref.length() > 160) return badParams("ref is longer than 160 characters");

        int limit = limitParam == null || limitParam < 1 ? 10 : Math.min(limitParam, 50);

        // Ищем, какому типу принадлежит идентификатор. Ветки без FT-индекса
        // (quality_gate) пропускаем сразу: «похожих» им взять неоткуда.
        for (Branch b : BRANCHES) {
            if (b.indexName() == null) continue;
            List<Map<String, Object>> src;
            try {
                src = ingestService.queryPublic(
                    "SELECT @rid AS rid FROM " + b.vertexClass() + " WHERE " + b.idField() + " = :ref LIMIT 1",
                    Map.of("ref", ref));
            } catch (Exception e) {
                LOG.warnf("[LORE SIMILAR] ветка %s не опрошена: %s", b.type(), e.getMessage());
                continue;
            }
            if (src.isEmpty()) continue;

            String rid = String.valueOf(src.get(0).get("rid"));
            List<Map<String, Object>> rows;
            try {
                // rid подставляется в текст запроса, а не параметром: ArcadeDB
                // ждёт здесь литерал-коллекцию RID. Значение получено из БД
                // предыдущим запросом и снаружи не приходит — подстановка
                // безопасна по происхождению, а не по вере в неё.
                rows = ingestService.queryPublic(
                    "SELECT " + b.idField() + " AS ref_id, " + b.titleField() + " AS title FROM "
                    + b.vertexClass() + " WHERE SEARCH_INDEX_MORE('" + b.indexName() + "', [" + rid + "]) = true "
                    + "LIMIT " + (limit + 1), Map.of());
            } catch (Exception e) {
                LOG.warnf("[LORE SIMILAR] %s: %s", ref, e.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", String.valueOf(e.getMessage()))));
            }

            List<Map<String, Object>> hits = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                if (ref.equals(String.valueOf(r.get("ref_id")))) continue; // сам себе не похожий
                Map<String, Object> hit = new LinkedHashMap<>();
                hit.put("type", b.type());
                hit.put("ref_id", r.get("ref_id"));
                hit.put("title", r.get("title"));
                hits.add(hit);
                if (hits.size() >= limit) break;
            }

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ref", ref);
            out.put("type", b.type());
            out.put("hits", hits);
            // Явно в ответе, а не примечанием в документации: потребитель должен
            // знать, что «похожие» ограничены типом и что порядок не ранжирован.
            out.put("same_type_only", true);
            out.put("ranked", false);
            out.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
            return noStore(Response.ok(out));
        }

        return noStore(Response.status(Response.Status.NOT_FOUND)
            .entity(new LoreError("NOT_FOUND", "ref «" + ref + "» не найден ни в одном индексируемом типе")));
    }

    @GET
    @Path("search")
    @Produces(MediaType.APPLICATION_JSON)
    public Response search(@QueryParam("q") String q,
                           @QueryParam("types") String typesCsv,
                           @QueryParam("components") String componentsCsv,
                           @QueryParam("projects") String projectsCsv,
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
        // SRCH-10: ось проекта стала множественной — как тип и компонент. Скаляр
        // не давал выбрать «два продукта из пяти», и UI поэтому фильтровал
        // проекты на клиенте, по одной странице выдачи.
        List<String> projs = new ArrayList<>(csv(projectsCsv));
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
        // SRCH-10: третья ось фасета. Раньше её не было в ответе вовсе, и UI
        // считал проекты ПО ТЕКУЩЕЙ СТРАНИЦЕ — то есть счётчики врали за
        // пределами первых 50 хитов, а серверный фильтр по проекту не
        // задействовался. Считается так же, как by_component: по всей выборке
        // ветки, а не по квоте выдачи.
        Map<String, Integer> byProject = new LinkedHashMap<>();
        // ADR-033 обещал поле warnings при падении ветки. Фактически ставилось
        // byType=-1 — и это уходило в фасет КАК СЧЁТЧИК: UI рисовал чип
        // «−1» вместо того, чтобы сказать «поиск по этому типу не отработал».
        // Минус-единица как сигнал ошибки хуже отсутствия сигнала: она
        // выглядит данными.
        List<Map<String, Object>> warnings = new ArrayList<>();

        for (Branch b : active) {
            try {
                List<Map<String, Object>> rows = queryBranch(b, lucene, q, comps, projs);
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
                    for (Object pr : asList(r.get("projects"))) {
                        byProject.merge(String.valueOf(pr), 1, Integer::sum);
                    }
                    if (taken++ >= perType) continue; // фасет считаем по всем, в выдачу — квоту
                    double raw = ((Number) r.getOrDefault("score", 1.0)).doubleValue();
                    r.put("score", round3(max <= 0 ? p : raw / max * p));
                    r.put("type", b.type());
                    hits.add(r);
                }
            } catch (Exception e) {
                // Ветка НЕ глотается молча: одна упавшая ветка — дырка в охвате.
                // Тип в by_type НЕ кладём вообще: счётчик означает «сколько
                // нашлось», а про упавшую ветку мы этого не знаем. Отдельное
                // поле warnings говорит «здесь не искали», и это принципиально
                // иное утверждение, чем «здесь ничего нет».
                LOG.warnf("[LORE SEARCH] ветка %s упала: %s", b.type(), e.getMessage());
                warnings.add(Map.of("type", b.type(), "error", String.valueOf(e.getMessage())));
            }
        }

        hits.sort((a, bb) -> Double.compare(
            ((Number) bb.get("score")).doubleValue(), ((Number) a.get("score")).doubleValue()));
        List<Map<String, Object>> page = hits.stream().skip(offset).limit(limit).toList();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("hits", page);
        out.put("by_type", byType);
        out.put("by_component", byComponent);
        out.put("by_project", byProject);
        // Пустой список, а не отсутствие ключа: потребителю не приходится
        // различать «поле не пришло» и «предупреждений нет».
        out.put("warnings", warnings);
        out.put("total_collected", hits.size());
        out.put("capped_at", BRANCH_CAP);
        out.put("took_ms", (System.nanoTime() - t0) / 1_000_000);
        return noStore(Response.ok(out));
    }

    /** Одна ветка: вершина + (если есть) открытая hist-строка со схлопыванием. */
    private List<Map<String, Object>> queryBranch(Branch b, String lucene, String rawQ,
                                                  List<String> comps, List<String> projs) {
        Map<String, Object> params = new HashMap<>();
        params.put("q", lucene);
        String compFilter = componentFilter(b, comps, params, false);
        String projFilter = projectFilter(b, projs, params, false);

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
            String hProjFilter = projectFilter(b, projs, hp, true);
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

    /**
     * ILIKE-fallback для ветки без FT-индекса (QualityGate).
     * БЕЗ собственных скобок: снаружи выражение уже в скобках, а вложенную
     * группу `(x OR (a OR b))` парсер ArcadeDB 26.7.2 не принимает вовсе —
     * «no viable alternative at input». Плоское OR разбирается нормально.
     */
    private String ilikeMatcher(Branch b, Map<String, Object> params, String rawQ) {
        params.put("txtlike", "%" + rawQ + "%");
        List<String> parts = new ArrayList<>();
        for (String f : b.vertexTextFields()) parts.add(f + " ILIKE :txtlike");
        return String.join(" OR ", parts);
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

    private String projectFilter(Branch b, List<String> projs, Map<String, Object> params, boolean viaParent) {
        if (projs == null || projs.isEmpty()) return "";
        // Без [0] — тот же список-капкан, что у компонентов выше: у сущности
        // проектов может быть несколько, и сравнение с первым случайным
        // показало бы её только под одним из них.
        String expr = viaParent ? "in('HAS_STATE')." + b.projExpr() : b.projExpr();
        StringBuilder or = new StringBuilder();
        for (int i = 0; i < projs.size(); i++) {
            String key = "proj" + i;
            params.put(key, projs.get(i));
            if (i > 0) or.append(" OR ");
            or.append(expr).append(" CONTAINS :").append(key);
        }
        return " AND (" + or + ")";
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
                if (kv.length != 2) continue;
                String type = kv[0].trim();
                // Неизвестный тип — почти наверняка опечатка: значение молча
                // осело бы в карте и ни на что не влияло, а автор конфига был
                // бы уверен, что настроил.
                if (!out.containsKey(type)) {
                    LOG.warnf("[LORE SEARCH] приоритет для неизвестного типа '%s' — пропущен", type);
                    continue;
                }
                double v;
                try { v = Double.parseDouble(kv[1].trim()); }
                catch (NumberFormatException ignored) {
                    LOG.warnf("[LORE SEARCH] неразборчивый приоритет '%s' — пропущен", pair);
                    continue;
                }
                // Диапазона раньше не было вовсе: 0 выкидывал тип из выдачи
                // целиком (score обнулялся), отрицательное отправляло его в
                // конец за всё остальное. И то и другое выглядело как «поиск
                // сломался», а не как «в конфиге опечатка».
                if (!(v > 0) || v > 10) {
                    LOG.warnf("[LORE SEARCH] приоритет %s=%s вне (0; 10] — пропущен", type, kv[1].trim());
                    continue;
                }
                out.put(type, v);
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
