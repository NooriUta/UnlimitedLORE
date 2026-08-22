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

    @Inject
    ProjectRbacService projectRbac;

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
     * значка встречаются (см. `sprint_done_dates`'s `LIKE '✅%' OR 'ЗАВЕРШЁН%'`
     * для того же класса компромисса).
     */
    // Package-private (not private) so AidaLoreResourceTest can call it directly —
    // same convention as WorkQuality's pure-function methods.
    static String classifyStatus(String s) {
        if (s == null || s.isBlank()) return "none";   // status not set ≠ TODO
        String trimmed = s.stripLeading();
        if (trimmed.startsWith("✅")) return "done";
        if (trimmed.startsWith("🔄")) return "in_progress";
        if (trimmed.startsWith("🟡")) return "partial";
        if (trimmed.startsWith("🚀")) return "ready_for_deploy";
        if (trimmed.startsWith("🔴")) return "blocked";
        if (trimmed.startsWith("🚫")) return "cancelled";
        if (trimmed.startsWith("🔬")) return "design";
        if (trimmed.startsWith("🟣")) return "backlog";
        if (trimmed.startsWith("📋")) return "planned";
        if (trimmed.startsWith("⏸")) return "deferred";
        if (trimmed.startsWith("⬜")) return "todo";
        // No leading marker (legacy row) — fall back to word matching.
        String u = s.toUpperCase();
        if (u.contains("DONE") || u.contains("CLOSED") || u.contains("MERGED")
            || u.contains("ЗАВЕРШ") || u.contains("ЗАКРЫТ"))                    return "done";
        if (u.contains("PROGRESS") || u.contains("WIP"))                        return "in_progress";
        if (u.contains("PARTIAL") || u.contains("ЧАСТИЧ"))                      return "partial";
        if (u.contains("READY") || u.contains("ДЕПЛО"))                         return "ready_for_deploy";
        if (u.contains("BLOCK") || u.contains("ЗАБЛОК"))                        return "blocked";
        if (u.contains("CANCEL") || u.contains("ОТМЕН"))                        return "cancelled";
        if (u.contains("PLANNED"))                                             return "planned";
        if (u.contains("DESIGN"))                                              return "design";
        if (u.contains("BACKLOG"))                                             return "backlog";
        if (u.contains("DEFER") || u.contains("ОТЛОЖ"))                        return "deferred";
        return "todo";
    }

    @SuppressWarnings("unchecked")
    private static String firstStr(Object v) {
        if (v == null) return null;
        if (v instanceof List<?> l) return l.isEmpty() ? null : String.valueOf(l.get(0));
        return String.valueOf(v);
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
                         @QueryParam("days") Integer daysParam) {
        if (!enabled) return disabled();
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
            List<Map<String, Object>> decisionHist = composeAndQuery("decision_history_all");
            List<Map<String, Object>> sprints     = composeAndQuery("sprints");
            List<Map<String, Object>> allTasks    = composeAndQuery("all_tasks");

            // Sprint rows carry only an id; the name a person gave it reads better.
            // A sprint can span projects; the feed tags with the first (the one LORE
            // itself leads with). Decisions/ADRs carry no project → stay untagged.
            Map<String, String> sprintName = new HashMap<>();
            Map<String, String> sprintProject = new HashMap<>();
            for (Map<String, Object> s : sprints) {
                String sid = firstStr(s.get("sprint_id"));
                if (sid == null) continue;
                sprintName.putIfAbsent(sid, firstStr(s.get("name")));
                Object gp = s.get("git_projects");
                if (gp instanceof List<?> l && !l.isEmpty() && l.get(0) != null)
                    sprintProject.putIfAbsent(sid, String.valueOf(l.get(0)));
            }

            List<Map<String, Object>> items = new ArrayList<>();

            for (Map<String, Object> r : releases) {
                String date = dayOf(r.get("release_date"));
                if (date != null)
                    items.add(newsItem("release", date, timeOf(r.get("release_date")), firstStr(r.get("release_id")), "released", null, firstStr(r.get("git_project")), firstStr(r.get("release_id"))));
            }
            for (Map<String, Object> s : sprintsDone) {
                String date = dayOf(s.get("done_date"));
                if (date == null) continue;
                String sid = firstStr(s.get("sprint_id"));
                items.add(newsItem("sprint", date, timeOf(s.get("done_date")), sprintName.getOrDefault(sid, sid), "closed", null, sprintProject.get(sid), sid));
            }
            // created-день и заголовок по id — нужны событию «изменено» ниже:
            // день создания из changed исключаем, заголовок берём человекочитаемый.
            Map<String, String> decisionCreatedDay = new HashMap<>(), decisionTitle = new HashMap<>();
            Map<String, String> specCreatedDay     = new HashMap<>(), specTitle     = new HashMap<>();
            for (Map<String, Object> d : decisions) {
                String date = dayOf(d.get("date_created"));
                if (date == null) continue;
                String did = firstStr(d.get("decision_id"));
                if (did != null) { decisionCreatedDay.put(did, date); decisionTitle.put(did, firstStr(d.get("title"))); }
                items.add(newsItem("decision", date, timeOf(d.get("date_created")), firstStr(d.get("title")), "created", did, null, did));
            }
            Map<String, String> adrCreatedDay = new HashMap<>();
            for (Map<String, Object> a : adrs) {
                String date = dayOf(a.get("date_created"));
                if (date == null) continue;
                String aid = firstStr(a.get("adr_id"));
                if (aid != null) adrCreatedDay.put(aid, date);
                items.add(newsItem("adr", date, timeOf(a.get("date_created")), aid, "created", firstStr(a.get("component")), null, aid));
            }

            for (Map<String, Object> sp : specs) {
                String date = dayOf(sp.get("date_created"));
                if (date == null) continue;
                String title = firstStr(sp.get("title"));
                if (title == null) title = firstStr(sp.get("spec_id"));
                String spid = firstStr(sp.get("spec_id"));
                if (spid != null) { specCreatedDay.put(spid, date); specTitle.put(spid, title); }
                // Spec carries BELONGS_TO_PROJECT (unlike decision/adr, untagged
                // by model) — first project so the client's project filter keeps it.
                String project = null;
                Object pr = sp.get("projects");
                if (pr instanceof List<?> l && !l.isEmpty() && l.get(0) != null)
                    project = String.valueOf(l.get(0));
                items.add(newsItem("spec", date, timeOf(sp.get("date_created")), title, "created", spid, project, spid));
            }

            // Событие «изменено» из SCD2-истории (ADR, спеки, решения). Дедуп по дню
            // внутри emitChanged: SCD2 пишет строку на каждую правку, без сжатия один
            // объект за день дал бы пять строк — тот же шум, что «49 more tasks».
            // Идёт ПОСЛЕ created-циклов: им заполняются карты дней создания/заголовков.
            Set<String> changedSeen = new HashSet<>();
            emitChanged(items, adrHist,      "adr_id",      "adr",      adrCreatedDay,      null,          changedSeen);
            emitChanged(items, specHist,     "spec_id",     "spec",     specCreatedDay,     specTitle,     changedSeen);
            emitChanged(items, decisionHist, "decision_id", "decision", decisionCreatedDay, decisionTitle, changedSeen);

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
                String project = (known != null && known[1] != null) ? sprintProject.get(known[1]) : null;
                // ref = task_uid: miniLORE открывает карточку задачи; detail = tid.
                items.add(newsItem("tasks", date, timeOf(t.get("valid_from")), title, "closed", tid, project, uid));
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
                String project = sprintId != null ? sprintProject.get(sprintId) : null;
                items.add(newsItem("tasks", date, timeOf(vf), title, "created", null, project, uid));
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
        return ingestService.queryPublic(c.sql(), c.params());
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
     */
    private static void emitChanged(List<Map<String, Object>> items,
                                    List<Map<String, Object>> hist,
                                    String idField, String kind,
                                    Map<String, String> createdDay,
                                    Map<String, String> titles,
                                    Set<String> seen) {
        for (Map<String, Object> h : hist) {
            String id = firstStr(h.get(idField));
            String date = dayOf(h.get("valid_from"));
            if (id == null || date == null) continue;
            if (date.equals(createdDay.get(id))) continue;       // это создание, не правка
            if (!seen.add(kind + "|" + id + "|" + date)) continue; // дедуп по дню
            String title = (titles != null && titles.get(id) != null) ? titles.get(id) : id;
            items.add(newsItem(kind, date, timeOf(h.get("valid_from")), title, "changed", null, null, id));
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

    private static Map<String, Object> newsItem(String kind, String date, String time, String title, String event, String detail, String project, String refId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("event", event);
        m.put("date", date);
        if (time != null) m.put("time", time);
        m.put("title", title);
        if (detail != null) m.put("detail", detail);
        if (project != null) m.put("project", project);
        // ref {type,id} — куда открыть карточку. Единый news-API самодостаточен:
        // клиент (Forseti/miniLORE) навигирует по ref, а не восстанавливает id из
        // title/detail по-своему. Нет ref (задачи: id неуникален) — открывать нечем.
        if (refId != null) m.put("ref", Map.of("type", kind, "id", refId));
        return m;
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
        try {
            composed = LoreSlices.compose(id, given, allowedProjectsOrNull(role));
        } catch (IllegalArgumentException e) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", e.getMessage()))));
        }

        MartQuery body = new MartQuery("sql", composed.sql(),
            composed.params().isEmpty() ? null : composed.params(), -1);
        LOG.debugf("[LORE:%s] %s %s", db, id, composed.params());

        return client.query(db, basicAuth(), body)
            .map(res -> noStore(Response.ok(Map.of("rows",
                res.result() == null ? List.of() : res.result()))))
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
        // ПОРЯДОК СУЩЕСТВЕННЫЙ: агент опознаётся ДО роли. См. bypassesScope().
        String clientId = callerClientId();
        if (clientId != null) {
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
