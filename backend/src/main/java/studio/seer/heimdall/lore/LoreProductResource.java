package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ADR-LORE-022 (ACCEPTED) + PL-28 (решение №141): продуктовый слой — ОДИН тип
 * KnowUseCase с само-иерархией. «Фича» = корневой сценарий (goal_level
 * ☁ cloud / 🪁 kite), «UC» = сценарий внутри (🌊 sea-level / 🐟 subfunction).
 * /lore/feature и /lore/uc пишут в ОДИН тип: первый — вход «заведи корень» с
 * проверкой уровня, второй — общий; родитель задаётся parent_uc_id.
 * Vertex-only (без Hist, как KnowDecision/KnowQuestion). Статус корня
 * «фича целиком» — ВЫЧИСЛЯЕМЫЙ факт (D4: shipped ⇔ все дочерние shipped),
 * поэтому запись не принимает status='shipped' на корне — его выводит слайс.
 * Все link-пути с linked-валидацией: CREATE EDGE в пустой FROM/TO — тихий
 * no-op (правило корпуса), мост честно отдаёт linked:false + hint.
 */
@Path("/lore")
public class LoreProductResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProductResource.class);

    private static final List<String> PRODUCT_STATUSES = List.of("proposed", "active", "shipped", "dropped");

    /** Шкала целей Коберна — одна на весь слой (ADR-LORE-032 §1): фичи живут на
     *  cloud/kite, UC — на sea-level/subfunction. Канон, словарь uc_goal_level. */
    static final List<String> UC_GOAL_LEVELS = List.of("cloud", "kite", "sea-level", "subfunction");

    /** Два веса оформления по Коберну (ADR-LORE-027-D1), словарь uc_rigor. */
    static final List<String> UC_RIGORS = List.of("casual", "fully-dressed");

    /** Типы работ клиента (Остервальдер VPC), словарь job_kind. */
    static final List<String> JOB_KINDS = List.of("functional", "social", "emotional", "supporting");

    /** Ранги выгоды (Остервальдер VPC), словарь gain_rank. */
    static final List<String> GAIN_RANKS = List.of("essential", "expected", "desired", "unexpected");

    /**
     * Дефолтный вес из уровня цели (ADR-027-D1): обзорные и пользовательские цели
     * пишутся полно, подфункции — легко. Автор вправе переопределить — поэтому это
     * дефолт, а не правило: явный rigor в запросе всегда сильнее.
     */
    static String defaultRigor(String goalLevel) {
        return "subfunction".equals(goalLevel) ? "casual" : "fully-dressed";
    }

    @Inject
    @RestClient
    LoreCommandClient writeClient;

    @Inject
    LoreIngestService ingest;

    // ── Feature = КОРНЕВОЙ сценарий ──────────────────────────────────────────
    //
    // PL-28 (решение №141): отдельного типа больше нет. Эндпоинт сохранён и
    // пишет в KnowUseCase — это удобный вход «заведи корень», а не вторая
    // сущность. Так остаётся в силе и ограничение ADR-032 §1: корень живёт
    // только на верхних ступенях шкалы Коберна.

    public record FeatureRequest(String feature_id, String title, String body_md,
                                 String context_md, String status, String component_id,
                                 String goal_level) {}

    @POST
    @Path("feature")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertFeature(FeatureRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.feature_id() == null || req.feature_id().isBlank())
            return badParams("feature_id required");
        if (!SAFE_ID.matcher(req.feature_id()).matches())
            return badParams("feature_id contains illegal characters");
        if (req.status() != null && !PRODUCT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + PRODUCT_STATUSES);
        // D4: shipped у фичи не назначается рукой — он выводится из UC.
        if ("shipped".equals(req.status()))
            return badParams("feature 'shipped' is computed from its UCs (D4), not set directly");
        // ADR-032 §1: фича — UC уровня стратегии, поэтому живёт на ВЕРХНИХ ступенях
        // той же шкалы Коберна; sea-level/subfunction — высота сценария, не фичи.
        if (req.goal_level() != null && !List.of("cloud", "kite").contains(req.goal_level()))
            return badParams("feature goal_level must be cloud|kite (☁ стратегия / 🪁 обзор); "
                + "sea-level и subfunction — уровни UC, не фичи (ADR-LORE-032 §1)");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowUseCase SET uc_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.feature_id());
            if (req.title() != null)        { sql.append(", title=:t");        p.put("t", req.title()); }
            if (req.body_md() != null)      { sql.append(", body_md=:b");      p.put("b", req.body_md()); }
            if (req.context_md() != null)   { sql.append(", context_md=:cx");  p.put("cx", req.context_md()); } // D13
            if (req.status() != null)       { sql.append(", status=:s");       p.put("s", req.status()); }
            if (req.component_id() != null) { sql.append(", component_id=:c"); p.put("c", req.component_id()); }
            // Уровень обязателен по существу: слайс «Фичи» отбирает корни именно
            // по goal_level, и корень без него был бы невидим в своём же разделе.
            // Умолчание ☁ cloud — самый верхний уровень шкалы.
            sql.append(", goal_level=:gl");
            p.put("gl", req.goal_level() != null ? req.goal_level() : "cloud");
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE uc_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE FEATURE] %s: %s", req.feature_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── UseCase ──────────────────────────────────────────────────────────────

    // actor-строки нет (D12): акторы — вершины KnowActor, связь HAS_ACTOR через uc/link.
    // parent_uc_id (PL-28) заменил feature_id: родитель теперь того же типа.
    public record UcRequest(String uc_id, String title, String scenario_md,
                            String acceptance_md, String status, String parent_uc_id,
                            String goal_level, String rigor, String priority) {}

    @POST
    @Path("uc")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertUc(UcRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.uc_id() == null || req.uc_id().isBlank())
            return badParams("uc_id required");
        if (!SAFE_ID.matcher(req.uc_id()).matches())
            return badParams("uc_id contains illegal characters");
        if (req.status() != null && !PRODUCT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + PRODUCT_STATUSES);
        // ADR-027 §2: классификация Коберна — канон словарей, свободных значений нет.
        if (req.goal_level() != null && !UC_GOAL_LEVELS.contains(req.goal_level()))
            return badParams("goal_level must be one of: " + UC_GOAL_LEVELS
                + " (☁ cloud/🪁 kite — уровень фичи, 🌊 sea-level/🐟 subfunction — уровень UC)");
        if (req.rigor() != null && !UC_RIGORS.contains(req.rigor()))
            return badParams("rigor must be one of: " + UC_RIGORS);
        try {
            // Уровень цели задан — вес по умолчанию выводится из него (ADR-027-D1),
            // но явный rigor автора сильнее вычисленного дефолта.
            String goal = req.goal_level();
            String rigor = req.rigor() != null ? req.rigor() : (goal != null ? defaultRigor(goal) : null);
            // ADR-027 §5: пустой scenario_md → сервер вставляет скелет ВЫБРАННОГО веса
            // (заголовки-конвенция §1) — свежий UC сразу знает, что заполнять.
            String scenario = req.scenario_md();
            boolean templateInserted = false;
            if ((scenario == null || scenario.isBlank())) {
                scenario = CockburnTemplate.forRigor(rigor);
                templateInserted = true;
            }

            StringBuilder sql = new StringBuilder("UPDATE KnowUseCase SET uc_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.uc_id());
            if (req.title() != null)         { sql.append(", title=:t");          p.put("t", req.title()); }
            if (req.scenario_md() != null) {
                // Явный текст автора ПЕРЕЗАПИСЫВАЕТ.
                sql.append(", scenario_md=:sc"); p.put("sc", req.scenario_md());
            } else if (templateInserted) {
                // Шаблон-каркас ставим ТОЛЬКО в отсутствующий scenario_md — ifnull не
                // затирает уже написанный сценарий при повторном upsert без текста.
                sql.append(", scenario_md = ifnull(scenario_md, :sc)"); p.put("sc", scenario);
            }
            if (req.acceptance_md() != null) { sql.append(", acceptance_md=:ac"); p.put("ac", req.acceptance_md()); }
            if (req.status() != null)        { sql.append(", status=:s");         p.put("s", req.status()); }
            if (req.parent_uc_id() != null)  { sql.append(", parent_uc_id=:f");   p.put("f", req.parent_uc_id()); }
            if (req.priority() != null)      { sql.append(", priority=:pr");      p.put("pr", req.priority()); }
            if (goal != null) { sql.append(", goal_level=:gl"); p.put("gl", goal); }
            if (rigor != null) { sql.append(", rigor=:rg"); p.put("rg", rigor); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE uc_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();

            // parent_uc_id — поле-родитель; ребро DECOMPOSES_INTO держим в синхроне
            // (класс багов «поле есть — ребра нет», relinkParentEdge/SpecComponentEdge).
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            if (templateInserted) out.put("template_inserted", rigor == null ? "fully-dressed" : rigor);
            // ADR-027-D3: quality возвращается В ОТВЕТЕ uc_new/uc_set всегда — агент
            // чинит оформление в той же сессии, не дожидаясь ревью.
            out.put("quality", qualityOf(req.uc_id()));
            out.put("uc_id", req.uc_id());
            if (req.parent_uc_id() != null && !req.parent_uc_id().isBlank()) {
                // Само-иерархия допускает цикл, которого раньше не было по
                // построению (два разных типа). Проверяем явно: сценарий,
                // ставший собственным предком, зациклил бы и обход слайса, и
                // вычислитель готовности.
                if (req.parent_uc_id().equals(req.uc_id()))
                    return badParams("parent_uc_id совпадает с uc_id: сценарий не может быть своим родителем");
                if (isDescendant(req.uc_id(), req.parent_uc_id()))
                    return badParams("parent_uc_id «" + req.parent_uc_id() + "» — потомок «" + req.uc_id()
                        + "»: связь замкнула бы иерархию в цикл");
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(inE('DECOMPOSES_INTO')) FROM KnowUseCase WHERE uc_id=:id)",
                    Map.of("id", req.uc_id()))).await().indefinitely();
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> created = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE DECOMPOSES_INTO " +
                        "FROM (SELECT FROM KnowUseCase WHERE uc_id=:f) " +
                        "TO   (SELECT FROM KnowUseCase WHERE uc_id=:id) IF NOT EXISTS",
                        Map.of("f", req.parent_uc_id(), "id", req.uc_id())))
                    .await().indefinitely().result();
                boolean linked = created != null && !created.isEmpty();
                out.put("parent_linked", linked);
                if (!linked) out.put("hint", "родительский сценарий «" + req.parent_uc_id()
                    + "» не найден — заведите его через /lore/uc или /lore/feature");
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE UC] %s: %s", req.uc_id(), e.getMessage());
            return upstream(e);
        }
    }

    /**
     * PL-28: цикл в само-иерархии. Пока типов было два, «фича внутри своего же
     * сценария» была невозможна по построению — один тип это разрешает, и
     * защита обязана появиться вместе с ним. Зацикленная иерархия повесила бы
     * и обход слайса, и вычислитель готовности (D17), причём молча.
     *
     * Возвращает true, если candidate достижим из root по DECOMPOSES_INTO,
     * то есть назначение его родителем замкнёт кольцо. MAXDEPTH — страховка на
     * случай, если кольцо уже как-то попало в данные: без неё обход по битому
     * графу не закончится никогда.
     */
    private boolean isDescendant(String rootUcId, String candidateUcId) {
        try {
            List<Map<String, Object>> hit = ingest.queryPublic(
                "SELECT uc_id FROM (TRAVERSE out('DECOMPOSES_INTO') FROM "
                + "(SELECT FROM KnowUseCase WHERE uc_id=:root) MAXDEPTH 20) WHERE uc_id=:cand",
                Map.of("root", rootUcId, "cand", candidateUcId));
            return !hit.isEmpty();
        } catch (Exception e) {
            // Проверка не удалась — не пропускаем запись «на всякий случай»:
            // молча созданный цикл дороже отказа, который видно сразу.
            LOG.warnf("[LORE UC] проверка цикла %s → %s не выполнена: %s",
                rootUcId, candidateUcId, e.getMessage());
            throw new IllegalStateException("проверка иерархии не выполнена: " + e.getMessage(), e);
        }
    }

    // ── Actor (D12): проектируемая роль приложения ───────────────────────────

    public record ActorRequest(String actor_id, String name, String kind, String body_md) {}

    @POST
    @Path("actor")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertActor(ActorRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.actor_id() == null || req.actor_id().isBlank())
            return badParams("actor_id required");
        if (!SAFE_ID.matcher(req.actor_id()).matches())
            return badParams("actor_id contains illegal characters");
        if (req.kind() != null && !List.of("human-role", "system", "agent").contains(req.kind()))
            return badParams("kind must be human-role|system|agent");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowActor SET actor_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.actor_id());
            if (req.name() != null)    { sql.append(", name=:n");    p.put("n", req.name()); }
            if (req.kind() != null)    { sql.append(", kind=:k");    p.put("k", req.kind()); }
            if (req.body_md() != null) { sql.append(", body_md=:b"); p.put("b", req.body_md()); }
            sql.append(" UPSERT WHERE actor_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "actor_id", req.actor_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE ACTOR] %s: %s", req.actor_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Job / Pain / Gain — профиль клиента по Остервальдеру (ADR-LORE-032 §2) ──
    // Три столпа VPC: РАБОТЫ (что клиент пытается сделать), БОЛИ (что мешает
    // работе) и ВЫГОДЫ (что значит успех в работе). Все три — ВЕРШИНЫ, а не проза
    // в context_md: только тогда fit канвы считается рёбрами, элемент
    // переиспользуется несколькими фичами, и видно «самую горячую боль» + дубль
    // усилий. Проектные — как акторы (D18).

    /** Работа клиента (Остервальдер): kind = functional|social|emotional|supporting. */
    public record JobRequest(String job_id, String title, String body_md, String kind, String importance) {}

    @POST
    @Path("job")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertJob(JobRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.job_id() == null || req.job_id().isBlank())
            return badParams("job_id required");
        if (!SAFE_ID.matcher(req.job_id()).matches())
            return badParams("job_id contains illegal characters");
        if (req.kind() != null && !JOB_KINDS.contains(req.kind()))
            return badParams("kind must be one of: " + JOB_KINDS
                + " (Остервальдер: функциональная | социальная | эмоциональная | вспомогательная)");
        if (req.importance() != null && !List.of("high", "normal", "low").contains(req.importance()))
            return badParams("importance must be high|normal|low");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowJob SET job_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.job_id());
            if (req.title() != null)      { sql.append(", title=:t");      p.put("t", req.title()); }
            if (req.body_md() != null)    { sql.append(", body_md=:b");    p.put("b", req.body_md()); }
            if (req.kind() != null)       { sql.append(", kind=:k");       p.put("k", req.kind()); }
            if (req.importance() != null) { sql.append(", importance=:i"); p.put("i", req.importance()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE job_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "job_id", req.job_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE JOB] %s: %s", req.job_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record PainRequest(String pain_id, String title, String body_md, String severity) {}

    @POST
    @Path("pain")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertPain(PainRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.pain_id() == null || req.pain_id().isBlank())
            return badParams("pain_id required");
        if (!SAFE_ID.matcher(req.pain_id()).matches())
            return badParams("pain_id contains illegal characters");
        if (req.severity() != null && !List.of("high", "normal", "low").contains(req.severity()))
            return badParams("severity must be high|normal|low");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowPain SET pain_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.pain_id());
            if (req.title() != null)    { sql.append(", title=:t");    p.put("t", req.title()); }
            if (req.body_md() != null)  { sql.append(", body_md=:b");  p.put("b", req.body_md()); }
            if (req.severity() != null) { sql.append(", severity=:s"); p.put("s", req.severity()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE pain_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "pain_id", req.pain_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE PAIN] %s: %s", req.pain_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record GainRequest(String gain_id, String title, String body_md, String metric_md, String rank) {}

    @POST
    @Path("gain")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertGain(GainRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.gain_id() == null || req.gain_id().isBlank())
            return badParams("gain_id required");
        if (!SAFE_ID.matcher(req.gain_id()).matches())
            return badParams("gain_id contains illegal characters");
        // Остервальдер ранжирует выгоды — essential не равна unexpected при отборе UC.
        if (req.rank() != null && !GAIN_RANKS.contains(req.rank()))
            return badParams("rank must be one of: " + GAIN_RANKS
                + " (Остервальдер: обязательная | ожидаемая | желаемая | неожиданная)");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowGain SET gain_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.gain_id());
            if (req.title() != null)     { sql.append(", title=:t");     p.put("t", req.title()); }
            if (req.body_md() != null)   { sql.append(", body_md=:b");   p.put("b", req.body_md()); }
            if (req.metric_md() != null) { sql.append(", metric_md=:m"); p.put("m", req.metric_md()); }
            if (req.rank() != null)      { sql.append(", rank=:r");      p.put("r", req.rank()); }
            sql.append(", date_created = ifnull(date_created, :d)");
            p.put("d", LocalDate.now().toString());
            sql.append(" UPSERT WHERE gain_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("gain_id", req.gain_id());
            // metric_md — не required на записи (выгоду формулируют раньше, чем метрику),
            // но БЕЗ него выгода никогда не будет замкнута в fit (ADR-032 §2): говорим сразу.
            if (req.metric_md() == null || req.metric_md().isBlank())
                out.put("hint", "metric_md пуст — выгода не будет засчитана в fit VP-канвы, пока не появится метрика");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE GAIN] %s: %s", req.gain_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Профиль клиента: работа/боль/выгода → актор и боль/выгода → работа ─────
    // Левая половина канвы Остервальдера. Без этих путей V8-рёбра FELT_BY/DESIRED_BY
    // существовали в схеме, но создать их было НЕЧЕМ (найдено 2026-07-17): профиль
    // клиента собирался только из прозы, а «чья боль» нельзя было спросить у графа.

    public record VpLinkRequest(String source_id, String rel, String target_id, String action) {}

    @POST
    @Path("vp/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkVp(VpLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.source_id() == null || req.source_id().isBlank()
                || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("source_id, rel (felt_by|desired_by|performed_by|blocks|success_of), target_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            String edge, fromSql, toSql;
            Map<String, Object> p = Map.of("sid", req.source_id(), "tid", req.target_id());
            switch (req.rel()) {
                case "felt_by" -> {      // KnowPain -> KnowActor: чья это боль
                    edge = "FELT_BY";
                    fromSql = "(SELECT FROM KnowPain WHERE pain_id=:sid)";
                    toSql   = "(SELECT FROM KnowActor WHERE actor_id=:tid)";
                }
                case "desired_by" -> {   // KnowGain -> KnowActor: кто желает выгоду
                    edge = "DESIRED_BY";
                    fromSql = "(SELECT FROM KnowGain WHERE gain_id=:sid)";
                    toSql   = "(SELECT FROM KnowActor WHERE actor_id=:tid)";
                }
                case "performed_by" -> { // KnowJob -> KnowActor: чья это работа
                    edge = "PERFORMED_BY";
                    fromSql = "(SELECT FROM KnowJob WHERE job_id=:sid)";
                    toSql   = "(SELECT FROM KnowActor WHERE actor_id=:tid)";
                }
                case "blocks" -> {       // KnowPain -> KnowJob: боль мешает работе
                    edge = "BLOCKS";
                    fromSql = "(SELECT FROM KnowPain WHERE pain_id=:sid)";
                    toSql   = "(SELECT FROM KnowJob WHERE job_id=:tid)";
                }
                case "success_of" -> {   // KnowGain -> KnowJob: выгода = успех в работе
                    edge = "SUCCESS_OF";
                    fromSql = "(SELECT FROM KnowGain WHERE gain_id=:sid)";
                    toSql   = "(SELECT FROM KnowJob WHERE job_id=:tid)";
                }
                default -> { return badParams("rel must be felt_by|desired_by|performed_by|blocks|success_of"); }
            }
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM " + edge + " WHERE @out.pain_id=:sid OR @out.gain_id=:sid OR @out.job_id=:sid", p))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "source_id", req.source_id(),
                    "rel", req.rel(), "target_id", req.target_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM " + fromSql + " TO " + toSql + " IF NOT EXISTS", p))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "source_id", req.source_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что обе вершины существуют")));
        } catch (Exception e) {
            LOG.warnf("[LORE VP LINK] %s: %s", req.source_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Feature links: VP-профиль (pain/gain), стратегическая цель, компонент ──

    public record FeatureLinkRequest(String feature_id, String rel, String target_id, String action) {}

    @POST
    @Path("feature/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkFeature(FeatureLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.feature_id() == null || req.feature_id().isBlank()
                || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("feature_id, rel (pain|gain|job|milestone|component), target_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            String edge, toSql;
            Map<String, Object> p = Map.of("fid", req.feature_id(), "tid", req.target_id());
            switch (req.rel()) {
                case "pain" -> { // фича ЗАЯВЛЯЕТ, что адресует боль; снимает её — UC (RELIEVES)
                    edge = "ADDRESSES";
                    toSql = "(SELECT FROM KnowPain WHERE pain_id=:tid)";
                }
                case "gain" -> { // фича ОБЕЩАЕТ выгоду; создаёт её — UC (DELIVERS)
                    edge = "PROMISES";
                    toSql = "(SELECT FROM KnowGain WHERE gain_id=:tid)";
                }
                case "job" -> { // фича ЗАЯВЛЯЕТ, что помогает с работой; выполняет — UC (PERFORMS)
                    edge = "HELPS_WITH";
                    toSql = "(SELECT FROM KnowJob WHERE job_id=:tid)";
                }
                case "milestone" -> { // ADR-032 §1: стратегическая цель (KAOS: веха = goal)
                    edge = "TARGETS_MILESTONE";
                    toSql = "(SELECT FROM KnowMilestone WHERE milestone_id=:tid)";
                }
                case "component" -> {
                    edge = "BELONGS_TO";
                    toSql = "(SELECT FROM LoreComponent WHERE component_id=:tid)";
                }
                default -> { return badParams("rel must be pain|gain|job|milestone|component"); }
            }
            if (remove) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:fid) " +
                    "WHERE @in.pain_id=:tid OR @in.gain_id=:tid OR @in.job_id=:tid " +
                    "OR @in.milestone_id=:tid OR @in.component_id=:tid", p))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id(),
                    "rel", req.rel(), "target_id", req.target_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM (SELECT FROM KnowUseCase WHERE uc_id=:fid) " +
                    "TO " + toSql + " IF NOT EXISTS", p))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            return noStore(Response.ok(Map.of("ok", true, "feature_id", req.feature_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что фича и target существуют")));
        } catch (Exception e) {
            LOG.warnf("[LORE FEATURE LINK] %s: %s", req.feature_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── UC links: REALIZES (task→uc) и TRACED_TO (uc→adr|decision) ──────────

    public record UcLinkRequest(String uc_id, String rel, String target_id, String action, String actor_role) {}

    @POST
    @Path("uc/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkUc(UcLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.uc_id() == null || req.uc_id().isBlank()
                || req.rel() == null || req.target_id() == null || req.target_id().isBlank())
            return badParams("uc_id, rel (task|adr|decision|actor|includes|extends|relieves|delivers|performs), target_id required");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            String edge, fromSql, toSql;
            Map<String, Object> p = Map.of("uid", req.uc_id(), "tid", req.target_id());
            switch (req.rel()) {
                case "task" -> { // REALIZES: KnowTask -> KnowUseCase (target = task_uid)
                    edge = "REALIZES";
                    fromSql = "(SELECT FROM KnowTask WHERE task_uid=:tid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                }
                case "adr" -> { // TRACED_TO: KnowUseCase -> KnowADR (опционально, D9)
                    edge = "TRACED_TO";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowADR WHERE adr_id=:tid)";
                }
                case "decision" -> {
                    edge = "TRACED_TO";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowDecision WHERE decision_id=:tid)";
                }
                case "actor" -> { // D12: HAS_ACTOR — multi, UC -> KnowActor
                    edge = "HAS_ACTOR";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowActor WHERE actor_id=:tid)";
                }
                case "includes" -> { // D13: UC_INCLUDES — обязательный под-сценарий
                    edge = "UC_INCLUDES";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:tid)";
                }
                case "extends" -> { // D13: UC_EXTENDS — вариант-расширение
                    edge = "UC_EXTENDS";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowUseCase WHERE uc_id=:tid)";
                }
                case "relieves" -> { // ADR-032 D5: pain reliever — UC снимает боль
                    edge = "RELIEVES";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowPain WHERE pain_id=:tid)";
                }
                case "delivers" -> { // ADR-032 D5: gain creator — UC создаёт выгоду
                    edge = "DELIVERS";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowGain WHERE gain_id=:tid)";
                }
                case "performs" -> { // Остервальдер: UC ВЫПОЛНЯЕТ работу клиента —
                    // третья ось fit рядом с relieves/delivers
                    edge = "PERFORMS";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowJob WHERE job_id=:tid)";
                }
                default -> { return badParams("rel must be task|adr|decision|actor|includes|extends|relieves|delivers|performs"); }
            }
            if (remove) {
                boolean fromUc = !"task".equals(req.rel());
                String delSql = fromUc
                    ? "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) " +
                      "WHERE @in.adr_id=:tid OR @in.decision_id=:tid OR @in.actor_id=:tid OR @in.uc_id=:tid " +
                      "OR @in.pain_id=:tid OR @in.gain_id=:tid OR @in.job_id=:tid"
                    : "DELETE FROM (SELECT expand(inE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) WHERE @out.task_uid=:tid";
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", delSql, p))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "uc_id", req.uc_id(),
                    "rel", req.rel(), "target_id", req.target_id(), "action", "removed")));
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE " + edge + " FROM " + fromSql + " TO " + toSql + " IF NOT EXISTS", p))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();

            // ADR-028 D19: у HAS_ACTOR есть role (primary|supporting). Первый актор
            // сценария становится primary по умолчанию; явный actor_role сильнее и
            // проставляется даже на УЖЕ существующее ребро (иначе role legacy-рёбер
            // не выставить). Дефолт-role ставим только на свежесозданное ребро.
            if ("actor".equals(req.rel()) && (linked || req.actor_role() != null)) {
                String desired = req.actor_role() != null ? req.actor_role()
                    : (countPrimaryActors(req.uc_id()) == 0 ? "primary" : "supporting");
                if (!List.of("primary", "supporting").contains(desired))
                    return badParams("actor_role must be primary|supporting");
                // Проставляем на ТОЛЬКО что созданное ребро к этому актору.
                // ArcadeDB edge-query: @out/@in (правило корпуса feedback_arcadedb_edge_syntax).
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE HAS_ACTOR SET role=:r " +
                    "WHERE @out.uc_id=:uid AND @in.actor_id=:tid",
                    Map.of("r", desired, "uid", req.uc_id(), "tid", req.target_id())))
                    .await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "uc_id", req.uc_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что uc_id и target существуют")));
        } catch (Exception e) {
            LOG.warnf("[LORE UC LINK] %s: %s", req.uc_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Качество UC по Коберну (ADR-LORE-027 §4, PL-12) ──────────────────────

    /**
     * Собирает факты об UC из графа и судит их линтером {@link UcQuality}.
     * primary-актор и TRACED_TO — рёбра (HAS_ACTOR role='primary', TRACED_TO),
     * а не текст: линтер этого не знает, эндпоинт достаёт и передаёт готовые булы.
     * Тот же метод питает и ответ uc_new/uc_set (D3) — расхождение невозможно.
     */
    Map<String, Object> qualityOf(String ucId) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT rigor, goal_level, scenario_md, acceptance_md, " +
                "outE('HAS_ACTOR')[role='primary'].size() AS primary_actors, " +
                "out('TRACED_TO').size() AS traced " +
                "FROM KnowUseCase WHERE uc_id=:id", Map.of("id", ucId));
            if (rows.isEmpty()) return Map.of("error", "uc not found");
            Map<String, Object> r = rows.get(0);
            boolean primary = num(r.get("primary_actors")) > 0;
            boolean traced = num(r.get("traced")) > 0;
            UcQuality.Result res = UcQuality.evaluate(
                str(r.get("rigor")), str(r.get("goal_level")),
                str(r.get("scenario_md")), str(r.get("acceptance_md")), primary, traced);
            List<Map<String, Object>> findings = new java.util.ArrayList<>();
            for (UcQuality.Finding fnd : res.findings())
                findings.add(Map.of("code", fnd.code(), "ok", fnd.ok(),
                    "required", fnd.required(), "message", fnd.message()));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("rigor", res.rigor());
            out.put("score", res.score());
            out.put("max", res.max());
            out.put("findings", findings);
            return out;
        } catch (Exception e) {
            LOG.warnf("[LORE UC QUALITY] %s: %s", ucId, e.getMessage());
            return Map.of("error", e.getMessage());
        }
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    /** Сколько у UC уже primary-акторов (D19: должен быть ровно один). */
    private long countPrimaryActors(String ucId) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT outE('HAS_ACTOR')[role='primary'].size() AS n FROM KnowUseCase WHERE uc_id=:id",
                Map.of("id", ucId));
            return rows.isEmpty() ? 0 : num(rows.get(0).get("n"));
        } catch (Exception e) {
            return 0;
        }
    }

    public record UcQualityRequest(String uc_id) {}

    /** ADR-027-D3 режим (б): re-lint без записи — для ревью чужих UC и панели UI. */
    @POST
    @Path("uc/quality")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response ucQuality(UcQualityRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.uc_id() == null || req.uc_id().isBlank())
            return badParams("uc_id required");
        Map<String, Object> q = qualityOf(req.uc_id());
        if (q.containsKey("error") && "uc not found".equals(q.get("error")))
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("NOT_FOUND", "UC " + req.uc_id() + " не найден")));
        return noStore(Response.ok(q));
    }

    private Response upstream(Exception e) {
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
    }
}
