package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;
import studio.seer.heimdall.bench.MartClient;
import studio.seer.heimdall.bench.MartQuery;
import jakarta.ws.rs.BeanParam;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Read-only viewer API over the system_aida_lore engineering knowledge base.
 *
 * GET /lore/slices          → available named slices with their params
 * GET /lore/slice/{id}      → {"rows": [...]} for a named slice (+query params)
 *
 * Disabled by default (lore.enabled=false) → 404 LORE_DISABLED.
 * Pattern: BenchMartResource.
 */
@Path("/lore")
public class AidaLoreResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(AidaLoreResource.class);

    public record SliceInfo(String id, List<String> required, List<String> optional) {}

    /** AL-94: применять ли проектный read-скоуп. По умолчанию ВЫКЛЮЧЕН — см. allowedProjectsOrNull. */
    @ConfigProperty(name = "lore.scope.enforce", defaultValue = "false")
    boolean scopeEnforce;

    /**
     * AL-91: служебные читатели ВСЕГО корпуса — client_id через запятую, точным
     * совпадением. Решение 06.11 (владелица отдала выбор шлюзу miniLORE, тот
     * выбрал «служебный читатель всего»): видимость miniLORE не держится на
     * владельце-человеке. Действует ТОЛЬКО на чтение (callerAllowedProjects);
     * право записи не расширяет. Расширять список — отдельным решением.
     */
    @ConfigProperty(name = "lore.scope.read-all-clients", defaultValue = "lore-reader-minilore")
    String readAllClients;

    /** AL-91: клиент в списке служебных читателей всего корпуса — точным совпадением, не префиксом. */
    static boolean readsWholeCorpus(String clientId, String list) {
        if (clientId == null || clientId.isBlank() || list == null) return false;
        for (String c : list.split(",")) if (c.trim().equals(clientId)) return true;
        return false;
    }

    /**
     * Обнулять ли ТЕЛО документа читателю без роли в его проекте.
     *
     * <p>Решение владелицы 19.10.2026: «достаточно обнулять текст самого
     * документа при выдаче по MCP или же в web». Отдельный флаг, а НЕ часть
     * {@code lore.scope.enforce}, намеренно: это две разные меры с разной
     * ценой, и включать их должно быть можно по одной.
     *
     * <p>Построчный скоуп прячет запись целиком и потому отрезает всё, у чего
     * нет ребра на проект — 499 записей по замеру 19.10.2026. Обнуление тела
     * не прячет ни одной строки и работает ровно там, где проект известен.
     * Значит обнуление можно включить раньше и безопаснее, чем построчный
     * скоуп, — и ради этого флаг свой.
     */
    @ConfigProperty(name = "lore.scope.redact-bodies", defaultValue = "false")
    boolean redactBodies;

    @Inject
    ProjectRbacService projectRbac;

    // ── SPRINT_VIZ_EMBED/VE-2: подпись ссылки встройки Völva ─────────────────
    // Ключ — через SecretProvider (env | Infisical), как KC_ADMIN_CLIENT_SECRET;
    // в код и в переменные сборки не попадает. Адрес и белый список графиков —
    // Optional: пустая строка в @ConfigProperty String роняет старт приложения.
    static final String VOLVA_EMBED_SECRET_KEY = "LORE_VOLVA_EMBED_SECRET";

    @Inject
    SecretProvider secrets;

    @ConfigProperty(name = "lore.volva.embed.site-url")
    java.util.Optional<String> volvaSiteUrl;

    @ConfigProperty(name = "lore.volva.embed.charts")
    java.util.Optional<String> volvaCharts;

    @ConfigProperty(name = "lore.volva.embed.ttl-seconds", defaultValue = "600")
    long volvaTtlSeconds;

    /**
     * Подписанный адрес встройки графика Völva для ПОЛЬЗОВАТЕЛЯ: проект берётся
     * из запроса, но выдаётся только в пределах проектов вызывающего; служебный
     * клиент отказ. Адрес (в нём JWT) не логируется. Срок жизни — ttl-seconds.
     */
    @GET
    @Path("embed/volva/{chart}")
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response volvaEmbed(@PathParam("chart") String chart, @QueryParam("project") String project,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        java.util.Optional<String> secret = secrets.get(VOLVA_EMBED_SECRET_KEY);
        boolean configured = secret.isPresent() && !secret.get().isBlank()
            && volvaSiteUrl.isPresent() && !volvaSiteUrl.get().isBlank();
        boolean agent = callerClientId() != null;
        java.util.Set<String> allowed = agent ? null : callerAllowedProjects(role);
        VolvaEmbedSigner.ChartDecision d = VolvaEmbedSigner.decideChart(chart, project,
            VolvaEmbedSigner.parseCharts(volvaCharts.orElse("")), configured, agent, allowed);
        if (!d.ok()) {
            Response.Status st = switch (d.code()) {
                case "not_configured" -> Response.Status.SERVICE_UNAVAILABLE;
                case "unknown_chart" -> Response.Status.NOT_FOUND;
                case "project_required" -> Response.Status.BAD_REQUEST;
                case "unlocked_needs_full_scope" -> Response.Status.FORBIDDEN;
                default -> Response.Status.FORBIDDEN;
            };
            return noStore(Response.status(st).entity(new LoreError(d.code().toUpperCase(java.util.Locale.ROOT), d.message())));
        }
        long exp = java.time.Instant.now().getEpochSecond() + volvaTtlSeconds;
        String jwt = VolvaEmbedSigner.jwtHs256(VolvaEmbedSigner.payload(d.chart(), project, exp), secret.get());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("chart", chart);
        out.put("project", d.chart().locked() ? project : null);
        out.put("locked", d.chart().locked());
        out.put("url", VolvaEmbedSigner.embedUrl(volvaSiteUrl.get(), d.chart(), jwt));
        out.put("expires_at", java.time.Instant.ofEpochSecond(exp).toString());
        LOG.debugf("[LORE EMBED] chart=%s project=%s exp=%d", chart, project, exp); // без адреса: в нём JWT
        return noStore(Response.ok(out));
    }

    // SAFE_ID, ENTITY_TYPES/PLAN_STATUSES/ADR_STATUSES/SCD2_STATUS_RAW, the
    // ArcadeDB clients, config, and shared helpers all live in LoreResourceBase
    // now (B2 God-class split) — every write-path domain (release/adr/spec/
    // sprint/task/qg/status/...) has its own resource class; this one is left
    // holding the read-only slice API + the admin ingest endpoint.

    @GET
    @Path("slices")
    @Produces(MediaType.APPLICATION_JSON)
    public Response slices() {
        if (!enabled) return disabled();
        List<SliceInfo> infos = LoreSlices.ids().stream()
            .map(id -> {
                LoreSlices.SliceDef def = LoreSlices.get(id);
                return new SliceInfo(id, def.required(), List.copyOf(def.optionalFilters().keySet()));
            })
            .toList();
        return noStore(Response.ok(Map.of("slices", infos)));
    }

    public record EnvInfo(String db) {}

    // FIT-05: который бэкенд отвечает — единственный источник правды о том,
    // тестовая база или прод. Локальный дев-фронт и MCP исторически смотрели
    // в РАЗНЫЕ базы одновременно (см. LoreArcadeDbTestResource, lore.db
    // переопределяется на lore_ci_test под CI/тестами) — «данные пропали» и
    // «данные есть» оба оказывались правдой каждый про свою базу. Признак
    // берётся из САМОГО сервера, не из сборки фронта: подделать конфигом
    // клиента нельзя.
    @GET
    @Path("env")
    @Produces(MediaType.APPLICATION_JSON)
    public Response env() {
        if (!enabled) return disabled();
        return noStore(Response.ok(new EnvInfo(db)));
    }

    // ── Analytics: pre-aggregated dashboard data ─────────────────────────────
    // Computed in Java from a handful of light queries (KnowTaskHist current rows
    // instead of per-task HAS_STATE traversal — fast). Tasks are mapped to sprints
    // by task_uid prefix; sprints to components by the explicit BELONGS_TO edge.

    /**
     * AL-117 (найдено miniLORE 2026-08-11): status_raw — свободный текст после
     * значка ("✅ MERGED", "✅ СПРИНТ ЗАКРЫТ — НА РЕВИЗИИ", "✅ ALL PHASES DONE —
     * Phase 7…"), и классификатор по словам-подстрокам систематически теряет
     * формулировки, для которых не был написан. Их собственный парсер на этом
     * потерял 27 закрытых спринтов, пока не переключился на значок — эта
     * функция несла тот же дефект (ни "MERGED", ни "ЗАКРЫТ" в списке слов не
     * было).
     *
     * <p>Значок — приоритетный сигнал, тот же порядок и набор, что уже
     * проверенный {@code taskTick()} во фронтенде ({@code lore-status.ts},
     * покрыт тестами). Слова остаются вторым уровнем — легаси-строки без
     * значка встречаются.
     *
     * <p>SPRINT_QG_REBUILD/QG-13: и значки, и слова переехали в
     * {@link LoreStatusVocabulary} — единственное место, откуда их берут все
     * три потребителя (эта функция, SQL-слайсы и фронт). До того словарь был
     * записан трижды и трижды по-разному, и расхождение стоило одного спринта
     * без даты закрытия и семи задач, числившихся открытыми.
     */
    // Package-private (not private) so AidaLoreResourceTest can call it directly —
    // same convention as WorkQuality's pure-function methods.
    static String classifyStatus(String s) {
        // SPRINT_QG_REBUILD/QG-13: the vocabulary now lives in exactly one
        // place. See LoreStatusVocabulary for why (three copies of "closed"
        // drifted silently) and for the measurement behind anchored matching.
        return LoreStatusVocabulary.classify(s);
    }

    @SuppressWarnings("unchecked")
    private static String firstStr(Object v) {
        if (v == null) return null;
        if (v instanceof List<?> l) return l.isEmpty() ? null : String.valueOf(l.get(0));
        return String.valueOf(v);
    }

    /** First non-null element of a list-valued slice field (e.g. projects[]),
     *  or null. Unlike firstStr it skips a leading null instead of stringifying
     *  it to "null" — a traversal like out(...).slug can yield [null]. */
    private static String firstOfList(Object v) {
        if (v instanceof List<?> l) {
            for (Object o : l) if (o != null) return String.valueOf(o);
            return null;
        }
        return v == null ? null : String.valueOf(v);
    }

    @GET
    @Path("analytics")
    @Produces(MediaType.APPLICATION_JSON)
    public Response analytics(@HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        try {
            List<Map<String, Object>> comps = ingestService.queryPublic(
                "SELECT component_id, full_name, area FROM LoreComponent", Map.of());
            List<Map<String, Object>> links = ingestService.queryPublic(
                "SELECT @out.sprint_id AS s, @in.component_id AS c FROM BELONGS_TO WHERE @out.sprint_id IS NOT NULL", Map.of());
            List<Map<String, Object>> sprints = ingestService.queryPublic(
                "SELECT sprint_id, out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw FROM KnowSprint", Map.of());
            List<Map<String, Object>> taskRows = ingestService.queryPublic(
                "SELECT in('HAS_STATE').task_uid AS tuid, status_raw, effort_days FROM KnowTaskHist WHERE valid_to IS NULL", Map.of());
            List<Map<String, Object>> releases = ingestService.queryPublic(
                "SELECT git_tag, git_project, is_current FROM KnowRelease", Map.of());

            // ── Tasks: dedupe by task_uid (SCD2 may leave >1 open row), classify ──
            Map<String, String> taskStatus = new LinkedHashMap<>();
            Map<String, Double> taskEffortMap = new LinkedHashMap<>(); // task_uid -> effort_days
            for (Map<String, Object> r : taskRows) {
                String tuid = firstStr(r.get("tuid"));
                if (tuid == null) continue;
                String cls = classifyStatus((String) r.get("status_raw"));
                // prefer a "done" classification on collision
                String prev = taskStatus.get(tuid);
                if (prev == null || (!"done".equals(prev) && "done".equals(cls))) taskStatus.put(tuid, cls);
                // collect effort_days (first non-null wins)
                if (!taskEffortMap.containsKey(tuid)) {
                    Object ed = r.get("effort_days");
                    if (ed instanceof Number n) taskEffortMap.put(tuid, n.doubleValue());
                }
            }
            Map<String, Integer> tasksByStatus = new LinkedHashMap<>();
            Map<String, int[]> perSprint = new LinkedHashMap<>(); // sprint_id -> [total, done]
            Map<String, double[]> perSprintEffort = new LinkedHashMap<>(); // sprint_id -> [effort_sum]
            for (Map.Entry<String, String> e : taskStatus.entrySet()) {
                String tuid = e.getKey(), cls = e.getValue();
                tasksByStatus.merge(cls, 1, Integer::sum);
                int slash = tuid.indexOf('/');
                if (slash < 0) slash = tuid.indexOf(':');
                String sid = slash > 0 ? tuid.substring(0, slash) : tuid;
                int[] td = perSprint.computeIfAbsent(sid, k -> new int[2]);
                td[0]++;
                if ("done".equals(cls)) td[1]++;
                Double ef = taskEffortMap.get(tuid);
                if (ef != null) perSprintEffort.computeIfAbsent(sid, k -> new double[1])[0] += ef;
            }

            // ── Sprints by status ──
            Map<String, Integer> sprintsByStatus = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintsByStatus.merge(classifyStatus((String) sp.get("status_raw")), 1, Integer::sum);

            // ── Per-component rollup over explicitly linked sprints ──
            Map<String, List<String>> compSprints = new LinkedHashMap<>();
            for (Map<String, Object> lnk : links) {
                String s = (String) lnk.get("s"), c = (String) lnk.get("c");
                if (s == null || c == null) continue;
                compSprints.computeIfAbsent(c, k -> new ArrayList<>()).add(s);
            }
            Map<String, Map<String, Object>> compMeta = new LinkedHashMap<>();
            for (Map<String, Object> c : comps)
                compMeta.put((String) c.get("component_id"), c);

            List<Map<String, Object>> byComponent = new ArrayList<>();
            for (Map.Entry<String, List<String>> e : compSprints.entrySet()) {
                String cid = e.getKey();
                int total = 0, done = 0;
                for (String sid : e.getValue()) {
                    int[] td = perSprint.get(sid);
                    if (td != null) { total += td[0]; done += td[1]; }
                }
                Map<String, Object> meta = compMeta.getOrDefault(cid, Map.of());
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("component_id", cid);
                row.put("full_name", meta.get("full_name"));
                row.put("area", meta.get("area"));
                row.put("sprint_count", e.getValue().size());
                row.put("task_total", total);
                row.put("task_done", done);
                byComponent.add(row);
            }
            byComponent.sort((a, b) -> ((Integer) b.get("sprint_count")) - ((Integer) a.get("sprint_count")));

            // ── Per-sprint rows (only sprints that have tasks) ──
            Map<String, String> sprintStatusMap = new LinkedHashMap<>();
            for (Map<String, Object> sp : sprints)
                sprintStatusMap.put((String) sp.get("sprint_id"), (String) sp.get("status_raw"));
            List<Map<String, Object>> bySprint = new ArrayList<>();
            for (Map.Entry<String, int[]> e : perSprint.entrySet()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("sprint_id", e.getKey());
                row.put("status_raw", sprintStatusMap.get(e.getKey()));
                row.put("task_total", e.getValue()[0]);
                row.put("task_done", e.getValue()[1]);
                double[] ef = perSprintEffort.get(e.getKey());
                if (ef != null) row.put("effort_days_sum", Math.round(ef[0] * 10.0) / 10.0);
                bySprint.add(row);
            }
            bySprint.sort((a, b) -> ((Integer) b.get("task_total")) - ((Integer) a.get("task_total")));

            // ── Releases by project ──
            Map<String, Integer> relByProject = new LinkedHashMap<>();
            List<String> currentTags = new ArrayList<>();
            for (Map<String, Object> r : releases) {
                String p = (String) r.get("git_project");
                relByProject.merge(p == null ? "—" : p, 1, Integer::sum);
                if (Boolean.TRUE.equals(r.get("is_current"))) currentTags.add((String) r.get("git_tag"));
            }

            int taskTotal = taskStatus.size();
            int taskDone = tasksByStatus.getOrDefault("done", 0);
            Map<String, Object> totals = new LinkedHashMap<>();
            totals.put("sprints", sprints.size());
            totals.put("tasks", taskTotal);
            totals.put("tasks_done", taskDone);
            totals.put("releases", releases.size());
            totals.put("components", comps.size());

            Map<String, Object> out = new LinkedHashMap<>();
            out.put("totals", totals);
            out.put("tasks_by_status", tasksByStatus);
            out.put("sprints_by_status", sprintsByStatus);
            out.put("by_component", byComponent);
            out.put("by_sprint", bySprint);
            out.put("releases_by_project", relByProject);
            out.put("current_releases", currentTags);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE ANALYTICS] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    // ── News feed: what changed lately, across everything ────────────────────
    // AL-113: Java-порт getNews() из miniLORE gateway (gateway/src/lore.ts) —
    // единый GET /lore/news поверх существующих срезов, чтобы LORE-веб-UI не
    // повторял разъезд по десятку слайсов, а miniLORE получил спеки (с датой) и
    // правки ADR батчем (см. новые timeline_specs / adr_history_all).
    //
    // Возвращает Response (не Uni) → RESTEasy Reactive исполняет на worker-нити,
    // блокирующий queryPublic безопасен (тот же приём, что analytics выше).
    // Отдельные задачи не перечисляются, а считаются: task_done_dates несёт id
    // без заголовков, и 2760 строк «AI-01 done» были бы шумом там, где новость —
    // «14 задач закрыто». task_id — код в пределах спринта, не ключ (одна «T-01»
    // у десятков задач): заголовок берём только когда код в корпусе ровно один.
    private static final Pattern NEWS_DAY = Pattern.compile("^(\\d{4}-\\d{2}-\\d{2})");
    // Время серверное, где есть: часть срезов несёт «YYYY-MM-DD HH:MM:SS»
    // (valid_from спринтов/спек/задач), часть — только день (релизы/ADR/решения).
    // Где времени нет — НЕ подставляем полночь (было бы время, которого никто не
    // присылал), поле просто отсутствует.
    private static final Pattern NEWS_TIME = Pattern.compile("\\d{4}-\\d{2}-\\d{2}[ T](\\d{2}:\\d{2})");

    @GET
    @Path("news")
    @Produces(MediaType.APPLICATION_JSON)
    public Response news(@QueryParam("limit") Integer limitParam,
                         @QueryParam("since") String since,
                         @QueryParam("before") String before,
                         @QueryParam("days") Integer daysParam,
                         @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        // AL-SCOPE-HOLES: лента собирала события всех проектов мимо скоупа.
        java.util.Set<String> newsScope = allowedProjectsOrNull(role);
        if (newsScope != null && newsScope.isEmpty()) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("SCOPE_EMPTY", "проектный скоуп: у вызывающего нет ни одного разрешённого "
                    + "проекта — лента не отдаётся пустой")));
        }
        int limit = (limitParam == null || limitParam <= 0) ? 60 : limitParam;
        // ОКНО ПО ВРЕМЕНИ важнее счётчика (решение владельца: «выводи всё за неделю
        // как минимум»). Лента, обрезанная по числу строк, в активный день теряет
        // вчерашнее: 120 записей могут уместиться в полдня. Поэтому limit применяется
        // ТОЛЬКО к тому, что старше окна days (по умолчанию 7 дней): всё, что попало
        // в окно, отдаётся целиком, сколько бы его ни было.
        int days = (daysParam == null || daysParam <= 0) ? 7 : daysParam;
        try {
            List<Map<String, Object>> releases    = composeAndQuery("timeline_releases");
            List<Map<String, Object>> sprintsDone = composeAndQuery("sprint_done_dates");
            List<Map<String, Object>> decisions   = composeAndQuery("timeline_decisions");
            List<Map<String, Object>> adrs        = composeAndQuery("timeline_adrs");
            List<Map<String, Object>> specs       = composeAndQuery("timeline_specs");
            List<Map<String, Object>> tasksDone   = composeAndQuery("task_done_dates");
            List<Map<String, Object>> tasksHist   = composeAndQuery("task_created_dates");
            List<Map<String, Object>> adrHist      = composeAndQuery("adr_history_all");
            List<Map<String, Object>> specHist     = composeAndQuery("spec_history_all");
            // SE-02: у решения нет истории, и «изменено» берётся из отметки правки
            // на самой вершине. Прежний источник, KnowDecisionHist, схема создаёт,
            // срез читает, а пишет НИКТО: тип осиротел при переходе на плоскую
            // модель, и события «изменено» для решений не существовало с 14 июня.
            // Отказ был тихим — лента не пустела, пропадало лишь то, чего читатель
            // не ждёт увидеть поимённо.
            //
            // Форма строки повторяет настоящую историю (id + valid_from), поэтому
            // свёртка по дню и пропуск дня создания работают без правок.
            List<Map<String, Object>> decisionHist = decisions.stream()
                .filter(d -> d.get("updated_at") != null && d.get("decision_id") != null)
                .map(d -> Map.<String, Object>of(
                    "decision_id", d.get("decision_id"),
                    "valid_from",  d.get("updated_at")))
                .toList();
            List<Map<String, Object>> sprints     = composeAndQuery("sprints");
            List<Map<String, Object>> allTasks    = composeAndQuery("all_tasks");

            // Sprint rows carry only an id; the name a person gave it reads better.
            // A sprint can span projects, and its events (and its tasks' events)
            // carry ALL of them — the same rule SE-05 set for decisions/ADRs
            // (owner, 31.08: «показывай в каждом проекте»). Until 20.10.2026 the
            // sprint gave only the FIRST git project in traversal order:
            // SPRINT_MINILORE_CUTOVER (three repos) put every task under
            // UnlimitedLORE and none under miniLORE. projectList() sorts/dedups.
            Map<String, String> sprintName = new HashMap<>();
            Map<String, Object> sprintProject = new HashMap<>();
            for (Map<String, Object> s : sprints) {
                String sid = firstStr(s.get("sprint_id"));
                if (sid == null) continue;
                sprintName.putIfAbsent(sid, firstStr(s.get("name")));
                Object gp = s.get("git_projects");
                if (gp instanceof List<?> l && !l.isEmpty())
                    sprintProject.putIfAbsent(sid, l);
            }

            List<Map<String, Object>> items = new ArrayList<>();

            for (Map<String, Object> r : releases) {
                String date = dayOf(r.get("release_date"));
                if (date != null)
                    items.add(newsItem("release", date, timeOf(r.get("release_date")), firstStr(r.get("release_id")), "released", null, projectList(r.get("git_project")), firstStr(r.get("release_id"))));
            }
            for (Map<String, Object> s : sprintsDone) {
                String date = dayOf(s.get("done_date"));
                if (date == null) continue;
                String sid = firstStr(s.get("sprint_id"));
                items.add(newsItem("sprint", date, timeOf(s.get("done_date")), sprintName.getOrDefault(sid, sid), "closed", null, projectList(sprintProject.get(sid)), sid));
            }
            // Событие «спринт создан» — по created_date вершины (не valid_from:
            // тот SCD2 и равен дате последнего состояния). Без него «появилось»
            // в ленте не отличало новый спринт от новой задачи.
            Set<String> sprintCreatedSeen = new HashSet<>();
            for (Map<String, Object> s : sprints) {
                String sid = firstStr(s.get("sprint_id"));
                String date = dayOf(s.get("created_date"));
                if (sid == null || date == null || !sprintCreatedSeen.add(sid)) continue;
                items.add(newsItem("sprint", date, timeOf(s.get("created_date")), sprintName.getOrDefault(sid, sid), "created", null, projectList(sprintProject.get(sid)), sid));
            }
            // created-день и заголовок по id — нужны событию «изменено» ниже:
            // день создания из changed исключаем, заголовок берём человекочитаемый.
            Map<String, String> decisionCreatedDay = new HashMap<>(), decisionTitle = new HashMap<>();
            Map<String, String> specCreatedDay     = new HashMap<>(), specTitle     = new HashMap<>();
            // Проект по id — чтобы событие «изменено» несло его так же, как
            // «создано». Заполняются здесь и читаются в emitChanged ниже: у
            // *Hist-строк своего ребра на проект нет, он живёт на вершине.
            Map<String, List<String>> decisionProject = new HashMap<>();
            Map<String, List<String>> adrProjectById  = new HashMap<>();
            Map<String, List<String>> specProject     = new HashMap<>();
            for (Map<String, Object> d : decisions) {
                String did = firstStr(d.get("decision_id"));
                // Project: the decision's own BELONGS_TO_PROJECT edge if any, else
                // its parent ADR's (decision →DECIDED_IN→ ADR →BELONGS_TO_PROJECT).
                // Without this decisions fell into the feed's «без проекта» group.
                List<String> decProject = projectList(d.get("projects"));
                if (decProject.isEmpty()) decProject = projectList(d.get("adr_projects"));
                // Карта заполняется ДО проверки даты: правка живёт и у сущности,
                // у которой date_created пуст, — иначе changed снова без проекта.
                if (did != null && !decProject.isEmpty()) decisionProject.put(did, decProject);
                String date = dayOf(d.get("date_created"));
                if (date == null) continue;
                if (did != null) { decisionCreatedDay.put(did, date); decisionTitle.put(did, firstStr(d.get("title"))); }
                items.add(newsItem("decision", date, timeOf(d.get("date_created")), firstStr(d.get("title")), "created", did, decProject, did));
            }
            Map<String, String> adrCreatedDay = new HashMap<>();
            for (Map<String, Object> a : adrs) {
                String aid = firstStr(a.get("adr_id"));
                // Project: ADR's BELONGS_TO_PROJECT edge (ADRPROJ-01) — иначе ADR
                // со связкой на проект оседали в «без проекта».
                List<String> adrProject = projectList(a.get("projects"));
                if (aid != null && !adrProject.isEmpty()) adrProjectById.put(aid, adrProject);
                String date = dayOf(a.get("date_created"));
                if (date == null) continue;
                if (aid != null) adrCreatedDay.put(aid, date);
                items.add(newsItem("adr", date, timeOf(a.get("date_created")), aid, "created", firstStr(a.get("component")), adrProject, aid));
            }

            for (Map<String, Object> sp : specs) {
                String spid0 = firstStr(sp.get("spec_id"));
                List<String> project0 = projectList(sp.get("projects"));
                // Как у решений: карта проекта заполняется ДО проверки даты.
                if (spid0 != null && !project0.isEmpty()) specProject.put(spid0, project0);
                String date = dayOf(sp.get("date_created"));
                if (date == null) continue;
                String title = firstStr(sp.get("title"));
                if (title == null) title = firstStr(sp.get("spec_id"));
                String spid = firstStr(sp.get("spec_id"));
                if (spid != null) { specCreatedDay.put(spid, date); specTitle.put(spid, title); }
                // Spec carries BELONGS_TO_PROJECT (unlike decision/adr, untagged
                // by model) — first project so the client's project filter keeps it.
                List<String> project = projectList(sp.get("projects"));
                if (spid != null && !project.isEmpty()) specProject.put(spid, project);
                items.add(newsItem("spec", date, timeOf(sp.get("date_created")), title, "created", spid, project, spid));
            }

            // Событие «изменено» из SCD2-истории (ADR, спеки, решения). Дедуп по дню
            // внутри emitChanged: SCD2 пишет строку на каждую правку, без сжатия один
            // объект за день дал бы пять строк — тот же шум, что «49 more tasks».
            // Идёт ПОСЛЕ created-циклов: им заполняются карты дней создания/заголовков.
            Set<String> changedSeen = new HashSet<>();
            emitChanged(items, adrHist,      "adr_id",      "adr",      adrCreatedDay,      null,          adrProjectById,  changedSeen);
            emitChanged(items, specHist,     "spec_id",     "spec",     specCreatedDay,     specTitle,     specProject,     changedSeen);
            emitChanged(items, decisionHist, "decision_id", "decision", decisionCreatedDay, decisionTitle, decisionProject, changedSeen);

            // ПОЛНЫЙ список закрытых задач (решение владельца: «не сворачивай,
            // пусть будет полный список»). Раньше именованных капали (4/день),
            // остальные сворачивали в «ещё N задач» — из-за неуникальности task_id
            // название доставалось не всем. Ключуем по task_uid (уникален, AL-119):
            // название есть у КАЖДОЙ задачи, кап и агрегат больше не нужны.
            Map<String, String[]> byUid = new HashMap<>(); // uid -> {title, sprintId}
            for (Map<String, Object> t : allTasks) {
                String uid = firstStr(t.get("task_uid"));
                if (uid != null)
                    byUid.put(uid, new String[]{firstStr(t.get("title")), firstStr(t.get("sprint_id"))});
            }
            for (Map<String, Object> t : tasksDone) {
                String date = dayOf(t.get("valid_from"));
                if (date == null) continue;
                String uid = firstStr(t.get("task_uid"));
                String tid = firstStr(t.get("task_id"));
                String[] known = uid == null ? null : byUid.get(uid);
                String title = (known != null && known[0] != null) ? known[0] : (tid != null ? tid : uid);
                Object project = (known != null && known[1] != null) ? sprintProject.get(known[1]) : null;
                // ref = task_uid: miniLORE открывает карточку задачи; detail = tid.
                items.add(newsItem("tasks", date, timeOf(t.get("valid_from")), title, "closed", tid, projectList(project), uid));
            }

            // Событие «заведена»: min valid_from по задаче (task_created_dates —
            // сырые строки истории, min считаем здесь: ArcadeDB не умеет ни min по
            // строке-дате, ни GROUP BY с протаскиванием полей). Без этого день
            // «закрыли 9, завели 10» читался как «убыло 9», а новые задачи
            // udwe-rollout/udwe-mig-gen не попадали в ленту вовсе.
            Map<String, String[]> firstByUid = new HashMap<>(); // uid -> {minValidFrom, sprintId}
            for (Map<String, Object> h : tasksHist) {
                String uid = firstStr(h.get("task_uid"));
                String vf = firstStr(h.get("valid_from"));
                if (uid == null || vf == null) continue;
                String[] cur = firstByUid.get(uid);
                if (cur == null || vf.compareTo(cur[0]) < 0)
                    firstByUid.put(uid, new String[]{vf, firstStr(h.get("sprint_id"))});
            }
            for (Map.Entry<String, String[]> e : firstByUid.entrySet()) {
                String uid = e.getKey();
                String vf = e.getValue()[0];
                String date = dayOf(vf);
                if (date == null) continue;
                String[] known = byUid.get(uid);
                String title = (known != null && known[0] != null) ? known[0]
                             : (uid.contains("/") ? uid.substring(uid.indexOf('/') + 1) : uid);
                String sprintId = e.getValue()[1] != null ? e.getValue()[1]
                                : (known != null ? known[1] : null);
                Object project = sprintId != null ? sprintProject.get(sprintId) : null;
                items.add(newsItem("tasks", date, timeOf(vf), title, "created", null, projectList(project), uid));
            }

            // Date cursor for windowed / archive-tail loading (FN-12 «архив
            // новостей одним запросом»): since = on/after, before = strictly older.
            // Dates are YYYY-MM-DD, so lexicographic compare == chronological.
            if (since != null && !since.isBlank())
                items.removeIf(it -> String.valueOf(it.get("date")).compareTo(since) < 0);
            if (before != null && !before.isBlank())
                items.removeIf(it -> String.valueOf(it.get("date")).compareTo(before) >= 0);

            String today = Instant.now().toString().substring(0, 10);
            for (Map<String, Object> item : items)
                if (String.valueOf(item.get("date")).compareTo(today) > 0) item.put("future", true);

            // date DESC, затем time DESC. Запись без времени = начало своего дня
            // (00:00): не всплывает «свежее» тех, у кого время реально позже.
            items.sort((a, b) -> {
                int d = String.valueOf(b.get("date")).compareTo(String.valueOf(a.get("date")));
                if (d != 0) return d;
                String ta = a.get("time") == null ? "00:00" : String.valueOf(a.get("time"));
                String tb = b.get("time") == null ? "00:00" : String.valueOf(b.get("time"));
                return tb.compareTo(ta);
            });
            // Окно недели отдаётся ЦЕЛИКОМ, limit режет только хвост за окном:
            // «выводи всё за неделю как минимум» — обрезка по числу строк в активный
            // день съедала вчерашнее (120 записей умещались в полдня).
            if (newsScope != null) items = scopeNews(items, newsScope);
            String windowStart = Instant.now().minus(java.time.Duration.ofDays(days)).toString().substring(0, 10);
            List<Map<String, Object>> inWindow = new ArrayList<>(), older = new ArrayList<>();
            for (Map<String, Object> it : items) {
                if (String.valueOf(it.get("date")).compareTo(windowStart) >= 0) inWindow.add(it);
                else older.add(it);
            }
            List<Map<String, Object>> out = new ArrayList<>(inWindow);
            if (out.size() < limit) out.addAll(older.subList(0, Math.min(limit - out.size(), older.size())));
            return noStore(Response.ok(Map.of("items", out)));
        } catch (Exception e) {
            LOG.warnf("[LORE NEWS] %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }

    private List<Map<String, Object>> composeAndQuery(String sliceId) {
        LoreSlices.Composed c = LoreSlices.compose(sliceId, Map.of());
        // RM-P13: здесь нормализация нужна ДО выдачи, а не в фильтре ответа: лента
        // работает со строками дат в Java — min valid_from по задаче сравнением
        // строк, сортировка по date/time, отсечение since/before. Смесь
        // «2026-04-13 00:00:00» (DATETIME) и «…T…Z» (текстовые поля вроде
        // updated_at) сравнивалась бы неверно: пробел меньше «T». Фильтр ответа
        // потом ничего не меняет — значения уже ISO-Z.
        return LoreTimeFormat.isoUtcRows(ingestService.queryPublic(c.sql(), c.params()));
    }

    /** "2026-06-11 22:26:41" and "2026-07-10" both → "2026-07-10". Null when no date. */
    // Package-private so AidaLoreResourceTest can exercise it directly — same
    // convention as classifyStatus above.
    static String dayOf(Object value) {
        if (value == null) return null;
        String s = (value instanceof List<?> l)
            ? (l.isEmpty() ? "" : String.valueOf(l.get(0)))
            : String.valueOf(value);
        Matcher m = NEWS_DAY.matcher(s.trim());
        return m.find() ? m.group(1) : null;
    }

    // event (created·closed·released) — отдельно от kind: у разных типов число в
    // ленте означает противоположное (задачи попадают при ЗАКРЫТИИ, ADR при
    // СОЗДАНИИ), и «что стало» несёт именно event, а не тип. detail — конкретика
    // (id/компонент), без дублирующего глагола: его теперь несёт event.
    /**
     * Событие «изменено» из SCD2-истории (ADR/спека/решение), ДЕДУП ПО ДНЮ.
     * SCD2 пишет строку на каждую правку — без сжатия один объект за день дал бы
     * пять строк «изменено», и лента утонула бы в шуме (урок «49 more tasks»).
     * День создания пропускается: он уже покрыт событием created.
     * titles == null → заголовком служит сам идентификатор (так у ADR).
     *
     * <p>projects — проект по id, собранный из created-циклов: у *Hist-строки
     * своего ребра на проект нет (оно на вершине), а без него правка падала в
     * группу «без проекта» и терялась под фильтром — created это уже чинили
     * (ADRPROJ-01), changed оставался.
     */
    static void emitChanged(List<Map<String, Object>> items,
                                    List<Map<String, Object>> hist,
                                    String idField, String kind,
                                    Map<String, String> createdDay,
                                    Map<String, String> titles,
                                    Map<String, List<String>> projects,
                                    Set<String> seen) {
        for (Map<String, Object> h : hist) {
            String id = firstStr(h.get(idField));
            String date = dayOf(h.get("valid_from"));
            if (id == null || date == null) continue;
            if (date.equals(createdDay.get(id))) continue;       // это создание, не правка
            if (!seen.add(kind + "|" + id + "|" + date)) continue; // дедуп по дню
            String title = (titles != null && titles.get(id) != null) ? titles.get(id) : id;
            // Проект — со строки истории (её вершины), карта — запас для строк без
            // своего ребра (решения: их «история» — отметка правки на вершине).
            // Только карта ломалась: её заполняют срезы «появилось», обрезанные
            // по новизне, и старая сущность, исправленная сегодня, шла «без проекта».
            List<String> project = projectList(h.get("projects"));
            if (project.isEmpty() && projects != null) project = projects.getOrDefault(id, List.of());
            items.add(newsItem(kind, date, timeOf(h.get("valid_from")), title, "changed", null, project, id));
        }
    }

    static String timeOf(Object value) {
        if (value == null) return null;
        String s = (value instanceof List<?> l)
            ? (l.isEmpty() ? "" : String.valueOf(l.get(0)))
            : String.valueOf(value);
        Matcher m = NEWS_TIME.matcher(s.trim());
        return m.find() ? m.group(1) : null;
    }

    /**
     * Все принадлежности события списком: пустое, одиночное и повторяющееся
     * значения приводятся к одному виду.
     *
     * <p>Порядок детерминированный, и это не косметика: первым элементом
     * клиент подставляет поле project для сборок, которые ещё читают строку.
     * Прыгающий «первый» менял бы проект записи между выкладками без единой
     * правки данных — то есть выглядел бы порчей, не будучи ею.
     */
    static List<String> projectList(Object raw) {
        if (raw == null) return List.of();
        List<?> src = (raw instanceof List<?> l) ? l : List.of(raw);
        return src.stream()
            .filter(java.util.Objects::nonNull)
            .map(String::valueOf)
            .filter(s -> !s.isBlank())
            .distinct()
            .sorted()
            .toList();
    }

    private static Map<String, Object> newsItem(String kind, String date, String time, String title, String event, String detail, List<String> projects, String refId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("event", event);
        m.put("date", date);
        if (time != null) m.put("time", time);
        m.put("title", title);
        if (detail != null) m.put("detail", detail);
        // ОДНО событие — ОДНА строка, принадлежности списком внутри неё.
        // Двумя строками (по строке на проект) отдавать нельзя: у потребителя
        // ключ строки не содержит проекта, дубли схлопнутся и покажут
        // случайную принадлежность — та же болезнь, только переехавшая к нему.
        //
        // projects присутствует ВСЕГДА, пустым списком в том числе: «нет
        // проекта» и «поле не пришло» — разные ответы, и различать их обязан
        // не читатель, а мы.
        //
        // project — первый из списка, ради сборок, которые ещё читают строку.
        m.put("projects", projects == null ? List.<String>of() : projects);
        if (projects != null && !projects.isEmpty()) m.put("project", projects.get(0));
        // ref {type,id} — куда открыть карточку. Единый news-API самодостаточен:
        // клиент (Forseti/miniLORE) навигирует по ref, а не восстанавливает id из
        // title/detail по-своему. Нет ref (задачи: id неуникален) — открывать нечем.
        if (refId != null) m.put("ref", Map.of("type", kind, "id", refId));
        return m;
    }

    /**
     * Серверный потолок выдачи ArcadeDB, замеренный 04.08.2026.
     *
     * <p>Приписывается СЕРВЕРОМ к каждому запросу: пробы слались без поля
     * limit, а в тексте синтаксических ошибок видно «… limit 20000». Ключа с
     * этим значением в справочнике настроек нет — поднять конфигурацией нельзя,
     * остаётся только пагинация.
     */
    static final int SERVER_ROW_CAP = 20000;

    /**
     * Тело ответа среза — со ЯВНЫМ признаком усечения (DBU-13).
     *
     * <p>Три исхода, и третий важнее первых двух:
     * <ul>
     *   <li>сервер сказал «обрезал» — говорим прямо и называем потолок;
     *   <li>сервер промолчал, строк меньше потолка — обычная выдача;
     *   <li>сервер промолчал, а строк РОВНО потолок — отвечаем
     *       {@code "unknown"}. Старые версии обрезают так же, но признака не
     *       шлют, и делать из молчания вывод «усечения не было» значит
     *       подменять «не смогли узнать» на «узнали, что всё в порядке».
     * </ul>
     *
     * <p>Стало острее после снятия собственных потолков со списочных срезов
     * (решение владельца 30.08.2026): серверный предел теперь единственный — и
     * он же единственный молчаливый.
     */
    /**
     * Обнулить тело документа читателю без роли в его проекте.
     *
     * <p>Единственная точка на оба пути: и MCP, и web ходят за документом через
     * {@code GET /lore/slice/<id>}, поэтому правка здесь закрывает сразу обе
     * выдачи. Делать её в двух местах значило бы завести две правды о доступе.
     *
     * <p><b>Что остаётся видно:</b> идентификатор, заголовок, вид, проекты,
     * даты — всё, кроме содержимого. Строка НЕ исчезает: исчезнувшая строка
     * отрезала бы и те 499 записей, у которых проекта нет вовсе.
     *
     * <p><b>Признак обязателен.</b> Пустое тело без {@code body_redacted}
     * читалось бы как «документ не написан». Поэтому рядом ставятся признак и
     * причина — потребитель обязан иметь возможность сказать «нет доступа», а
     * не нарисовать пустую страницу.
     *
     * <p>Запись без проекта не обнуляется: у неё нет проекта, на котором можно
     * иметь роль (см. {@code LoreSlices.BODY_SCOPED}).
     */
    static studio.seer.heimdall.bench.MartResult redactIfNoRole(
            String sliceId, studio.seer.heimdall.bench.MartResult res,
            java.util.Set<String> allowed) {
        List<String> bodyFields = LoreSlices.BODY_SCOPED.get(sliceId);
        // allowed == null значит «ограничения нет»: обнуление выключено,
        // superadmin, выключенный auth. Резолв делает ВЫЗЫВАЮЩИЙ, до запроса к
        // базе: здесь нельзя ходить в граф, метод исполняется на event loop.
        if (allowed == null || bodyFields == null || res.result() == null) return res;

        for (Map<String, Object> row : res.result()) {
            List<?> projects = row.get("projects") instanceof List<?> l ? l : List.of();
            // Нет проекта — обнулять нечему принадлежать. Пересечение есть —
            // роль есть хотя бы в одном проекте записи, и это достаточно
            // (то же правило «любой разрешённый», что у построчного скоупа).
            if (projects.isEmpty() || projects.stream().anyMatch(p -> allowed.contains(String.valueOf(p)))) {
                continue;
            }
            for (String f : bodyFields) {
                if (row.containsKey(f)) row.put(f, null);
            }
            row.put("body_redacted", true);
            row.put("body_redacted_reason",
                "содержимое скрыто: у вас нет роли ни в одном проекте этой записи");
        }
        return res;
    }

    /** AL-91: признак построчного скоупа в ответе среза; null — скоуп к срезу не применялся. */
/**
     * AL-SCOPE-HOLES: событие ленты видно, если ХОТЯ БЫ ОДИН его проект разрешён (как у
     * срезов). Событие без проекта скоупом отсекается — правило то же, что у срезов: иначе
     * «ничьё» было бы видно всем.
     */
    static List<Map<String, Object>> scopeNews(List<Map<String, Object>> items, java.util.Set<String> allowed) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> it : items) {
            for (String p : projectList(it.get("projects"))) if (allowed.contains(p)) { out.add(it); break; }
        }
        return out;
    }

    static Map<String, Object> scopeMeta(String id, java.util.Set<String> allowed) {
        if (allowed == null || !LoreSlices.PROJECT_SCOPED.containsKey(id)) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("applied", true);
        m.put("projects", allowed.size());
        m.put("note", "выдача сужена проектным скоупом — строки вне разрешённых проектов не показаны");
        return m;
    }

    /** AL-91: скоупный срез при пустом множестве разрешённых проектов — отказ, а не пустой список. */
    static boolean scopeDenies(String id, java.util.Set<String> allowed) {
        return allowed != null && allowed.isEmpty() && LoreSlices.PROJECT_SCOPED.containsKey(id);
    }

    /**
     * MT-MCP-TRUTH A12 (06.11.2026): адресный срез под скоупом — обязательный
     * параметр ровно {@code id}, и срез проектно-скоуплен. Именно у них пустой
     * ответ читается как «записи нет», хотя запись может быть вне скоупа.
     */
    static boolean isScopedByIdSlice(String sliceId) {
        LoreSlices.SliceDef def = LoreSlices.get(sliceId);
        return def != null && List.of("id").equals(def.required())
            && LoreSlices.PROJECT_SCOPED.containsKey(sliceId);
    }

    static boolean isEmptyResult(List<?> rows) { return rows == null || rows.isEmpty(); }

    /**
     * Отметка «запись есть, но вне ваших проектов». Только факт существования —
     * содержимое не раскрывается (тот же уровень, что 409 «id занят» у записи).
     * {@code null} — записи нет вовсе: это честное «не найдено».
     */
    static Map<String, Object> outsideScopeMarker(String id, boolean existsUnscoped) {
        if (!existsUnscoped) return null;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("verdict", "outside_scope");
        m.put("reason", "запись с таким id существует, но вне ваших проектов — пустой ответ не значит «нет»");
        return m;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castRows(Object rows) {
        return (List<Map<String, Object>>) rows;
    }

    static Map<String, Object> sliceBody(studio.seer.heimdall.bench.MartResult res) {
        // RM-P13: время наружу приводит LoreTimeFormatResponseFilter — одна точка
        // на все JSON-ответы; здесь строки до выдачи ни с чем не сравниваются.
        List<Map<String, Object>> rows = res.result() == null ? List.of() : res.result();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("rows", rows);
        if (Boolean.TRUE.equals(res.truncated())) {
            int cap = res.limit() != null ? res.limit() : SERVER_ROW_CAP;
            body.put("truncated", true);
            body.put("limit", cap);
            body.put("hint", "выдача обрезана сервером на " + cap + " строк(ах): "
                + "это потолок HTTP-API базы, конфигурацией он не поднимается — "
                + "сузьте запрос или разбейте на страницы");
        } else if (res.truncated() == null && rows.size() >= SERVER_ROW_CAP) {
            body.put("truncated", "unknown");
            body.put("hint", "строк ровно " + rows.size() + " при известном потолке "
                + SERVER_ROW_CAP + ", а версия базы об усечении НЕ СООБЩАЕТ — "
                + "проверить, полна ли выдача, нечем");
        }
        return body;
    }

    @GET
    @Path("slice/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    // @Blocking обязателен: при включённом lore.scope.enforce метод ходит в
    // граф за проектами вызывающего (allowedProjectsOrNull → ProjectRbacService
    // → queryPublic → .await()), а на event loop блокироваться нельзя — Quarkus
    // отвечает 500 «The current thread cannot be blocked».
    //
    // Дефект не ловился ничем до AL-95: флаг по умолчанию снят, а под снятым
    // флагом резолвер даже не вызывается — первая же строка возвращает null.
    // То есть выкаченный за флагом код в ВКЛЮЧЁННОМ состоянии не работал вовсе.
    @io.smallrye.common.annotation.Blocking
    public Uni<Response> slice(@PathParam("id") String id, @Context UriInfo uriInfo,
                               @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (LoreSlices.get(id) == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.NOT_FOUND)
                .entity(new LoreError("UNKNOWN_SLICE", id))));
        }

        Map<String, String> given = new LinkedHashMap<>();
        uriInfo.getQueryParameters().forEach((k, v) -> {
            if (v != null && !v.isEmpty()) given.put(k, v.get(0));
        });

        LoreSlices.Composed composed;
        final SlicePage page;
        java.util.Set<String> rowScope;
        try {
            // SE-01: limit/offset — страница для любого слайса; вынимаются до compose.
            page = SlicePage.extract(given);
            rowScope = allowedProjectsOrNull(role);
            composed = LoreSlices.compose(id, given, rowScope);
        } catch (IllegalArgumentException e) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", e.getMessage()))));
        }

        MartQuery body = new MartQuery("sql", composed.sql(),
            composed.params().isEmpty() ? null : composed.params(), -1);
        LOG.debugf("[LORE:%s] %s %s", db, id, composed.params());

        // Разрешённые проекты резолвятся ЗДЕСЬ, до запроса, а не внутри .map().
        //
        // Первая редакция вызывала резолвер в продолжении реактивной цепочки —
        // и получала 502 на каждом запросе с живым токеном. @Blocking стоит на
        // slice(), но продолжение .map() исполняется не на этом потоке: поход в
        // граф за проектами блокировал event loop, и отказ выходил наружу как
        // LORE_UPSTREAM — то есть выглядел как сбой БАЗЫ, а не как наша ошибка
        // потока. Прошли только пути, которые до графа не доходят вовсе
        // (superadmin и выключенный auth) — из них двух можно было сделать
        // вывод «работает».
        // AL-91 (условие шлюза miniLORE): пустое множество разрешённых проектов —
        // явный отказ, а не 200 с пустым списком: «нет прав» не должно выглядеть
        // как «ничего нет».
        if (scopeDenies(id, rowScope)) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("SCOPE_EMPTY", "проектный скоуп: у вызывающего нет ни одного разрешённого "
                    + "проекта (не заведён в граф ролей или роль не выдана) — срез " + id + " не отдаётся пустым"))));
        }
        final Map<String, Object> scopeMarker = scopeMeta(id, rowScope);
        java.util.Set<String> allowedForRedact =
            redactBodies && LoreSlices.BODY_SCOPED.containsKey(id) ? redactScope(role) : null;

        return client.query(db, basicAuth(), body)
            // MT-MCP-TRUTH A12: пустой ответ на ЯВНЫЙ id под скоупом — проверить,
            // есть ли запись вообще. Есть — сказать «вне скоупа», а не «не найдено».
            .chain(res -> {
                String explicitId = given.get("id");
                if (rowScope == null || explicitId == null || !isScopedByIdSlice(id) || !isEmptyResult(res.result()))
                    return Uni.createFrom().item(new Object[] {res, null});
                LoreSlices.Composed unscoped = LoreSlices.compose(id, given);
                MartQuery probe = new MartQuery("sql", unscoped.sql(),
                    unscoped.params().isEmpty() ? null : unscoped.params(), -1);
                return client.query(db, basicAuth(), probe)
                    .map(p -> new Object[] {res, outsideScopeMarker(explicitId, !isEmptyResult(p.result()))})
                    .onFailure().recoverWithItem(ex -> new Object[] {res, null});
            })
            .map(pair -> {
                studio.seer.heimdall.bench.MartResult res = (studio.seer.heimdall.bench.MartResult) pair[0];
                @SuppressWarnings("unchecked")
                Map<String, Object> outside = (Map<String, Object>) pair[1];
                Map<String, Object> out = sliceBody(redactIfNoRole(id, res, allowedForRedact));
                // S1-06: аддитивное поле категории статуса — ДО SlicePage.apply,
                // чтобы fields=…,status_category проецировалось как обычная колонка.
                out.put("rows", LoreStatusCategory.enrich(id, castRows(out.get("rows"))));
                if (scopeMarker != null) out.put("scope", scopeMarker);
                if (outside != null) out.put("outside_scope", outside);
                try {
                    SlicePage.apply(out, page);
                } catch (IllegalArgumentException e) {
                    return noStore(Response.status(Response.Status.BAD_REQUEST)
                        .entity(new LoreError("BAD_PARAMS", e.getMessage())));
                }
                return noStore(Response.ok(out));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE FAILED] slice=%s: %s", id, ex.getMessage());
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(new LoreError("LORE_UPSTREAM", String.valueOf(ex.getMessage()))));
            });
    }

    /**
     * AL-94: множество проектов, которыми ограничен read вызывающего, либо
     * {@code null} — «без ограничения».
     *
     * <p><b>За флагом {@code lore.scope.enforce} (по умолчанию ВЫКЛЮЧЕН).</b>
     * Причина не в осторожности вообще, а в состоянии данных: граф ролей
     * (KnowUser/HAS_PROJECT_ROLE, AL-82) сегодня почти пуст, а часть сущностей
     * после бэкфилла V20 (AL-92) осталась без проектных рёбер. Включить скоуп
     * до наполнения графа значит выдать живым пользователям пустые экраны —
     * ровно тот класс «выглядит работающим, показывает пустоту», от которого
     * этот спринт и защищает. Флаг снимается владельцем после наполнения
     * ролей — тогда же решается вопрос про роль {@code admin} (см. ниже).</p>
     *
     * <p>Bypass получают: выключенная аутентификация (токена нет вовсе —
     * локальная разработка не должна видеть пустоту, решение владельца),
     * {@code superadmin} и — ПОКА — {@code admin}: администратор LORE
     * администрирует весь корпус, а не проект, и его сужение до проектных
     * ролей — отдельное решение владельца, не побочный эффект этой задачи.</p>
     *
     * <p><b>Bypass по роли — только для ЧЕЛОВЕКА.</b> Агент опознаётся раньше
     * и уходит в {@code visibleProjectsForAgent} независимо от того, какая роль
     * пришла в {@code X-Seer-Role}. Иначе узкий профиль агента читал бы весь
     * корпус мимо проектов своего владельца — см. {@link #bypassesScope}.</p>
     *
     * <p><b>Чтение и запись сужаются ПО-РАЗНОМУ.</b> Видимость — по проектам
     * (все проекты владельца, роль не важна), право менять — по роли (D4).
     * Иначе участник проекта не знал бы артефактов собственного проекта.</p>
     */
    java.util.Set<String> allowedProjectsOrNull(String role) {
        if (!scopeEnforce) return null;
        return callerAllowedProjects(role);
    }

    /**
     * Множество проектов для ОБНУЛЕНИЯ ТЕЛА — то же, что у построчного скоупа,
     * но с одним послаблением: вызывающего, которого нет в графе ролей, мы не
     * обнуляем, а пропускаем, громко записав факт в лог.
     *
     * <p><b>Почему послабление есть здесь и не может появиться у построчного
     * скоупа.</b> Пустое множество приходит в двух несовместимых смыслах:
     * «завели, роль не дали» (ответ по правам) и «в графе нет вовсе»
     * (недостача данных) — см. {@link ProjectRbacService#knownToRoleGraph}.
     * Обнуление тела ничего не прячет и не гарантирует изоляцию, поэтому
     * выбрать в пользу «не соврать» здесь можно. Построчный скоуп гарантирует
     * именно изоляцию: пропусти он незаведённого клиента — и регистрация
     * нового клиента KC стала бы способом прочесть весь корпус. Поэтому там
     * {@link #allowedProjectsOrNull} оставлен строгим, а не вызывает этот метод.
     *
     * <p><b>Почему не молча.</b> Пропуск без записи превратил бы меру в
     * видимость меры: тела доходят, выглядит как «обнуление работает, просто
     * у всех есть права». Поэтому WARN называет клиента и действие — это та
     * работа, которую надо доделать (завести учётку в графе), а не свойство
     * системы.
     */
    java.util.Set<String> redactScope(String role) {
        java.util.Set<String> allowed = callerAllowedProjects(role);
        if (allowed == null || !allowed.isEmpty()) return allowed;
        String clientId = callerClientId();
        String kcSub = callerKcSub();
        if (projectRbac.knownToRoleGraph(clientId, kcSub)) return allowed;
        LOG.warnf("[LORE SCOPE] вызывающий не заведён в графе ролей (client_id=%s, sub=%s) — "
            + "тела НЕ обнуляем: отличить «нет прав» от «не опознан» по пустому множеству нельзя. "
            + "Чтобы мера на него действовала, учётку надо завести: KnowActor с этим client_id и "
            + "владельцем (OWNED_BY) либо KnowUser с этим sub и проектной ролью.",
            clientId, kcSub);
        return null;
    }

    /**
     * То же множество, но БЕЗ оглядки на {@code lore.scope.enforce}.
     *
     * <p>Вынесено потому, что мер стало две и у них разные выключатели:
     * построчный скоуп ({@code lore.scope.enforce}) и обнуление тела
     * ({@code lore.scope.redact-bodies}). Пока резолвер сам проверял флаг
     * построчного скоупа, обнуление нельзя было включить отдельно — оно
     * получало {@code null} и молча не работало. Ровно тот же дефект, что
     * AL-95 поймал у первой редакции: код за флагом, который во включённом
     * состоянии не делает ничего.
     *
     * <p>{@code null} здесь по-прежнему значит «ограничения нет»: superadmin,
     * выключенная аутентификация, админ.
     */
    java.util.Set<String> callerAllowedProjects(String role) {
        // ПОРЯДОК СУЩЕСТВЕННЫЙ: агент опознаётся ДО роли. См. bypassesScope().
        String clientId = callerClientId();
        if (clientId != null) {
            // AL-91: служебный читатель всего корпуса — без ограничения, только здесь (чтение).
            if (readsWholeCorpus(clientId, readAllClients)) return null;
            // ЧТЕНИЕ — по проектам владельца, БЕЗ сужения матрицей D4 (решение
            // владельца 2026-08-01: «читать всё в пределах своих проектов,
            // изменять — в пределах роли»). D4 отвечает, что агенту позволено
            // ДЕЛАТЬ, а не что ему позволено ЗНАТЬ: участник проекта должен
            // видеть артефакты своего проекта. Для записи — по-прежнему
            // allowedProjectsForAgent.
            return projectRbac.visibleProjectsForAgent(clientId);
        }
        if (bypassesScope(role, null)) return null;
        String kcSub = callerKcSub();
        if (kcSub == null) return null; // токена нет — auth выключен
        return projectRbac.allowedProjectsForUser(kcSub);
    }

    /**
     * Чистое решение «скоуп не применяется» — вынесено ради теста без CDI.
     *
     * <p><b>Агент не обходит скоуп никогда, какой бы ни была его realm-роль.</b>
     * Это исправление дефекта первой редакции AL-94, где проверка роли стояла
     * ПЕРВОЙ:
     * <pre>if ("superadmin".equals(role) || "admin".equals(role)) return null;</pre>
     * Write-путь требует {@code admin}, поэтому с этой ролью приходят и узкие
     * профили агентов — проверка роли первой делала исключение всеобщим, и
     * ветка {@code allowedProjectsForAgent} была недостижима. Практическое
     * следствие: агент с профилем pm читал слайсы всего корпуса, минуя проекты
     * своего владельца. Тот же урок уже записан в javadoc
     * {@code LoreResourceBase.fullBearer()} — «роль из заголовка НЕ годится как
     * разделитель»; здесь он был повторно нарушен.
     *
     * <p>Права агента считаются от владельца ({@code OWNED_BY}) и сужаются
     * матрицей делегирования D4 — агент не может видеть больше человека,
     * которому принадлежит.
     */
    static boolean bypassesScope(String role, String clientId) {
        if (clientId != null) return false;
        return "superadmin".equals(role) || "admin".equals(role);
    }

    // ── Admin: ingest pipeline (Phase 2, LAL-13) ─────────────────────────────

    @POST
    @Path("/admin/lore/ingest")
    @Produces(MediaType.APPLICATION_JSON)
    public Response adminIngest(
            @HeaderParam("X-Seer-Role") String role,
            @QueryParam("docsRoot") String docsRoot) {
        if (!enabled) return disabled();
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required")));
        }
        LoreIngestService.IngestReport report = ingestService.ingest(docsRoot);
        java.util.LinkedHashMap<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("ok",           report.errors().isEmpty());
        result.put("adrs",         report.adrs());
        result.put("decisions",    report.decisions());
        result.put("sprints",      report.sprints());
        result.put("edges",        report.edges());
        result.put("runbooks",     report.runbooks());
        result.put("qualityGates", report.qualityGates());
        result.put("docs",         report.docs());
        result.put("tasks",        report.tasks());
        result.put("findings",     report.findings());
        result.put("releases",     report.releases());
        result.put("errors",       report.errors());
        return noStore(Response.ok(result));
    }

}
