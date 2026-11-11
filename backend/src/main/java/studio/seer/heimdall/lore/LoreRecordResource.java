package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Фасад паспорта {@code lore.record/1} (ADR-LORE-047, SPEC-LORE-UXR-RECORD-CONTRACT 0.3).
 *
 * <ul>
 *   <li>{@code GET /lore/record/{type}/{id}} — запись, собранная из СУЩЕСТВУЮЩИХ срезов
 *       (A1: только чтение; та же форма строк, тот же проектный скоуп, что у
 *       {@code /lore/slice}). Раскладка — из {@link LoreRecordRegistry}.</li>
 *   <li>{@code GET /lore/record/{type}/_new} — пустой паспорт с умолчаниями пути создания.</li>
 *   <li>{@code POST /lore/record/{type}/{id}/relation} — одна точка привязки (A2): маршрут
 *       {@link LoreRecordRelationRoutes} ведёт в существующий обработчик {@code *_link},
 *       новой семантики рёбер нет.</li>
 * </ul>
 *
 * <p>Честные состояния частей: срез упал — {@code state: "error"} с причиной, скоуп
 * отказал — {@code state: "denied"}; пустая часть — только {@code state: "ok"} и
 * {@code count: 0}. «Не смогли прочитать» не выдаётся за «пусто».
 */
@Path("/lore/record")
public class LoreRecordResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreRecordResource.class);
    static final String CONTRACT = "lore.record/1";
    static final String NEW_ID = "_new";

    @Inject AidaLoreResource sliceResource;      // проектный скоуп вызывающего — тем же резолвером, что у /lore/slice
    @Inject LoreSprintTaskResource sprintTask;
    @Inject LoreAdrResource adrResource;
    @Inject LoreQuestionResource questionResource;
    @Inject LoreMilestoneResource milestoneResource;
    @Inject LoreSpecResource specResource;

    /** Главный срез записи типа и имя его параметра. */
    record Source(String slice, String param, boolean list) {}

    /** release_uid «проект#тег» (AIDA/UnlimitedLORE#v1.17.4): как SAFE_ID, плюс «#». */
    static final java.util.regex.Pattern RELEASE_UID = java.util.regex.Pattern.compile("[A-Za-z0-9_./\\-]{1,100}#[A-Za-z0-9_.\\-]{1,60}");

    static Source sourceOf(String type) {
        return switch (type) {
            case "sprint" -> new Source("sprint_tree", "id", false);
            case "task" -> new Source("tasks_by_uids", "task_uids", true);
            case "adr" -> new Source("adr", "id", false);
            case "spec" -> new Source("spec_by_id", "id", false);
            case "decision" -> new Source("decision", "id", false);
            case "question" -> new Source("question_by_id", "id", false);
            case "milestone" -> new Source("milestone_by_id", "id", false);
            case "release" -> new Source("release_by_id", "id", false);
            // S4-V2-SECTIONS: компонент, технология (спека SPEC-TECH-…), фича — сценарий любого уровня.
            case "component" -> new Source("component", "id", false);
            case "tech" -> new Source("tech_by_id", "id", false);
            case "feature" -> new Source("uc_by_id", "id", false);
            // S4-29 (53а): паспорт проекта; ключ — slug «владелец/репозиторий».
            case "project" -> new Source("project_by_id", "project", false);
            default -> null;
        };
    }

    /** Исход чтения одного среза: строки, либо состояние отказа с причиной. */
    record Read(List<Map<String, Object>> rows, String state, String error, Throwable cause) {
        boolean ok() { return "ok".equals(state); }
    }

    // ── GET ─────────────────────────────────────────────────────────────────

    @GET
    @Path("{type}/{id: .+}")
    @Produces(MediaType.APPLICATION_JSON)
    @io.smallrye.common.annotation.Blocking
    public Response record(@PathParam("type") String type, @PathParam("id") String id,
                           @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        if (!LoreRecordRegistry.TYPES.contains(type))
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("UNKNOWN_TYPE",
                "тип паспорта '" + type + "' не заведён; есть: " + LoreRecordRegistry.TYPES)));
        // Ключ релиза — release_uid «проект#тег»: «#» допустим только у релиза.
        boolean idOk = "release".equals(type) ? RELEASE_UID.matcher(id).matches() : SAFE_ID.matcher(id).matches();
        if (!NEW_ID.equals(id) && !idOk)
            return badParams("id contains illegal characters");
        Set<String> scope;
        try {
            scope = sliceResource.allowedProjectsOrNull(role);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE RECORD] scope resolve failed: %s", e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
        boolean identified = role != null && !role.isBlank();
        return NEW_ID.equals(id) ? newRecord(type, role, identified) : existing(type, id, role, identified, scope);
    }

    private Response newRecord(String type, String role, boolean identified) {
        Map<String, Object> values = LoreRecordValues.defaults(type);
        Map<String, Object> rec = recordHead(type, null, "", (String) values.get("status"), null);
        Map<String, Object> out = envelope(rec, values, List.of(), List.of(),
            LoreRecordPerms.of(type, role, identified, null, 0, specStatuses(type)), Map.of(), type, List.of(),
            List.of());
        out.put("schema", recordSchema(type));
        out.put("computed", Map.of());
        return noStore(Response.ok(out));
    }

    private Response existing(String type, String id, String role, boolean identified, Set<String> scope) {
        Source src = sourceOf(type);
        Read main = read(src.slice(), Map.of(src.param(), id), scope);
        if ("denied".equals(main.state()))
            return noStore(Response.status(Response.Status.FORBIDDEN).entity(new LoreError("SCOPE_EMPTY", main.error())));
        if (!main.ok())
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(main.cause(), main.error())));
        if (main.rows().isEmpty())
            return noStore(Response.status(Response.Status.NOT_FOUND).entity(new LoreError("NOT_FOUND",
                type + " '" + id + "' не найден" + (scope != null ? " (или вне проектного скоупа)" : ""))));
        Map<String, Object> row = main.rows().get(0);

        Map<String, Object> values = LoreRecordValues.values(type, row);
        // Итоги — отдельным блоком computed, не в values (S7A-12 09.11).
        Map<String, Object> computed = new LinkedHashMap<>(LoreRecordValues.computed(type, row));
        String status = (String) values.get("status");

        // S4-29 (50а/51а/55а): проекты и компоненты — чипами у всех типов, с наследованием.
        List<Map<String, Object>> chipState = new ArrayList<>();
        putChips(type, id, values, scope, chipState);

        List<String> blocks = new ArrayList<>();
        List<Map<String, Object>> parts = new ArrayList<>();
        List<Map<String, Object>> links = new ArrayList<>();
        Map<String, Object> facts = new LinkedHashMap<>();
        // S4-30: что с каждым прочитанным источником (meta.data_state).
        List<Map<String, Object>> dataState = new ArrayList<>();
        dataState.add(LoreRecordDataState.entry(src.slice(), null, main));
        dataState.addAll(chipState);
        int openTasks = 0;

        LoreRecordRegistry.TypeDef def = LoreRecordRegistry.get(type);
        // Задачи читаются первыми: «x/y» фаз считается по ним.
        Map<String, Read> partReads = new LinkedHashMap<>();
        for (LoreRecordRegistry.Part p : def.parts())
            partReads.put(p.key(), read(p.slice(), Map.of(paramOf(p.slice()), id), scope));
        List<Map<String, Object>> taskItems = new ArrayList<>();
        Read tasksRead = partReads.get("tasks");
        if (tasksRead != null && tasksRead.ok())
            for (Map<String, Object> r : tasksRead.rows()) taskItems.add(LoreRecordValues.partItem("task", r));
        for (LoreRecordRegistry.Part p : def.parts()) {
            Read r = partReads.get(p.key());
            Map<String, Object> part = LoreRecordRegistry.partJson(p);
            part.put("state", r.state());
            if (r.error() != null) part.put("error", r.error());
            dataState.add(LoreRecordDataState.entry(p.slice(), p.key(), r));
            List<Map<String, Object>> items = new ArrayList<>();
            if (r.ok()) {
                if ("tasks".equals(p.key())) items = taskItems;
                else for (Map<String, Object> row2 : r.rows()) items.add("phase".equals(p.type())
                    ? LoreRecordValues.phaseItem(row2, taskItems)
                    : LoreRecordValues.partItem(p.type(), row2));
            }
            part.put("count", r.ok() ? items.size() : null);
            part.put("items", items);
            parts.add(part);
            blocks.add(p.key());
        }

        // Связи из строки основного среза — одна функция на все типы (S4-29 v3).
        links.addAll(LoreRecordValues.rowLinks(type, row));
        // Вкладки без среза — «не смогли проверить», а не «пусто» (S4-29 v3).
        dataState.addAll(LoreRecordValues.unreadState(type));
        switch (type) {
            case "sprint" -> {
                if (tasksRead != null && tasksRead.ok()) {
                    openTasks = SprintCloseGuard.openTasks(tasksRead.rows()).size();
                    int done = 0;
                    for (Map<String, Object> t : taskItems) if ("done".equals(t.get("status"))) done++;
                    Map<String, Object> tf = new LinkedHashMap<>();
                    tf.put("done", done);
                    tf.put("total", taskItems.size());
                    tf.put("open", openTasks);
                    facts.put("tasks", tf);
                    // Владелица 09.11: итоги спринта — та же функция, что у среза sprint_totals
                    // (одно число — один источник). Строкам части задач проставляется sprint_id.
                    List<Map<String, Object>> rowsWithSprint = new ArrayList<>();
                    for (Map<String, Object> t : tasksRead.rows()) {
                        Map<String, Object> c = new LinkedHashMap<>(t);
                        c.put("sprint_id", id);
                        rowsWithSprint.add(c);
                    }
                    Map<String, Object> totals = LoreSprintTotals.aggregate(rowsWithSprint, List.of(id)).get(0);
                    for (String k : List.of("tasks_total", "effort_days_total", "actual_days_total"))
                        computed.put(k, totals.get(k));
                }
            }
            default -> { }
        }
        // Вкладки связей отдельным срезом (задача: ADR, блокирующие вопросы; релиз: спринты, PR;
        // компонент: задачи, спринты) — по описаниям LoreRecordFrom.SLICE_LINKS, одним циклом (S4-MODEL-RECORD).
        for (LoreRecordFrom.SliceLink sl : LoreRecordFrom.SLICE_LINKS.getOrDefault(type, List.of()))
            tabBySlice(sl, id, scope, blocks, dataState, links, facts);

        String version = null;
        String versionError = null;
        // Kit 09.11: у типов только-для-чтения (решение, вопрос) истории SCD2 нет — версии нет, и это
        // не ошибка: record.version = null без version_error.
        if (!LoreRecordRegistry.READ_ONLY.contains(type)) try {
            List<Map<String, Object>> v = ingestService.queryPublic(LoreRecordVersion.sql(type), Map.of("id", id));
            if (!v.isEmpty()) version = LoreRecordVersion.normalize(v.get(0).get("version"));
        } catch (RuntimeException e) {
            versionError = e.getMessage();
            facts.put("version_error", versionError);
        }
        dataState.add(LoreRecordDataState.version(versionError));
        Map<String, Object> rec = recordHead(type, id, (String) values.get("title"), status, version);
        Map<String, Object> out = envelope(rec, values, parts, links,
            LoreRecordPerms.of(type, role, identified, status, openTasks, specStatuses(type)), facts, type, blocks,
            dataState);
        out.put("schema", recordSchema(type));
        out.put("computed", computed);
        @SuppressWarnings("unchecked") Map<String, Object> meta = (Map<String, Object>) out.get("meta");
        @SuppressWarnings("unchecked") Map<String, Object> sources = (Map<String, Object>) meta.get("sources");
        sources.put("record", src.slice());
        return noStore(Response.ok(out));
    }

    /**
     * Параметр среза части — ровно обязательный параметр самого среза. S4-29 v3: раньше имя
     * угадывалось по суффиксу «_of_sprint» → sprint_id, а questions_of_sprint ждёт id — угадывание
     * отдало бы часть ошибкой. Запасной путь (срез без одного обязательного) — прежнее правило.
     */
    static String paramOf(String slice) {
        LoreSlices.SliceDef def = LoreSlices.get(slice);
        if (def != null && def.required().size() == 1) return def.required().get(0);
        return slice.endsWith("_of_sprint") ? "sprint_id" : "id";
    }

    // ── Чипы шапки: проекты и компоненты (S4-29, 50а/51а/55а) ───────────────

    /** Проекция «чем источник делится»: id, его проекты и компоненты. */
    private static final String SPRINT_AXES = "SELECT sprint_id AS src_id, out('BELONGS_TO_PROJECT').slug AS projects, "
        + "out('BELONGS_TO').component_id AS components FROM KnowSprint WHERE ";

    /**
     * Заменяет {@code values.projects}/{@code values.components} чипами
     * ({@link LoreRecordChips}). Источники наследования: задача — её спринт; сценарий — фичи-предки
     * (до 4 уровней); веха — её спринты; компонент — его спринты (только проекты); релиз — его
     * спринты (только компоненты: проекты у релиза свои). Под скоупом источник, чьих проектов
     * нет среди разрешённых, не учитывается — его id не уходит наружу. Сбой чтения — строка
     * {@code data_state} с причиной, а не тихий пустой список.
     */
    private void putChips(String type, String id, Map<String, Object> values, Set<String> scope,
                          List<Map<String, Object>> state) {
        List<String> ownP = LoreRecordChips.ownProjects(values);
        List<String> ownC = LoreRecordChips.ownComponents(type, values);
        List<LoreRecordChips.Inherited> inhP = new ArrayList<>();
        List<LoreRecordChips.Inherited> inhC = new ArrayList<>();
        try {
            switch (type) {
                case "task" -> {
                    String sprint = LoreRecordValues.str(values.get("sprint"));
                    if (sprint != null) inherit(SPRINT_AXES + "sprint_id = :id", Map.of("id", sprint), "sprint",
                        scope, inhP, inhC, true, true);
                }
                case "milestone" -> inherit(SPRINT_AXES + "out('TARGETS_MILESTONE').milestone_id CONTAINS :id",
                    Map.of("id", id), "sprint", scope, inhP, inhC, true, true);
                case "component" -> inherit(SPRINT_AXES + "out('BELONGS_TO').component_id CONTAINS :id",
                    Map.of("id", id), "sprint", scope, inhP, inhC, true, false);
                case "release" -> inherit(SPRINT_AXES + "out('IMPLEMENTED_IN_RELEASE').release_uid CONTAINS :id",
                    Map.of("id", id), "sprint", scope, inhP, inhC, false, true);
                case "feature" -> {
                    java.util.Set<String> visited = new java.util.HashSet<>(List.of(id));
                    List<String> level = new ArrayList<>();
                    String parent = LoreRecordValues.str(values.get("parent"));
                    if (parent != null) level.add(parent);
                    for (int depth = 0; depth < 4 && !level.isEmpty(); depth++) {
                        List<String> next = new ArrayList<>();
                        for (String uc : level) {
                            if (!visited.add(uc)) continue;
                            List<Map<String, Object>> rows = ingestService.queryPublic(
                                "SELECT uc_id AS src_id, out('BELONGS_TO_PROJECT').slug AS projects, "
                                    + "out('BELONGS_TO').component_id AS components, in('DECOMPOSES_INTO').uc_id AS parents "
                                    + "FROM KnowUseCase WHERE uc_id = :id", Map.of("id", uc));
                            addSources(rows, "feature", scope, inhP, inhC, true, true);
                            for (Map<String, Object> r : rows) next.addAll(LoreRecordValues.arr(r.get("parents")));
                        }
                        level = next;
                    }
                }
                default -> { }
            }
        } catch (RuntimeException e) {
            LOG.warnf("[LORE RECORD] chips %s/%s: %s", type, id, e.getMessage());
            state.add(LoreRecordDataState.entry("chips:inherited", null, new Read(List.of(), "error",
                "унаследованные проекты/компоненты не прочитаны: " + e.getMessage(), e)));
        }
        Map<String, String> pLabels = labels("SELECT slug AS k, name AS v FROM KnowGitProject WHERE slug IN :ids",
            ids(ownP, inhP), "chips:project_labels", state);
        Map<String, String> cLabels = labels("SELECT component_id AS k, full_name AS v FROM LoreComponent WHERE component_id IN :ids",
            ids(ownC, inhC), "chips:component_labels", state);
        values.put("projects", LoreRecordChips.chips(ownP, inhP, pLabels));
        values.put("components", LoreRecordChips.chips(ownC, inhC, cLabels));
    }

    private void inherit(String sql, Map<String, Object> params, String fromType, Set<String> scope,
                         List<LoreRecordChips.Inherited> inhP, List<LoreRecordChips.Inherited> inhC,
                         boolean takeProjects, boolean takeComponents) {
        addSources(ingestService.queryPublic(sql, params), fromType, scope, inhP, inhC, takeProjects, takeComponents);
    }

    private static void addSources(List<Map<String, Object>> rows, String fromType, Set<String> scope,
                                   List<LoreRecordChips.Inherited> inhP, List<LoreRecordChips.Inherited> inhC,
                                   boolean takeProjects, boolean takeComponents) {
        List<Map<String, Object>> sorted = new ArrayList<>(rows);
        // Детерминированно: «первый источник» не зависит от порядка рёбер в базе.
        sorted.sort(java.util.Comparator.comparing(r -> String.valueOf(r.get("src_id"))));
        for (Map<String, Object> r : sorted) {
            String src = LoreRecordValues.str(r.get("src_id"));
            if (src == null) continue;
            List<String> projects = LoreRecordValues.arr(r.get("projects"));
            if (scope != null && projects.stream().noneMatch(scope::contains)) continue;
            if (takeProjects) for (String p : projects)
                if (scope == null || scope.contains(p)) inhP.add(new LoreRecordChips.Inherited(p, fromType, src));
            if (takeComponents) for (String c : LoreRecordValues.arr(r.get("components")))
                inhC.add(new LoreRecordChips.Inherited(c, fromType, src));
        }
    }

    private static List<String> ids(List<String> own, List<LoreRecordChips.Inherited> inh) {
        java.util.LinkedHashSet<String> all = new java.util.LinkedHashSet<>(own);
        for (LoreRecordChips.Inherited i : inh) all.add(i.id());
        return new ArrayList<>(all);
    }

    private Map<String, String> labels(String sql, List<String> keys, String source, List<Map<String, Object>> state) {
        Map<String, String> out = new LinkedHashMap<>();
        if (keys.isEmpty()) return out;
        try {
            for (Map<String, Object> r : ingestService.queryPublic(sql, Map.of("ids", keys))) {
                String k = LoreRecordValues.str(r.get("k"));
                String v = LoreRecordValues.str(r.get("v"));
                if (k != null && v != null) out.put(k, v);
            }
        } catch (RuntimeException e) {
            // Подписи не прочитаны — чип несёт id (подпись не выдумывается), сбой назван.
            state.add(LoreRecordDataState.entry(source, null, new Read(List.of(), "error", e.getMessage(), e)));
        }
        return out;
    }

    /**
     * S4-29: первая порция вкладки-связи, читаемой срезом. Больше {@link #TAB_FIRST_PAGE} строк —
     * отдаётся порция и {@code data_state: truncated} с {@code total}: остальное клиент берёт
     * тем же срезом через {@code /lore/slice} (limit/offset, SE-01). Порция не выдаётся за всё.
     */
    static final int TAB_FIRST_PAGE = 100;

    /**
     * Вкладка-связь отдельным срезом по описанию {@link LoreRecordFrom.SliceLink} (S4-MODEL-RECORD):
     * строки — связями общим сборщиком; у {@code paged} — только первая порция (S4-29).
     */
    private void tabBySlice(LoreRecordFrom.SliceLink sl, String id, Set<String> scope,
                            List<String> blocks, List<Map<String, Object>> dataState,
                            List<Map<String, Object>> links, Map<String, Object> facts) {
        String slice = sl.slice(), part = sl.key();
        Read r = read(slice, Map.of(sl.param(), id), scope);
        blocks.add(part);
        if (!r.ok()) {
            dataState.add(LoreRecordDataState.entry(slice, part, r));
            facts.put(part + "_error", r.error());
            return;
        }
        List<Map<String, Object>> rows = r.rows();
        int total = rows.size();
        boolean cut = sl.paged() && total > TAB_FIRST_PAGE;
        List<Map<String, Object>> page = cut ? rows.subList(0, TAB_FIRST_PAGE) : rows;
        for (Map<String, Object> row : page) links.add(LoreRecordFrom.sliceLink(sl, row));
        dataState.add(cut
            ? LoreRecordDataState.truncated(slice, part, page.size(), (long) total)
            : LoreRecordDataState.entry(slice, part, r));
    }

    private List<String> specStatuses(String type) {
        return "spec".equals(type) ? activeDictCodes("spec_status", LoreSpecResource.SPEC_STATUSES_FALLBACK) : null;
    }

    /** Чтение среза тем же compose и скоупом, что у /lore/slice. */
    private Read read(String slice, Map<String, String> given, Set<String> scope) {
        if (AidaLoreResource.scopeDenies(slice, scope))
            return new Read(List.of(), "denied", "проектный скоуп: у вызывающего нет разрешённых проектов — срез " + slice, null);
        try {
            LoreSlices.Composed c = LoreSlices.compose(slice, given, scope);
            return new Read(ingestService.queryPublic(c.sql(), c.params()), "ok", null, null);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE RECORD] slice=%s %s: %s", slice, given, e.getMessage());
            return new Read(List.of(), "error", slice + ": " + e.getMessage(), e);
        }
    }

    /**
     * MD-REQUIRED: schema с обязательностью полей — block из схемы БД (schema:types, кэш
     * {@link LoreFieldRequirement#schemaFacts}), warn из проверок качества MCP. Схема не
     * прочиталась — {@code requirements_block: unknown}, warn остаётся.
     */
    private Map<String, Object> recordSchema(String type) {
        LoreFieldRequirement.SchemaFacts facts = LoreFieldRequirement.schemaFacts(
            () -> ingestService.queryPublic("SELECT name, properties FROM schema:types", Map.of()));
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
        if (facts == null || g == null) return LoreRecordRegistry.schemaJson(type);
        java.util.Set<String> props = new java.util.LinkedHashSet<>(facts.props().getOrDefault(g.vertex(), List.of()));
        java.util.Set<String> req = new java.util.LinkedHashSet<>(facts.mandatory().getOrDefault(g.vertex(), java.util.Set.of()));
        if (g.hist() != null) {
            props.addAll(facts.props().getOrDefault(g.hist(), List.of()));
            req.addAll(facts.mandatory().getOrDefault(g.hist(), java.util.Set.of()));
        }
        return LoreRecordRegistry.schemaJson(type, props, req);
    }

    private static Map<String, Object> recordHead(String type, String id, String title, String status, String version) {
        Map<String, Object> rec = new LinkedHashMap<>();
        rec.put("type", type);
        rec.put("id", id);
        rec.put("title", title);
        rec.put("status", status);
        rec.put("version", version);
        return rec;
    }

    private static Map<String, Object> envelope(Map<String, Object> rec, Map<String, Object> values,
                                                List<Map<String, Object>> parts, List<Map<String, Object>> links,
                                                Map<String, Object> perms, Map<String, Object> facts,
                                                String type, List<String> blocks,
                                                List<Map<String, Object>> dataState) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("contract", CONTRACT);
        out.put("record", rec);
        out.put("values", values);
        out.put("parts", parts);
        out.put("links", links);
        out.put("perms", perms);
        out.put("facts", facts);
        out.put("schema", LoreRecordRegistry.schemaJson(type));
        Map<String, Object> sources = new LinkedHashMap<>();
        sources.put("block", new ArrayList<>(blocks));
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("facade", "server");
        meta.put("sources", sources);
        meta.put("data_state", new ArrayList<>(dataState));
        out.put("meta", meta);
        return out;
    }

    // ── POST relation ───────────────────────────────────────────────────────

    public record RelationRequest(String rel, String dir, String target, String action, String kind, String reason) {}

    @POST
    @Path("{type}/{id: .+}/relation")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response relation(@PathParam("type") String type, @PathParam("id") String id, RelationRequest req,
                             @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (!LoreRecordRegistry.TYPES.contains(type))
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(new LoreError("UNKNOWN_TYPE",
                "тип паспорта '" + type + "' не заведён; есть: " + LoreRecordRegistry.TYPES)));
        if (!SAFE_ID.matcher(id).matches()) return badParams("id contains illegal characters");
        if (req == null || req.rel() == null || req.target() == null || req.target().isBlank())
            return badParams("rel, dir, target required");
        String dir = req.dir() == null ? "out" : req.dir();
        String action = req.action() == null ? "add" : req.action();
        if (!"add".equals(action) && !"remove".equals(action)) return badParams("action must be add|remove");
        LoreRecordRelationRoutes.Route route = LoreRecordRelationRoutes.find(type, req.rel(), dir);
        if (route == null) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("error", "UNKNOWN_RELATION");
            body.put("detail", "у типа " + type + " нет пути привязки для " + req.rel() + ":" + dir);
            body.put("allowed", LoreRecordRelationRoutes.allowed(type));
            return noStore(Response.status(Response.Status.BAD_REQUEST).entity(body));
        }
        return dispatch(route, type, id, req.target().trim(), action, req, role);
    }

    /** Ровно один существующий обработчик на маршрут; {@code reversed} — запись на другом конце ребра. */
    Response dispatch(LoreRecordRelationRoutes.Route r, String type, String id, String target, String action,
                      RelationRequest req, String role) {
        String a = id, b = target;
        if (r.reversed()) { a = target; b = id; }
        return switch (r.handler()) {
            case SPRINT_DEP -> sprintTask.linkSprintDep(
                new LoreSprintTaskResource.SprintDepRequest(a, b, req.kind(), req.reason(), action), role);
            case SPRINT_PROJECT -> sprintTask.linkSprintProject(
                new LoreSprintTaskResource.SprintProjectRequest(a, b, action), role);
            case SPRINT_COMPONENT -> sprintTask.linkSprintComponent(
                new LoreSprintTaskResource.SprintComponentRequest(a, b, action), role);
            case SPRINT_MILESTONE -> milestoneResource.linkSprintMilestone(
                new LoreMilestoneResource.SprintMilestoneRequest(a, b, action), role);
            // IMPLEMENTED_IN идёт ADR → спринт: у ADR запись — a, у спринта (reversed) — тоже ADR в a.
            case ADR_SPRINT -> adrResource.linkAdr(new LoreAdrResource.AdrLinkRequest(a, b, null, null, action), role);
            case TASK_COMPONENT -> sprintTask.linkTaskComponent(
                new LoreSprintTaskResource.TaskComponentRequest(a, b, action), role);
            case TASK_ADR -> sprintTask.linkTaskAdr(new LoreSprintTaskResource.TaskAdrRequest(a, b, action), role);
            case TASK_PHASE -> sprintTask.linkTaskPhase(new LoreSprintTaskResource.TaskPhaseRequest(a, b, action), role);
            case TASK_PR -> sprintTask.linkTaskPr(new LoreSprintTaskResource.TaskPrRequest(a, b, null, action), role);
            // RAISED_IN / GATES идут от вопроса: вопрос — a (reversed), запись — b.
            case QUESTION_RAISED_IN -> questionResource.linkRaisedIn(
                new LoreQuestionResource.QRaisedInRequest(a, type, b, action), role);
            case QUESTION_GATES -> questionResource.linkGates(new LoreQuestionResource.QGatesRequest(a, b, action), role);
            case ADR_DEPENDS_ON -> adrResource.linkAdrDependsOn(new LoreAdrResource.AdrDependsOnLinkRequest(a, b, action), role);
            case ADR_SUPERSEDES -> adrResource.linkAdrSupersedes(
                new LoreAdrResource.AdrSupersedesLinkRequest(a, b, action), role);
            case ADR_COMPONENT -> adrResource.linkAdrComponent(new LoreAdrResource.AdrComponentLinkRequest(a, b, action), role);
            case ADR_PROJECT -> adrResource.linkAdrProject(new LoreAdrResource.AdrProjectLinkRequest(a, b, action), role);
            case ADR_TAG -> adrResource.linkAdrTag(new LoreAdrResource.AdrTagLinkRequest(a, b, action), role);
            case SPEC_COMPONENT -> specResource.linkSpec(new LoreSpecResource.SpecLinkRequest(a, "component", b, action), role);
            case SPEC_PROJECT -> specResource.linkSpec(new LoreSpecResource.SpecLinkRequest(a, "project", b, action), role);
        };
    }
}
