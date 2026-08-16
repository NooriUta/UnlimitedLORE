package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

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


    /**
     * Шкала целей Коберна — одна на весь слой (ADR-LORE-032 §1): корни живут на
     * cloud/kite, сценарии — на sea-level/subfunction.
     *
     * <p>PL-29: это <b>фолбэк</b>, а не источник истины. Канон — словарь
     * {@code uc_goal_level} (ADR-012, сид в схеме, {@code is_extensible=false}),
     * и валидация читает его. Прежняя редакция сверялась только с этой
     * константой, а словарь на write-path не читался вовсе — комментарий рядом
     * при этом утверждал «канон, словарь uc_goal_level». Правка словаря не
     * меняла поведения, правка константы не меняла словаря, и синхронизация
     * держалась на внимательности.
     *
     * <p>Список остаётся на случай пустого словаря: свежая БД без сидов не
     * должна отбивать любую запись — это превратило бы отсутствие справочника
     * в отказ обслуживания.
     */
    static final List<String> UC_GOAL_LEVELS_FALLBACK = List.of("cloud", "kite", "sea-level", "subfunction");

    /** Два веса оформления по Коберну (ADR-LORE-027-D1). Канон — словарь uc_rigor. */
    static final List<String> UC_RIGORS_FALLBACK = List.of("casual", "fully-dressed");

    /**
     * Допустимые коды словаря-канона. Пустой словарь → фолбэк (см. выше).
     * Неактивные записи ({@code is_active=false}) не принимаются: справочник
     * тем и полезен, что выведенное из обращения значение перестаёт проходить.
     */
    private List<String> dictCodes(String dictType, List<String> fallback) {
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                "SELECT code FROM KnowDictEntry WHERE dict_type=:dt AND is_active=true",
                Map.of("dt", dictType));
            List<String> codes = rows.stream()
                .map(r -> r.get("code")).filter(java.util.Objects::nonNull)
                .map(String::valueOf).toList();
            return codes.isEmpty() ? fallback : codes;
        } catch (Exception e) {
            // Справочник недоступен — валидируем по фолбэку, но говорим об этом
            // в логе. Пропустить любое значение было бы хуже: канон закрытый.
            LOG.warnf("[LORE DICT] словарь %s не прочитан (%s) — валидация по фолбэку", dictType, e.getMessage());
            return fallback;
        }
    }

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

    @Inject
    ProjectRbacService projectRbac;

    @Inject
    UcReadinessCalculator readiness;

    @Inject
    LoreFtIndexHealth ftIndexHealth;

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
        // D4/D17: у корня рукой ставятся только намерения — как и у любого другого
        // сценария (тип-то один). Прежняя редакция запрещала лишь shipped, и
        // «active» проезжал: корень можно было объявить работающим при нулевой работе.
        if (req.status() != null && !UcReadinessCalculator.INTENT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + UcReadinessCalculator.INTENT_STATUSES
                + " — " + UcReadinessCalculator.COMPUTED_STATUSES + " вычисляются из дочерних "
                + "сценариев и их задач (D4/D17), рукой не назначаются");
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
        // PL-15 (D17): руками ставятся только НАМЕРЕНИЯ. active/shipped/in_rework
        // выводит вычислитель из REALIZES-задач — иначе появляется расхождение
        // «сценарий shipped, задачи открыты», а именно его этот ADR и запрещает.
        // У корня такой запрет стоял с самого начала (§D4); здесь он был забыт,
        // и через /lore/uc можно было объявить готовность в обход работы.
        if (req.status() != null && !UcReadinessCalculator.INTENT_STATUSES.contains(req.status()))
            return badParams("status must be one of: " + UcReadinessCalculator.INTENT_STATUSES
                + " — " + UcReadinessCalculator.COMPUTED_STATUSES + " вычисляются из задач (D17) "
                + "и рукой не назначаются");
        // ADR-027 §2: классификация Коберна — канон словарей, свободных значений нет.
        if (req.goal_level() != null && !dictCodes("uc_goal_level", UC_GOAL_LEVELS_FALLBACK).contains(req.goal_level()))
            return badParams("goal_level must be one of: " + dictCodes("uc_goal_level", UC_GOAL_LEVELS_FALLBACK)
                + " (☁ cloud/🪁 kite — уровень фичи, 🌊 sea-level/🐟 subfunction — уровень UC)");
        if (req.rigor() != null && !dictCodes("uc_rigor", UC_RIGORS_FALLBACK).contains(req.rigor()))
            return badParams("rigor must be one of: " + dictCodes("uc_rigor", UC_RIGORS_FALLBACK));
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

    // PL-10 (D18): актор ПРОЕКТНЫЙ. «Администратор» одного продукта — не та же
    // роль, что одноимённая роль другого, и без разделения RBAC-матрица,
    // выводимая из тройки «роль × компонент × сценарий», склеивает чужие
    // продукты в одну строку.
    /**
     * @param project  ОДИН проект — прежняя форма, оставлена для совместимости
     *                 (MCP {@code actor_new} и вызовы, писавшиеся до AL-107).
     *                 Трактуется как список из одного элемента.
     * @param projects ПОЛНЫЙ набор проектов актора. Актор может принадлежать
     *                 нескольким продуктам — слайс {@code actors} и раньше
     *                 отдавал их массивом, а запись схлопывала в один и сносила
     *                 остальные (AL-107). Передан — задаёт набор целиком; не
     *                 передан — рёбра не трогаются вовсе.
     */
    public record ActorRequest(String actor_id, String name, String kind, String body_md,
                               String project, List<String> projects,
                               String machine_id, String session_id) {}

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
        // AL-68/AL-90 (первое семейство для обкатки D4, ADR-LORE-036): агентный
        // вызывающий с явным project в теле — проверить, разрешает ли роль его
        // владельца в ЭТОМ проекте профиль, под которым он пишет. Человека это
        // не касается (его прямые права — отдельный, ещё не закодированный
        // путь, §10.3 SPEC-RBAC-OMILORE-AGENTS) — requireAdmin() выше и так
        // единственный гейт человеческого вызова, здесь его не сужаем.
        String agentScope = callerAgentScope();
        if (agentScope != null) {
            // AL-107: проверять НАБОР целиком, а не только скалярный project.
            // Иначе добавление массива `projects` открыло бы обход: агент,
            // которому запрещён проект X, прислал бы его вторым элементом и
            // прошёл бы гейт, потому что скаляр пуст. Разрешение нужно на
            // КАЖДЫЙ проект, куда он просит привязать актора.
            List<String> asked = requestedProjects(req);
            String clientId = callerClientId();
            for (String slug : asked == null ? List.<String>of() : asked) {
                if (clientId == null || !projectRbac.agentAllowedInProject(clientId, slug, agentScope)) {
                    return agentScopeForbidden("агент agent-" + agentScope + " не пишет в 'actor' "
                        + "для проекта '" + slug + "': роль владельца там не делегирует этот профиль "
                        + "(или клиент/владелец/роль не сопоставлены в графе)");
                }
            }
        }
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowActor SET actor_id=:id");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", req.actor_id());
            if (req.name() != null)    { sql.append(", name=:n");    p.put("n", req.name()); }
            if (req.kind() != null)    { sql.append(", kind=:k");    p.put("k", req.kind()); }
            if (req.body_md() != null) { sql.append(", body_md=:b"); p.put("b", req.body_md()); }
            // AL-108: сессия пишет своё «откуда» самостоятельно — не назначение
            // владельца (client_id/agent_role остаются admin-путём actor/owner),
            // а самоописание, эскалации прав не несёт.
            if (req.machine_id() != null) { sql.append(", machine_id=:mid"); p.put("mid", req.machine_id()); }
            if (req.session_id() != null) { sql.append(", session_id=:sid"); p.put("sid", req.session_id()); }
            sql.append(" UPSERT WHERE actor_id=:id");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("actor_id", req.actor_id());
            // D18: принадлежность проекту — РЕБРО, а не поле. Поле было бы второй
            // правдой рядом с BELONGS_TO_PROJECT, который уже несут спринты.
            syncActorProjects(req, out);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ACTOR] %s: %s", req.actor_id(), e.getMessage());
            return upstream(e);
        }
    }

    /**
     * AL-107: привести набор рёбер {@code BELONGS_TO_PROJECT} актора к тому,
     * что прислал вызывающий.
     *
     * <p><b>Порядок операций существенный: сначала создаём, потом удаляем
     * лишние.</b> Прежняя редакция делала наоборот — сносила ВСЕ рёбра и
     * создавала одно. Обрыв между двумя запросами оставлял актора вообще без
     * проектов, а мультипроектного актора такая запись схлопывала всегда, даже
     * без обрыва. Решение [[DBR-04]]: сбой должен оставлять дубли, а не
     * пустоту — дубли чинятся, потеря нет.
     *
     * <p><b>Отсутствие ключа и пустой список — РАЗНОЕ.</b> Не передали ничего —
     * рёбра не трогаем (так работают прежние вызовы, которые о проектах не
     * знают). Передали пустой список — это осознанное «убрать все».
     *
     * <p>Незарегистрированный слаг не даёт ошибки: {@code CREATE EDGE} с пустым
     * TO — тихий no-op. Поэтому считаем фактически созданные рёбра и, если
     * что-то не привязалось, говорим об этом в ответе, а не молчим при ok:true.
     */
    private void syncActorProjects(ActorRequest req, Map<String, Object> out) {
        List<String> wanted = requestedProjects(req);
        if (wanted == null) return;   // ключ не передан — не наше дело

        List<String> missing = new java.util.ArrayList<>();
        for (String slug : wanted) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowActor WHERE actor_id=:id) " +
                    "TO (SELECT FROM KnowGitProject WHERE slug=:p) IF NOT EXISTS",
                    Map.of("id", req.actor_id(), "p", slug)))
                .await().indefinitely().result();
            // Пусто и при «уже было», и при «проекта нет» — различаем запросом
            // к самому ребру, иначе повторное сохранение выглядело бы как отказ.
            if (created == null || created.isEmpty()) {
                var exists = ingest.queryPublic(
                    "SELECT count(*) AS n FROM BELONGS_TO_PROJECT "
                    + "WHERE @out.actor_id = :id AND @in.slug = :p",
                    Map.of("id", req.actor_id(), "p", slug));
                long n = exists.isEmpty() ? 0 : ((Number) exists.get(0).getOrDefault("n", 0)).longValue();
                if (n == 0) missing.add(slug);
            }
        }

        // Удаляем ровно лишние. NOT IN по списку не строим: параметр-коллекция
        // в этой грамматике ведёт себя непредсказуемо — удаляем поштучно по
        // фактическому набору, вычтя запрошенный.
        var current = ingest.queryPublic(
            "SELECT out('BELONGS_TO_PROJECT').slug AS slugs FROM KnowActor WHERE actor_id = :id",
            Map.of("id", req.actor_id()));
        int removed = 0;
        if (!current.isEmpty() && current.get(0).get("slugs") instanceof List<?> have) {
            for (Object o : have) {
                if (o == null) continue;
                String slug = String.valueOf(o);
                if (wanted.contains(slug)) continue;
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM BELONGS_TO_PROJECT WHERE @out.actor_id = :id AND @in.slug = :p",
                    Map.of("id", req.actor_id(), "p", slug))).await().indefinitely();
                removed++;
            }
        }

        out.put("projects_linked", wanted.size() - missing.size());
        out.put("projects_removed", removed);
        if (!missing.isEmpty()) {
            out.put("projects_missing", missing);
            out.put("hint", "не зарегистрированы в реестре: " + String.join(", ", missing)
                + " — заведите через project_new, иначе привязка молча не создаётся");
        }
        // Совместимость: скалярная форма продолжает отдавать project_linked.
        // Поле описано в схеме MCP-инструмента actor_new как признак «проект не
        // зарегистрирован», и на него смотрят вызывающие, писавшиеся до AL-107.
        // Убрать его молча означало бы сломать документированный контракт ради
        // косметики — новые поля добавлены РЯДОМ, а не вместо.
        if (req.projects() == null && req.project() != null && !req.project().isBlank()) {
            out.put("project_linked", missing.isEmpty());
        }
    }

    /** Запрошенный набор проектов: {@code null} — ключей нет, трогать нечего. */
    private static List<String> requestedProjects(ActorRequest req) {
        if (req.projects() != null) {
            return req.projects().stream()
                .filter(s -> s != null && !s.isBlank())
                .distinct().toList();
        }
        if (req.project() != null && !req.project().isBlank()) return List.of(req.project());
        return null;
    }

    /**
     * ADR-LORE-037 V1: журнал сессий агентов.
     *
     * @param actor_id   agent actor_id, чья сессия это (LOGGED_BY target)
     * @param session_id session_id этой самой сессии — первичный ключ вершины,
     *                    upsert по нему (сессия живёт — activity обновляется;
     *                    новая сессия — новая вершина, старая остаётся)
     */
    public record AgentSessionRequest(String actor_id, String session_id, String machine_id,
                                       String project, String entrypoint, String dialogue_name) {}

    /**
     * ADR-LORE-037 D1-D4: `KnowAgentSession` — ОТДЕЛЬНАЯ вершина от
     * `KnowActor` (AL-108 несёт mutable «сейчас» на акторе, эта вершина несёт
     * append-факт «что было»). Пишет сама сессия про себя — не назначение
     * владельца, эскалации нет (симметрично `machine_id`/`session_id` в
     * {@link #upsertActor}).
     *
     * <p>{@code started_at} выставляется ТОЛЬКО при создании строки — иначе
     * повторный вызов (bump активности) переписал бы момент начала сессии на
     * текущий, и «сколько сессия уже идёт» стало бы всегда нулём.
     */
    @POST
    @Path("actor/session")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response logAgentSession(AgentSessionRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.actor_id() == null || req.actor_id().isBlank())
            return badParams("actor_id required");
        if (req.session_id() == null || req.session_id().isBlank())
            return badParams("session_id required");
        if (!SAFE_ID.matcher(req.actor_id()).matches() || !SAFE_ID.matcher(req.session_id()).matches())
            return badParams("actor_id/session_id contains illegal characters");
        try {
            List<Map<String, Object>> existing = ingest.queryPublic(
                "SELECT count(*) AS n FROM KnowAgentSession WHERE session_id = :sid",
                Map.of("sid", req.session_id()));
            boolean isNew = existing.isEmpty()
                || ((Number) existing.get(0).getOrDefault("n", 0)).longValue() == 0;

            String now = Instant.now().toString();
            StringBuilder sql = new StringBuilder(
                "UPDATE KnowAgentSession SET session_id=:sid, last_activity_at=:now");
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("sid", req.session_id());
            p.put("now", now);
            if (isNew) { sql.append(", started_at=:st"); p.put("st", now); }
            if (req.machine_id() != null)    { sql.append(", machine_id=:m");    p.put("m", req.machine_id()); }
            if (req.project() != null)       { sql.append(", project=:p");       p.put("p", req.project()); }
            if (req.entrypoint() != null)    { sql.append(", entrypoint=:e");    p.put("e", req.entrypoint()); }
            if (req.dialogue_name() != null) { sql.append(", dialogue_name=:d"); p.put("d", req.dialogue_name()); }
            sql.append(" UPSERT WHERE session_id=:sid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql.toString(), p))
                .await().indefinitely();

            // LOGGED_BY БЕЗ UNIQUE: агент копит много сессий за жизнь — в
            // отличие от OWNED_BY/FILLS_ROLE, здесь рёбра НАКАПЛИВАЮТСЯ.
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE LOGGED_BY FROM (SELECT FROM KnowAgentSession WHERE session_id=:sid) " +
                    "TO (SELECT FROM KnowActor WHERE actor_id=:aid) IF NOT EXISTS",
                    Map.of("sid", req.session_id(), "aid", req.actor_id())))
                .await().indefinitely().result();
            boolean logged = isNew ? (created != null && !created.isEmpty()) : true; // повтор — ребро уже есть

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("session_id", req.session_id());
            out.put("is_new", isNew);
            out.put("logged_by", logged);
            if (isNew && (created == null || created.isEmpty()))
                out.put("hint", "агент '" + req.actor_id() + "' не найден — заведите через actor_new, "
                    + "иначе LOGGED_BY молча не создан");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE AGENT-SESSION] %s: %s", req.session_id(), e.getMessage());
            return upstream(e);
        }
    }

    // AL-83/ADR-LORE-036: связка KnowActor(kind=agent) ↔ владелец-человек.
    // Отдельный подпуть, не поле в upsertActor: назначение владельца агента —
    // административный акт (кто может писать под этим клиентом KC), не
    // редактирование карточки актора. SUBPATH_AGENTS запрещает его ВСЕМ
    // агентным профилям, включая full — иначе агент мог бы переписать себе
    // владельца на более привилегированного человека (эскалация).
    /**
     * AL-104: матрица делегирования D4 наружу — «роль человека в проекте →
     * какие профили агента она вправе задействовать».
     *
     * <p>Нужна экрану «Агенты», чтобы показать, куда агент может ПИСАТЬ (в
     * отличие от того, что он видит). Отдаётся эндпоинтом, а НЕ дублируется
     * константой на фронте: правило живёт в {@link ProjectRbacService#ROLE_AGENT_MATRIX},
     * и вторая копия разошлась бы с первой при первой же правке — ровно так
     * уже расходились справочник и realm (см. {@code product-analyst}).
     */
    @GET
    @Path("rbac/agent-matrix")
    @Produces(MediaType.APPLICATION_JSON)
    public Response agentMatrix() {
        if (!enabled) return disabled();
        return noStore(Response.ok(Map.of("matrix", ProjectRbacService.ROLE_AGENT_MATRIX)));
    }

    /**
     * MT-02: на какой доле корпуса посчитан INVEST-профиль.
     *
     * <p>Отдельным эндпоинтом, а не полем внутри среза: срез возвращает СЫРЫЕ
     * строки задач, и подмешивать в них агрегат значило бы менять его контракт.
     * Потребитель зовёт оба и показывает долю рядом с балансом.
     */
    @GET
    @Path("product/invest-coverage")
    @Produces(MediaType.APPLICATION_JSON)
    public Response investCoverage() {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                LoreSlices.get("invest_profile").baseSql(), Map.of());
            return noStore(Response.ok(VpFitGaps.coverage(rows)));
        } catch (RuntimeException e) {
            LOG.warnf("[LORE INVEST-COVERAGE] %s", LoreUpstream.detail(e));
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", LoreUpstream.detail(e))));
        }
    }

    /** Плоский справочник ключ→значение из запроса с колонками k и v. */
    private Map<String, String> dictOf(String sql) {
        Map<String, String> out = new java.util.LinkedHashMap<>();
        for (Map<String, Object> r : ingest.queryPublic(sql, Map.of())) {
            Object k = r.get("k"), v = r.get("v");
            if (k != null && v != null) out.put(String.valueOf(k), String.valueOf(v));
        }
        return out;
    }

    /**
     * Разрыв «заявлено против доставлено» готовыми строками.
     *
     * <p>Срез {@code feature_vp_analytics} отдаёт сырые множества, а разницу
     * оставляет потребителю — и разницу не считал НИКТО. Цена выяснилась на
     * самой канве: {@code FEAT-VP-FIT}, фича ровно про ловлю этого разрыва,
     * стояла {@code shipped} с тремя пустыми осями доставки, и обнаружено это
     * было сверкой шести массивов глазами.
     *
     * <p>SQL переиспользуется из того же слайса, а не переписывается рядом:
     * вторая копия разошлась бы с первой при первой же правке — так уже
     * расходились справочник и realm.
     */
    @GET
    @Path("product/fit-gaps")
    @Produces(MediaType.APPLICATION_JSON)
    public Response fitGaps() {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> rows = ingest.queryPublic(
                LoreSlices.get("feature_vp_analytics").baseSql(), Map.of());
            // MT-04: ранги тянутся отдельными запросами, а не добавляются в
            // слайс. Слайс отдаёт строку НА КОРЕНЬ, а ранг живёт на выгоде —
            // втащить его туда значило бы либо дублировать строки, либо возить
            // параллельные массивы «id → ранг», которые разъезжаются при первой
            // же правке порядка. Два плоских справочника дешевле и честнее.
            Map<String, String> gainRanks = dictOf(
                "SELECT gain_id AS k, rank AS v FROM KnowGain");
            Map<String, String> painSeverities = dictOf(
                "SELECT pain_id AS k, severity AS v FROM KnowPain");
            List<VpFitGaps.Gap> gaps = VpFitGaps.evaluate(rows, gainRanks, painSeverities);
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("gaps", gaps);
            out.put("roots_checked", rows.size());
            // Сводка по весам: одна строка «3 из 17 существенные» отвечает на
            // вопрос «плохо ли всё» без чтения списка.
            long essential = gaps.stream().filter(VpFitGaps.Gap::essential).count();
            out.put("essential_gaps", essential);
            // Пустой список — это «дыр нет», а не «посмотреть не удалось»:
            // отказ уходит 502 ниже. Разводить эти два состояния обязательно,
            // иначе пустая выдача читается как здоровье (урок DBR-09).
            out.put("clean", gaps.isEmpty());
            return noStore(Response.ok(out));
        } catch (RuntimeException e) {
            LOG.warnf("[LORE FIT-GAPS] %s", LoreUpstream.detail(e));
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", LoreUpstream.detail(e))));
        }
    }

    /**
     * AL-104: {@code agent_role} — роль агента из справочника {@code agent_role}.
     * Необязателен: старые вызовы (до V21) роль не передавали, и затирать её
     * пустым значением при повторной привязке владельца нельзя.
     */
    public record ActorOwnerRequest(String actor_id, String client_id, String kc_sub, String agent_role) {}

    @POST
    @Path("actor/owner")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setActorOwner(ActorOwnerRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.actor_id() == null || req.actor_id().isBlank())
            return badParams("actor_id required");
        if (!SAFE_ID.matcher(req.actor_id()).matches())
            return badParams("actor_id contains illegal characters");
        if (req.client_id() == null || req.client_id().isBlank())
            return badParams("client_id required");
        if (req.kc_sub() == null || req.kc_sub().isBlank())
            return badParams("kc_sub required");
        try {
            List<Map<String, Object>> actor = ingest.queryPublic(
                "SELECT kind FROM KnowActor WHERE actor_id = :id", Map.of("id", req.actor_id()));
            if (actor == null || actor.isEmpty())
                return badParams("actor '" + req.actor_id() + "' не найден — заведите его через actor_new");
            if (!"agent".equals(actor.get(0).get("kind")))
                return badParams("actor '" + req.actor_id() + "' не kind=agent — владелец назначается только агентам");

            // agent_role пишем ТОЛЬКО когда передан: вызов без него (легаси или
            // повторная привязка владельца) не должен затирать уже выставленную
            // роль пустым значением.
            String setSql = "UPDATE KnowActor SET client_id=:c"
                + (req.agent_role() != null && !req.agent_role().isBlank() ? ", agent_role=:r" : "")
                + " WHERE actor_id=:id";
            Map<String, Object> setParams = new LinkedHashMap<>();
            setParams.put("c", req.client_id());
            setParams.put("id", req.actor_id());
            if (req.agent_role() != null && !req.agent_role().isBlank()) setParams.put("r", req.agent_role());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                setSql, setParams)).await().indefinitely();

            // Один живой владелец: снести старое ребро, поставить новое —
            // тот же паттерн, что HAS_PROJECT_ROLE reassign (AL-82).
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(outE('OWNED_BY')) FROM KnowActor WHERE actor_id=:id)",
                Map.of("id", req.actor_id()))).await().indefinitely();
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>)
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE OWNED_BY FROM (SELECT FROM KnowActor WHERE actor_id=:id) " +
                    "TO (SELECT FROM KnowUser WHERE kc_sub=:s) IF NOT EXISTS",
                    Map.of("id", req.actor_id(), "s", req.kc_sub())))
                .await().indefinitely().result();
            boolean linked = created != null && !created.isEmpty();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("actor_id", req.actor_id());
            out.put("client_id", req.client_id());
            out.put("owner_linked", linked);
            if (!linked) out.put("hint", "пользователь kc_sub=" + req.kc_sub()
                + " не заведён в графе — сперва POST /lore/user, иначе владелец молча не привязан");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ACTOR OWNER] %s: %s", req.actor_id(), e.getMessage());
            return upstream(e);
        }
    }

    /**
     * MT-11/D-VP-ROLE-AGENT-PAIR: агент → роль, которую он исполняет.
     * {@code rel} принимает единственное значение ({@code "fills_role"}) —
     * enum ради согласованности с остальными {@code *_link}-инструментами
     * (uc_link/task_link/…), не заглушка на будущее расширение конкретно
     * здесь.
     */
    public record ActorLinkRequest(String actor_id, String rel, String target_id, String action) {}

    @POST
    @Path("actor/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkActor(ActorLinkRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.actor_id() == null || req.actor_id().isBlank())
            return badParams("actor_id required");
        if (!SAFE_ID.matcher(req.actor_id()).matches())
            return badParams("actor_id contains illegal characters");
        if (!"fills_role".equals(req.rel()))
            return badParams("rel must be 'fills_role'");
        if (req.target_id() == null || req.target_id().isBlank())
            return badParams("target_id required");
        boolean remove = "remove".equals(req.action());
        try {
            List<Map<String, Object>> agentRows = ingest.queryPublic(
                "SELECT kind FROM KnowActor WHERE actor_id = :id", Map.of("id", req.actor_id()));
            if (agentRows == null || agentRows.isEmpty())
                return badParams("actor '" + req.actor_id() + "' не найден — заведите через actor_new");
            if (!"agent".equals(agentRows.get(0).get("kind")))
                return badParams("actor '" + req.actor_id() + "' не kind=agent — FILLS_ROLE заводится от агента к роли");

            // Один агент — одна действующая роль в любой момент: снести старое
            // ребро, поставить новое (тот же паттерн, что OWNED_BY/
            // HAS_PROJECT_ROLE reassign) — не накапливать историю рёбер.
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM (SELECT expand(outE('FILLS_ROLE')) FROM KnowActor WHERE actor_id=:id)",
                Map.of("id", req.actor_id()))).await().indefinitely();

            boolean linked = false;
            if (!remove) {
                List<Map<String, Object>> roleRows = ingest.queryPublic(
                    "SELECT actor_id FROM KnowActor WHERE actor_id = :id", Map.of("id", req.target_id()));
                if (roleRows == null || roleRows.isEmpty())
                    return badParams("actor '" + req.target_id() + "' (роль) не найден — заведите через actor_new");
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> created = (List<Map<String, Object>>)
                    writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                        "CREATE EDGE FILLS_ROLE FROM (SELECT FROM KnowActor WHERE actor_id=:id) " +
                        "TO (SELECT FROM KnowActor WHERE actor_id=:t) IF NOT EXISTS",
                        Map.of("id", req.actor_id(), "t", req.target_id())))
                    .await().indefinitely().result();
                linked = created != null && !created.isEmpty();
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("actor_id", req.actor_id());
            out.put("rel", req.rel());
            out.put("target_id", req.target_id());
            out.put("linked", linked);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ACTOR LINK] %s: %s", req.actor_id(), e.getMessage());
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
            return badParams("uc_id, rel (task|adr|decision|actor|component|project|includes|extends|relieves|delivers|performs), target_id required");
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
                // PL-10 (D14): компонент у сценария — ПРЯМОЙ, а не только через
                // родителя. Ядро ценности слоя — тройка «роль × компонент ×
                // сценарий», из которой выводится RBAC-матрица; пока компонент
                // брался только у корня, все его дочерние сценарии считались
                // принадлежащими одному и тому же модулю, и тройка вырождалась.
                case "component" -> {
                    edge = "BELONGS_TO";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM LoreComponent WHERE component_id=:tid)";
                }
                /**
                 * Проект сценария/корня (BELONGS_TO_PROJECT).
                 *
                 * Слайсы слоя отдают `projects` с PL-10, но записать проект
                 * было НЕЧЕМ: у `uc_link` этого отношения не существовало, и
                 * поле в выдаче всегда приходило пустым. При нескольких
                 * продуктах в одном корпусе это не косметика — без проекта
                 * сценарии разных продуктов сливаются в один список, ровно как
                 * одноимённые роли акторов без проекта (D18/D22).
                 */
                case "project" -> {
                    edge = "BELONGS_TO_PROJECT";
                    fromSql = "(SELECT FROM KnowUseCase WHERE uc_id=:uid)";
                    toSql   = "(SELECT FROM KnowGitProject WHERE slug=:tid)";
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
                default -> { return badParams("rel must be task|adr|decision|actor|component|includes|extends|relieves|delivers|performs"); }
            }
            if (remove) {
                boolean fromUc = !"task".equals(req.rel());
                String delSql = fromUc
                    ? "DELETE FROM (SELECT expand(outE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) " +
                      "WHERE @in.adr_id=:tid OR @in.decision_id=:tid OR @in.actor_id=:tid OR @in.uc_id=:tid " +
                      "OR @in.pain_id=:tid OR @in.gain_id=:tid OR @in.job_id=:tid OR @in.component_id=:tid"
                    : "DELETE FROM (SELECT expand(inE('" + edge + "')) FROM KnowUseCase WHERE uc_id=:uid) WHERE @out.task_uid=:tid";
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", delSql, p))
                    .await().indefinitely();
                // MT-07: отвязка задачи тоже меняет готовность. Снятие последней
                // задачи обязано вернуть статус к намерению автора — иначе
                // сценарий остаётся «выпущенным» без единой задачи.
                if ("task".equals(req.rel())) {
                    try {
                        readiness.recompute(req.uc_id());
                    } catch (RuntimeException e) {
                        LOG.warnf("[LORE READINESS] %s: пересчёт после отвязки не выполнен (%s)",
                            req.uc_id(), LoreUpstream.detail(e));
                    }
                }
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
            // MT-01: вердикт ПЕРЕСЧИТЫВАЕТСЯ после привязки. primary-актор входит
            // в знаменатель UcQuality, но привязывается отдельным вызовом уже
            // ПОСЛЕ uc_new — поэтому любой новый сценарий получал 9/10, каким бы
            // полным он ни был (воспроизведено пять раз подряд 2026-08-03).
            // Оценка врала вниз систематически, а к систематическому вранью
            // привыкают: 9/10 читалось как «норма для нового», и настоящая
            // девятка терялась в шуме.
            //
            // Пересчёт только для actor: остальные rel в знаменатель не входят,
            // и лишний запрос к графу на каждую привязку задачи или компонента
            // был бы платой ни за что.
            Map<String, Object> out = new java.util.LinkedHashMap<>(Map.of(
                "ok", true, "uc_id", req.uc_id(),
                "rel", req.rel(), "target_id", req.target_id(), "action", "added", "linked", linked,
                "hint", linked ? "" : "no edge created — проверьте, что uc_id и target существуют"));
            if ("actor".equals(req.rel()) && linked) out.put("quality", qualityOf(req.uc_id()));
            // MT-07: привязка задачи меняет картину готовности — пересчитываем.
            //
            // Вычислитель просыпался ТОЛЬКО из recomputeForTask при смене статуса
            // задачи. Значит порядок «сначала сделали, потом описали» — основной
            // при реконструкции продуктового слоя задним числом — оставлял
            // сценарий невыпущенным НАВСЕГДА: задача уже закрыта, статус её
            // больше не меняется, а привязка пересчёт не будила.
            //
            // Найдено экспериментом 2026-08-03: три сценария привязаны к закрытым
            // задачам, shipped стал только тот, у которого потом дёрнули
            // status_set. Отсюда же пустой shipped_job_ids у всех корней —
            // читалось как «ценность не доехала», означало «пересчёт не звали».
            //
            // Отвязка тоже считается: снятие последней задачи возвращает статус
            // к намерению автора, и промолчать об этом значит оставить сценарий
            // выпущенным без единой задачи.
            if ("task".equals(req.rel())) {
                try {
                    readiness.recompute(req.uc_id());
                } catch (RuntimeException e) {
                    // Пересчёт вспомогательный: его отказ не имеет права
                    // превратить успешную привязку в ошибку.
                    LOG.warnf("[LORE READINESS] %s: пересчёт после привязки не выполнен (%s)",
                        req.uc_id(), LoreUpstream.detail(e));
                }
            }
            return noStore(Response.ok(out));
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

    /**
     * Сколько у UC уже primary-акторов (D19: должен быть ровно один).
     *
     * <p><b>DBR-04: отказ БД больше не превращается в ноль.</b> Прежняя
     * редакция ловила любое исключение и возвращала 0 — то есть при недоступной
     * БД гейт D19 отвечал «primary ещё нет», и новый актор становился ВТОРЫМ
     * primary. Инвариант нарушался, ответ приходил 200, и обнаруживалось это
     * потом по двум primary у одного сценария.
     *
     * <p>Неизвестность — не ноль. Пробрасываем наверх, где вызывающий отдаст
     * 502: отказаться от записи честнее, чем записать не то.
     */
    private long countPrimaryActors(String ucId) {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT outE('HAS_ACTOR')[role='primary'].size() AS n FROM KnowUseCase WHERE uc_id=:id",
            Map.of("id", ucId));
        return rows.isEmpty() ? 0 : num(rows.get(0).get("n"));
    }

    /**
     * Две формы запроса (ADR-027-D3):
     * <ul>
     *   <li>{@code uc_id} — оценить СОХРАНЁННЫЙ UC (ревью, MCP);</li>
     *   <li>тело напрямую ({@code scenario_md}/{@code acceptance_md}/…) — живой
     *       линтер формы (PL-17): панель обязана пересчитываться ПО ХОДУ набора,
     *       до создания записи. Оценивать нечего было бы, требуй эндпоинт
     *       обязательный uc_id — форма создания US не смогла бы показать линтер
     *       ни разу, ровно поэтому его из фронта и не звали.</li>
     * </ul>
     * Флаги {@code has_primary_actor}/{@code has_traced_to} — рёбра, которых у
     * ещё не созданного UC нет; в форме они false и попадают в подсказки, не в
     * штраф (D9/D14 — advisory).
     */
    public record UcQualityRequest(String uc_id, String rigor, String goal_level,
                                   String scenario_md, String acceptance_md,
                                   Boolean has_primary_actor, Boolean has_traced_to) {}

    @POST
    @Path("uc/quality")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response ucQuality(UcQualityRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null) return badParams("body required");

        // Тело важнее id: если пришли поля сценария — судим их (живой линтер),
        // не подменяя оценку сохранённой версией под тем же id.
        if (req.scenario_md() != null || req.acceptance_md() != null) {
            UcQuality.Result res = UcQuality.evaluate(
                req.rigor(), req.goal_level(), req.scenario_md(), req.acceptance_md(),
                Boolean.TRUE.equals(req.has_primary_actor()),
                Boolean.TRUE.equals(req.has_traced_to()));
            List<Map<String, Object>> findings = new java.util.ArrayList<>();
            for (UcQuality.Finding fnd : res.findings())
                findings.add(Map.of("code", fnd.code(), "ok", fnd.ok(),
                    "required", fnd.required(), "message", fnd.message()));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("rigor", res.rigor());
            out.put("score", res.score());
            out.put("max", res.max());
            out.put("findings", findings);
            return noStore(Response.ok(out));
        }

        if (req.uc_id() == null || req.uc_id().isBlank())
            return badParams("uc_id or scenario_md/acceptance_md required");
        Map<String, Object> q = qualityOf(req.uc_id());
        if (q.containsKey("error") && "uc not found".equals(q.get("error")))
            return noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("NOT_FOUND", "UC " + req.uc_id() + " не найден")));
        return noStore(Response.ok(q));
    }

    /**
     * Порог «UC ниже плинтуса» для среза F. Настройка, не догма: 0.6 = «больше
     * половины ОБЯЗАТЕЛЬНЫХ для своего веса проверок закрыто, с запасом» —
     * стартовое значение до накопления статистики по живому корпусу.
     */
    @org.eclipse.microprofile.config.inject.ConfigProperty(
        name = "lore.uc.quality.threshold", defaultValue = "0.6")
    double qualityThreshold;

    /**
     * AN-08 (ADR-LORE-030 §2 срез F): распределение линтер-оценок по всему слою.
     * Зовёт ТОТ ЖЕ {@link UcQuality#evaluate} — правила не дублируются (027-D3).
     * Не слайс намеренно: линтер — Java-алгоритм, SQL его не повторит без второго
     * источника правды. Сравнение только НОРМИРОВАННОЕ (score/max своего веса):
     * знаменатель у casual меньше, чем у fully-dressed (027-D1), и по сырому score
     * casual-UC выглядели бы ложно «лучше». Гистограммы/динамику строит клиент
     * (date_created — ось когорт); оценки не хранятся — принцип ADR-030.
     */
    /**
     * Факты + вердикт по каждому UC слоя. Извлечён из {@code ucQualityAll} в
     * MT-10, чтобы прогон самопроверки судил ТЕМ ЖЕ методом, а не отдельной
     * копией запроса — иначе цифра на панели качества и цифра в самопроверке
     * рано или поздно разойдутся, и непонятно будет, какой верить.
     */
    private List<Map<String, Object>> computeUcQualityRows() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT uc_id, title, rigor, goal_level, date_created, scenario_md, acceptance_md, " +
            "outE('HAS_ACTOR')[role='primary'].size() AS primary_actors, " +
            "out('TRACED_TO').size() AS traced " +
            "FROM KnowUseCase ORDER BY uc_id", Map.of());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            UcQuality.Result res = UcQuality.evaluate(
                str(r.get("rigor")), str(r.get("goal_level")),
                str(r.get("scenario_md")), str(r.get("acceptance_md")),
                num(r.get("primary_actors")) > 0, num(r.get("traced")) > 0);
            double normalized = res.max() == 0 ? 1.0 : (double) res.score() / res.max();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("uc_id", r.get("uc_id"));
            row.put("title", r.get("title"));
            row.put("goal_level", r.get("goal_level"));
            row.put("rigor", res.rigor());
            row.put("score", res.score());
            row.put("max", res.max());
            row.put("normalized", Math.round(normalized * 1000.0) / 1000.0);
            row.put("below_threshold", normalized < qualityThreshold);
            row.put("date_created", r.get("date_created"));
            out.add(row);
        }
        return out;
    }

    @jakarta.ws.rs.GET
    @Path("uc/quality/all")
    @Produces(MediaType.APPLICATION_JSON)
    public Response ucQualityAll() {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> out = computeUcQualityRows();
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("threshold", qualityThreshold);
            body.put("note", "normalized = score/max ОБЯЗАТЕЛЬНЫХ проверок своего веса — "
                + "сырые score между casual и fully-dressed несравнимы (ADR-LORE-027 D1)");
            body.put("rows", out);
            return noStore(Response.ok(body));
        } catch (Exception e) {
            LOG.warnf("[LORE UC QUALITY ALL] %s", e.getMessage());
            return upstream(e);
        }
    }

    private Response upstream(Exception e) {
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
    }

    // ── MT-10: самопроверка корпуса ───────────────────────────────────────────
    //
    // Разбор метрик 02–03.08 показал, что каждый найденный дефект был дефектом
    // ИЗМЕРЕНИЯ, а не работы: механизм написан правильно, но либо никто его не
    // вызывает (fit-gaps и invest-coverage не встречались во фронте ни разу;
    // LoreFtIndexHealth.check() не был выставлен ни одним эндпоинтом), либо
    // сигнал прячет свой знаменатель или момент («85.6% с оценкой» без «из
    // скольких», totalIndexed при почти пустом индексе). Владелец сформулировала
    // прямо: сверок стало больше, чем можно отсмотреть глазами. Нужен не ещё
    // один экран, а прогон, который собирает то, что уже написано, и один раз
    // называет вердикт.
    //
    // Считается на бэкенде ОДНИМ эндпоинтом, а не девятью запросами с фронта:
    // половина сверок (WorkQuality, VpFitGaps, LoreFtIndexHealth) — package-
    // private Java без HTTP-выхода, и плодить под каждую отдельный контракт
    // значит закладывать девять разных способов сообщить об отказе вместо
    // одного.

    /** Сколько находок на проверку показываем в ответе — остальное считается, но не перечисляется. */
    private static final int SELF_CHECK_FINDINGS_CAP = 50;

    /** Факты одной проверки: found/denominator — числа, findings — witnesses (обрезаны капом). */
    private record CheckOutcome(int found, int denominator, List<Map<String, Object>> findings, boolean truncated) {}

    /** Одна находка: что, где искать глазами, куда вести по клику. */
    private static Map<String, Object> finding(Object refId, Object title, String detail, String section, Object passport) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ref_id", refId);
        m.put("title", title);
        m.put("detail", detail);
        m.put("section", section);
        m.put("passport", passport != null ? passport : refId);
        return m;
    }

    /** cloud/kite — корень (features), sea-level/subfunction — сценарий (userStories). */
    private static String goalLevelSection(String goalLevel) {
        return ("cloud".equals(goalLevel) || "kite".equals(goalLevel)) ? "features" : "userStories";
    }

    private long countOf(String sql) {
        List<Map<String, Object>> r = ingest.queryPublic(sql, Map.of());
        return r.isEmpty() ? 0 : num(r.get(0).get("n"));
    }

    /**
     * Выполняет одну проверку и переводит её исход в конверт самопроверки.
     *
     * <p>Отказ проверки (исключение) — ОТДЕЛЬНОЕ состояние {@code unavailable},
     * не {@code passed} с нулём находок. Это тот самый дефект, из-за которого
     * проверка темы в Keycloak-CD однажды обвинила успешный выкат: `2>/dev/null
     * || echo 0` подменял «не удалось посмотреть» на «посмотрел и там пусто».
     * Здесь эта подмена невозможна структурно — try/catch снаружи логики
     * проверки, а не внутри.
     */
    private Map<String, Object> runSelfCheck(String id, String title, Supplier<CheckOutcome> fn) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("title", title);
        try {
            CheckOutcome r = fn.get();
            out.put("state", r.found() == 0 ? "passed" : "failed");
            out.put("found", r.found());
            out.put("denominator", r.denominator());
            out.put("error", null);
            out.put("findings", r.findings());
            out.put("truncated", r.truncated());
        } catch (Exception e) {
            LOG.warnf("[LORE SELF-CHECK] %s: %s", id, e.getMessage());
            out.put("state", "unavailable");
            out.put("found", null);
            out.put("denominator", null);
            out.put("error", e.getMessage());
            out.put("findings", List.of());
            out.put("truncated", false);
        }
        return out;
    }

    private CheckOutcome checkWorkQualityTasks() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT task_uid, title, work_class, " +
            "out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw, " +
            "out('HAS_STATE')[effort_days IS NOT NULL].effort_days[0] AS effort_days, " +
            "out('TAGGED_WITH').component_id AS own_components, " +
            "out('PART_OF').out('BELONGS_TO').component_id AS sprint_components, " +
            "out('PART_OF').out('BELONGS_TO_PROJECT').slug AS projects, " +
            "out('REALIZES').uc_id AS realizes_uc, " +
            "out('JUSTIFIED_BY').adr_id AS justified_by, " +
            "out('PART_OF').sprint_id[0] AS sprint_id " +
            "FROM KnowTask", Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            Object comps = r.get("own_components");
            if (!(comps instanceof Collection<?> c) || c.isEmpty()) comps = r.get("sprint_components");
            Object eff = r.get("effort_days");
            Double effort = eff instanceof Number n ? n.doubleValue() : null;
            WorkQuality.Result res = WorkQuality.evaluateTask(
                str(r.get("status_raw")), effort, str(r.get("work_class")),
                comps, r.get("projects"), r.get("realizes_uc"), r.get("justified_by"));
            if (res.score() < res.max()) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    String detail = res.findings().stream()
                        .filter(fnd -> fnd.required() && !fnd.ok())
                        .map(WorkQuality.Finding::message)
                        .reduce((a, b) -> a + "; " + b).orElse("");
                    findings.add(finding(r.get("task_uid"), r.get("title"), detail, "sprints", r.get("sprint_id")));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, found > findings.size());
    }

    private CheckOutcome checkWorkQualityAdr() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT adr_id, name, status, " +
            "out('HAS_STATE').context_md[0] AS context_md, " +
            "out('HAS_STATE').decision_md[0] AS decision_md, " +
            "out('HAS_STATE').consequences_md[0] AS consequences_md, " +
            "out('BELONGS_TO').component_id AS components, " +
            "out('BELONGS_TO_PROJECT').slug AS projects, " +
            "in('DECIDED_IN').size() AS decision_count " +
            "FROM KnowADR", Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            WorkQuality.Result res = WorkQuality.evaluateAdr(
                str(r.get("status")), r.get("components"), r.get("projects"),
                num(r.get("decision_count")) > 0,
                str(r.get("context_md")), str(r.get("decision_md")), str(r.get("consequences_md")));
            if (res.score() < res.max()) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    String detail = res.findings().stream()
                        .filter(fnd -> fnd.required() && !fnd.ok())
                        .map(WorkQuality.Finding::message)
                        .reduce((a, b) -> a + "; " + b).orElse("");
                    findings.add(finding(r.get("adr_id"), r.get("name"), detail, "adrs", r.get("adr_id")));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, found > findings.size());
    }

    private CheckOutcome checkUcQuality() {
        List<Map<String, Object>> rows = computeUcQualityRows();
        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            if (Boolean.TRUE.equals(r.get("below_threshold"))) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    double normalized = ((Number) r.get("normalized")).doubleValue();
                    String detail = String.format(java.util.Locale.ROOT,
                        "оценка %.2f ниже порога %.2f", normalized, qualityThreshold);
                    findings.add(finding(r.get("uc_id"), r.get("title"), detail,
                        goalLevelSection(str(r.get("goal_level"))), r.get("uc_id")));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, found > findings.size());
    }

    private CheckOutcome checkFitGaps() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("feature_vp_analytics").baseSql(), Map.of());
        Map<String, String> gainRanks = dictOf("SELECT gain_id AS k, rank AS v FROM KnowGain");
        Map<String, String> painSeverities = dictOf("SELECT pain_id AS k, severity AS v FROM KnowPain");
        List<VpFitGaps.Gap> gaps = VpFitGaps.evaluate(rows, gainRanks, painSeverities);

        List<Map<String, Object>> findings = new ArrayList<>();
        int cap = Math.min(gaps.size(), SELF_CHECK_FINDINGS_CAP);
        for (int i = 0; i < cap; i++) {
            VpFitGaps.Gap g = gaps.get(i);
            String detail = g.finding() + " — не закрыто: " + g.missingId() + " (вес " + g.weight() + ")";
            findings.add(finding(g.refId(), g.title(), detail, "features", g.refId()));
        }
        return new CheckOutcome(gaps.size(), rows.size(), findings, gaps.size() > cap);
    }

    /**
     * Доля неклассифицированных задач по work_class (INVEST-профиль). Числа
     * агрегированные — VpFitGaps.coverage() не отдаёт построчных ссылок, поэтому
     * findings пуст: found/denominator сами по себе полный ответ на вопрос
     * «сколько и из скольких», а не список для клика.
     */
    private CheckOutcome checkInvestCoverage() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("invest_profile").baseSql(), Map.of());
        VpFitGaps.InvestCoverage cov = VpFitGaps.coverage(rows);
        int unclassified = cov.tasksTotal() - cov.tasksClassified();
        return new CheckOutcome(unclassified, cov.tasksTotal(), List.of(), false);
    }

    private CheckOutcome checkProductHygiene() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("product_hygiene").baseSql(), Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int cap = Math.min(rows.size(), SELF_CHECK_FINDINGS_CAP);
        for (int i = 0; i < cap; i++) {
            Map<String, Object> r = rows.get(i);
            String entityType = str(r.get("entity_type"));
            String section = switch (entityType) {
                case "task" -> "sprints";
                case "uc" -> "userStories";
                case "pain" -> "vpProfile";
                default -> "sprints";
            };
            Object passport = "task".equals(entityType) ? r.get("sprint_id") : r.get("ref_id");
            findings.add(finding(r.get("ref_id"), r.get("title"), str(r.get("finding")), section, passport));
        }
        // Знаменатель — население, на котором слайс вообще ищет находки (задачи,
        // сценарии US, боли), а НЕ весь корпус: иначе доля выглядела бы заниженной
        // сравнением с сущностями, которых эта проверка никогда не коснётся.
        long denominator = countOf("SELECT count(*) AS n FROM KnowTask")
            + countOf("SELECT count(*) AS n FROM KnowUseCase WHERE goal_level IN ['sea-level','subfunction']")
            + countOf("SELECT count(*) AS n FROM KnowPain");
        return new CheckOutcome(rows.size(), (int) denominator, findings, rows.size() > cap);
    }

    private CheckOutcome checkStrategicCoverage() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("strategic_coverage").baseSql(), Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int cap = Math.min(rows.size(), SELF_CHECK_FINDINGS_CAP);
        for (int i = 0; i < cap; i++) {
            Map<String, Object> r = rows.get(i);
            String section = "uc".equals(str(r.get("entity_type"))) ? "features" : "milestones";
            findings.add(finding(r.get("ref_id"), r.get("title"), str(r.get("finding")), section, r.get("ref_id")));
        }
        long denominator = countOf("SELECT count(*) AS n FROM KnowUseCase WHERE goal_level IN ['cloud','kite']")
            + countOf("SELECT count(*) AS n FROM KnowMilestone");
        return new CheckOutcome(rows.size(), (int) denominator, findings, rows.size() > cap);
    }

    /**
     * Роли без единого сценария. Не через слайс {@code actor_load} (он требует
     * project и меряет по одному проекту за раз) — самопроверка смотрит на весь
     * корпус, поэтому считает {@code HAS_ACTOR} напрямую по всем акторам.
     */
    private CheckOutcome checkActorLoadDead() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            "SELECT actor_id, name, kind, in('HAS_ACTOR').size() AS uc_count FROM KnowActor", Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            if (num(r.get("uc_count")) == 0) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    findings.add(finding(r.get("actor_id"), r.get("name"),
                        "роль без единого сценария", "actors", r.get("actor_id")));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, false);
    }

    /**
     * {@link LoreFtIndexHealth#check()} возвращает ТОЛЬКО непригодные индексы —
     * пустой список значит «все здоровы». Знаменатель поэтому берётся из
     * реестра {@link LoreSchemaMigrations#FT_INDEXES}, а не из размера ответа:
     * «0 находок из 0» неотличимо от «не проверяли», а реестр даёт настоящее
     * число проверенных веток поиска.
     */
    private CheckOutcome checkFtIndexHealth() {
        List<LoreFtIndexHealth.Finding> bad = ftIndexHealth.check();
        List<Map<String, Object>> findings = new ArrayList<>();
        int cap = Math.min(bad.size(), SELF_CHECK_FINDINGS_CAP);
        for (int i = 0; i < cap; i++) {
            LoreFtIndexHealth.Finding f = bad.get(i);
            findings.add(finding(f.index(), f.type(), f.detail(), null, null));
        }
        return new CheckOutcome(bad.size(), LoreSchemaMigrations.FT_INDEXES.size(), findings, bad.size() > cap);
    }

    private static Set<String> toStringSet(Object v) {
        if (!(v instanceof Collection<?> c)) return Set.of();
        Set<String> out = new LinkedHashSet<>();
        for (Object o : c) if (o != null) out.add(o.toString());
        return out;
    }

    /**
     * MT-11/D-VP-ROLE-AGENT-PAIR (редакция 3): пара «агент — её роль»
     * сходится, когда множества {@code PERFORMED_BY} у обоих совпадают.
     * Расхождение — находка с разностью в ОБЕ стороны (чего не хватает
     * агенту / что у агента лишнее), не булев вердикт: «не сходится»
     * неотличимо от «не сходится» без списка того, чего не хватает —
     * чинить нечего.
     *
     * <p>Актор БЕЗ ребра {@code FILLS_ROLE} вовсе не входит в
     * {@code actor_pairs} — третье состояние («двойником не является») сюда
     * не попадает и {@code found} не увеличивает: {@code ACT-LORE-AGENT-SESSION}
     * намеренно без пары, это утверждение, а не пробел. Денаминатор — число
     * СУЩЕСТВУЮЩИХ пар, а не число агентов: непарный актор — не то же самое,
     * что непроверенная пара.
     */
    private CheckOutcome checkActorPairs() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("actor_pairs").baseSql(), Map.of());

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            Set<String> jobsRole = toStringSet(r.get("jobs_role"));
            Set<String> jobsAgent = toStringSet(r.get("jobs_agent"));
            Set<String> missingInAgent = new LinkedHashSet<>(jobsRole);
            missingInAgent.removeAll(jobsAgent);
            Set<String> missingInRole = new LinkedHashSet<>(jobsAgent);
            missingInRole.removeAll(jobsRole);
            if (!missingInAgent.isEmpty() || !missingInRole.isEmpty()) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    int matched = jobsRole.size() - missingInAgent.size();
                    StringBuilder detail = new StringBuilder()
                        .append("у агента ").append(matched).append(" из ").append(jobsRole.size())
                        .append(" работ роли");
                    if (!missingInAgent.isEmpty())
                        detail.append("; не хватает агенту: ").append(String.join(", ", missingInAgent));
                    if (!missingInRole.isEmpty())
                        detail.append("; лишнее у агента: ").append(String.join(", ", missingInRole));
                    findings.add(finding(r.get("agent_id"), r.get("agent_name"), detail.toString(),
                        "actors", r.get("agent_id")));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, found > findings.size());
    }

    /**
     * MT-09 / ADR-LORE-028 D19 (проверка качества №7): у сценария обязан быть
     * РОВНО ОДИН primary-актор — ни ноль, ни несколько. Заявлено в ADR, но
     * нигде не считалось: {@code actor_load} отдаёт primary_count по АКТОРУ
     * (сколько сценариев он ведёт), а не по СЦЕНАРИЮ (сколько у него ведущих).
     *
     * <p>Обнаружено на практике: девять вызовов {@code uc_link} с параметром
     * {@code role} вместо {@code actor_role} прошли с {@code ok:true}, роль
     * отброшена как незнакомый параметр, и два сценария остались вовсе без
     * primary — тот же заход (MT-09) закрыл и приём незнакомых параметров на
     * входе MCP-инструментов (strict-схемы в mcp-server), так что впредь
     * такое не пройдёт молча. Эта проверка — вторая линия: ловит то, что уже
     * накопилось до фикса, и то, что могло прийти любым другим путём.
     */
    private CheckOutcome checkUcSinglePrimary() {
        List<Map<String, Object>> ucRows = ingest.queryPublic(
            "SELECT uc_id, title, goal_level FROM KnowUseCase", Map.of());
        List<Map<String, Object>> actorRows = ingest.queryPublic(
            LoreSlices.get("uc_actors").baseSql(), Map.of());

        Map<String, Integer> primariesByUc = new HashMap<>();
        for (Map<String, Object> r : actorRows) {
            if (!"primary".equals(str(r.get("role")))) continue;
            String ucId = str(r.get("uc_id"));
            primariesByUc.merge(ucId, 1, Integer::sum);
        }

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> uc : ucRows) {
            String ucId = str(uc.get("uc_id"));
            int primaries = primariesByUc.getOrDefault(ucId, 0);
            if (primaries != 1) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    String detail = primaries == 0
                        ? "нет primary-актора"
                        : primaries + " primary-акторов вместо одного";
                    findings.add(finding(ucId, uc.get("title"), detail,
                        goalLevelSection(str(uc.get("goal_level"))), ucId));
                }
            }
        }
        return new CheckOutcome(found, ucRows.size(), findings, found > findings.size());
    }

    /**
     * AL-116 (найдено miniLORE 2026-08-11, живым сравнением {@code is_current}
     * против максимальной версии по проекту): у {@code KnowRelease} обязан
     * быть ровно один {@code is_current} на {@code git_project} — инвариант
     * нигде не проверялся. На практике разошёлся дважды: {@code NooriUta/AIDA}
     * застрял на v1.3.0 (24 апреля) при максимуме v1.7.2 (10 июля, между ними
     * ещё сто релизов), {@code NooriUta/seidr-site} нёс current СРАЗУ на двух
     * версиях — проект задваивался у потребителей, фильтрующих по
     * {@code is_current}. Оба исправлены вручную ({@code release_set}) тем же
     * заходом; эта проверка — чтобы расхождение не накопилось молча снова.
     *
     * <p>{@code found} считает и «больше одного», и «ни одного» — оба
     * состояния одинаково неверны для проекта, у которого релизы вообще
     * есть. Проект без единого релиза в выборку не попадает (нечего
     * проверять). Денаминатор — число проектов С РЕЛИЗАМИ, не число
     * зарегистрированных {@code KnowGitProject}.
     */
    private CheckOutcome checkReleaseSingleCurrent() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("releases").baseSql(), Map.of());

        Map<String, Integer> totalByProject = new HashMap<>();
        Map<String, Integer> currentByProject = new HashMap<>();
        for (Map<String, Object> r : rows) {
            String proj = str(r.get("git_project"));
            if (proj == null || proj.isBlank()) continue;
            totalByProject.merge(proj, 1, Integer::sum);
            if (Boolean.TRUE.equals(r.get("is_current"))) currentByProject.merge(proj, 1, Integer::sum);
        }

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (String proj : totalByProject.keySet()) {
            int cur = currentByProject.getOrDefault(proj, 0);
            if (cur != 1) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    String detail = cur == 0 ? "нет текущего релиза" : cur + " текущих релиза вместо одного";
                    findings.add(finding(proj, proj, detail, null, null));
                }
            }
        }
        return new CheckOutcome(found, totalByProject.size(), findings, found > findings.size());
    }

    /**
     * AL-118 (найдено miniLORE 2026-08-11): {@code SPRINT_AUTH_CUTOVER} несёт
     * {@code done_date = 2026-12-07} в срезе {@code sprint_done_dates} —
     * ровно значение его же {@code planned_end_date}. Похоже, при простановке
     * статуса DONE в историческую строку записали плановую дату вместо
     * реальной даты перехода; сам спринт связан с релизом v1.6.19 (реальная
     * дата — конец июня). {@code sprint_done_dates} и так читает из истории,
     * а не с вершины (не класс MT-06/MT-12) — здесь неверна САМА историческая
     * запись, точечно чинить руками не стал (нет безопасного MCP-инструмента
     * для правки {@code valid_from} задним числом, только новый статус-переход).
     *
     * <p>Проверка ловит будущую дату у ЛЮБОГО спринта — не только этот
     * случай, чтобы не завести проверку под одну находку.
     */
    private CheckOutcome checkSprintDoneDateFuture() {
        List<Map<String, Object>> rows = ingest.queryPublic(
            LoreSlices.get("sprint_done_dates").baseSql(), Map.of());
        String today = LocalDate.now().toString();

        List<Map<String, Object>> findings = new ArrayList<>();
        int found = 0;
        for (Map<String, Object> r : rows) {
            String doneDate = str(r.get("done_date"));
            if (doneDate == null || doneDate.length() < 10) continue;
            String datePart = doneDate.substring(0, 10);
            if (datePart.compareTo(today) > 0) {
                found++;
                if (findings.size() < SELF_CHECK_FINDINGS_CAP) {
                    String sprintId = str(r.get("sprint_id"));
                    findings.add(finding(sprintId, sprintId,
                        "дата закрытия " + datePart + " — в будущем", "sprints", sprintId));
                }
            }
        }
        return new CheckOutcome(found, rows.size(), findings, found > findings.size());
    }

    @GET
    @Path("product/self-check")
    @Produces(MediaType.APPLICATION_JSON)
    public Response selfCheck() {
        if (!enabled) return disabled();
        List<Map<String, Object>> checks = new ArrayList<>();
        checks.add(runSelfCheck("work_quality_tasks", "Полнота задач (статус · компонент · оценка · класс работы)", this::checkWorkQualityTasks));
        checks.add(runSelfCheck("work_quality_adr", "Полнота ADR (контекст · решение · связи)", this::checkWorkQualityAdr));
        checks.add(runSelfCheck("uc_quality", "Сценарии ниже порога качества", this::checkUcQuality));
        checks.add(runSelfCheck("fit_gaps", "Заявлено, но не доставлено (VP fit)", this::checkFitGaps));
        checks.add(runSelfCheck("invest_coverage", "Задачи без класса работы (INVEST)", this::checkInvestCoverage));
        checks.add(runSelfCheck("product_hygiene", "Гигиена продуктового слоя", this::checkProductHygiene));
        checks.add(runSelfCheck("strategic_coverage", "Стратегическое покрытие (фичи ↔ вехи)", this::checkStrategicCoverage));
        checks.add(runSelfCheck("actor_load_dead", "Роли без сценариев", this::checkActorLoadDead));
        checks.add(runSelfCheck("ft_index_health", "Пригодность полнотекстовых индексов", this::checkFtIndexHealth));
        checks.add(runSelfCheck("uc_single_primary", "Сценарии без ровно одного primary-актора", this::checkUcSinglePrimary));
        checks.add(runSelfCheck("actor_pairs", "Пары «роль — агент»: расхождение работ", this::checkActorPairs));
        checks.add(runSelfCheck("release_single_current", "Проекты без ровно одного текущего релиза", this::checkReleaseSingleCurrent));
        checks.add(runSelfCheck("sprint_done_date_future", "Спринты с датой закрытия в будущем", this::checkSprintDoneDateFuture));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("run_at", Instant.now().toString());
        body.put("checks", checks);
        return noStore(Response.ok(body));
    }
}
