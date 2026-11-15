package studio.seer.heimdall.lore;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_MD_ARCHIVE/MDA-02 — {@code GET /lore/export/project/{owner}/{repo}}: текущее
 * состояние проекта zip-архивом папки .md под Obsidian (раскладка — {@link LoreVaultExport}).
 *
 * <ul>
 *   <li>Незарегистрированный проект — 404. Проект, в котором у вызывающего нет роли, — 403
 *       со словами, а не пустой архив (тем же резолвером, что проектный скоуп слайсов,
 *       {@code callerAllowedProjects}; superadmin/admin и выключенный вход — без ограничения).</li>
 *   <li>Списки — проектными срезами ({@code project_*}); тела — фасадом паспорта
 *       ({@code /lore/record}), который знает, где у типа лежит тело (вершина или открытая
 *       версия SCD2), и обнуляет тело без права. Задачи — одним запросом, тело из ОТКРЫТОЙ
 *       версии истории.</li>
 *   <li>Срез или тело, которые не прочитались, — строка «не прочитано» в index.md, а не ноль.</li>
 * </ul>
 */
@Path("/lore/export")
public class LoreVaultExportResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreVaultExportResource.class);
    private static final Pattern SLUG = Pattern.compile("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+");

    @Inject AidaLoreResource sliceResource;
    @Inject LoreRecordResource recordResource;
    @Inject LoreIngestService ingest;

    /** Тип архива → (срез списка, поле id в строке, тип паспорта). */
    static final Map<String, String[]> LISTS = lists();

    private static Map<String, String[]> lists() {
        Map<String, String[]> m = new LinkedHashMap<>();
        m.put("sprint", new String[]{"project_sprints", "sprint_id", "sprint"});
        m.put("adr", new String[]{"project_adrs", "adr_id", "adr"});
        m.put("decision", new String[]{"project_decisions", "decision_id", "decision"});
        m.put("spec", new String[]{"project_specs", "spec_id", "spec"});
        m.put("doc", new String[]{"project_docs", "doc_id", "doc"});
        m.put("runbook", new String[]{"project_runbooks", "runbook_id", "runbook"});
        m.put("release", new String[]{"project_releases", "release_uid", "release"});
        m.put("question", new String[]{"project_questions", "question_id", "question"});
        m.put("component", new String[]{"project_components", "component_id", "component"});
        return m;
    }

    /** Задачи спринтов проекта: тело и статус — из ОТКРЫТОЙ версии истории (valid_to IS NULL). */
    static final String TASKS_SQL =
        "SELECT task_uid, title, " +
        "out('HAS_STATE')[valid_to IS NULL].status_raw[0] AS status_raw, " +
        "out('HAS_STATE')[valid_to IS NULL].note_md[0] AS note_md, " +
        "out('HAS_STATE')[valid_to IS NULL].effort_days[0] AS effort_days " +
        "FROM KnowTask WHERE out('PART_OF').sprint_id[0] IN :sprint_ids";

    @GET
    @Path("project/{owner}/{repo}")
    @Produces("application/zip")
    @io.smallrye.common.annotation.Blocking
    public Response exportProject(@PathParam("owner") String owner, @PathParam("repo") String repo,
                                  @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        String slug = owner + "/" + repo;
        if (!SLUG.matcher(slug).matches()) return badParams("project slug must be owner/repo");
        List<Map<String, Object>> project = rows("project_by_id", Map.of("project", slug));
        if (project.isEmpty())
            return noStore(Response.status(Response.Status.NOT_FOUND).type("application/json")
                .entity(new LoreError("PROJECT_NOT_FOUND", "проект «" + slug + "» не зарегистрирован в LORE")));
        Set<String> allowed = sliceResource.callerAllowedProjects(role);
        if (allowed != null && !allowed.contains(slug))
            return noStore(Response.status(Response.Status.FORBIDDEN).type("application/json")
                .entity(new LoreError("PROJECT_FORBIDDEN", "нет роли в проекте «" + slug + "» — выгрузка недоступна")));

        List<LoreVaultExport.Rec> recs = new ArrayList<>();
        Map<String, String> unreadable = new TreeMap<>();
        int[] hidden = {0};
        List<String> sprintIds = new ArrayList<>();
        for (Map.Entry<String, String[]> t : LISTS.entrySet()) {
            List<Map<String, Object>> list;
            try {
                list = rowsOrThrow(t.getValue()[0], Map.of("project", slug));
            } catch (RuntimeException e) {
                unreadable.put(t.getKey(), "срез " + t.getValue()[0] + " не ответил (" + e.getClass().getSimpleName() + ")");
                continue;
            }
            for (Map<String, Object> row : list) {
                String id = val(row.get(t.getValue()[1]));
                if (id == null) continue;
                if ("sprint".equals(t.getKey())) sprintIds.add(id);
                recs.add(fromFacade(t.getKey(), t.getValue()[2], id, row, role, unreadable, hidden));
            }
        }
        if (!sprintIds.isEmpty()) {
            try {
                for (Map<String, Object> row : ingest.queryPublic(TASKS_SQL, Map.of("sprint_ids", sprintIds))) {
                    String uid = val(row.get("task_uid"));
                    if (uid == null) continue;
                    Map<String, Object> f = new TreeMap<>();
                    if (row.get("effort_days") instanceof Number n) f.put("effort_days", n);
                    recs.add(new LoreVaultExport.Rec("task", uid, val(row.get("title")),
                        LoreStatusResource.rawToToken(val(row.get("status_raw"))), val(row.get("note_md")), f));
                }
            } catch (RuntimeException e) {
                unreadable.put("task", "задачи спринтов не прочитаны (" + e.getClass().getSimpleName() + ")");
            }
        }
        String name = val(project.get(0).get("name"));
        Map<String, String> files = LoreVaultExport.build(new LoreVaultExport.Input(slug,
            name == null ? repo : name, recs, unreadable, hidden[0]));
        byte[] zip = LoreVaultExport.zip(files);
        // Не noStore(): он всегда ставит application/json. Тот же Cache-Control — руками.
        return Response.ok(zip, "application/zip")
            .header("Cache-Control", "no-store")
            .header("Content-Disposition", "attachment; filename=\"" + owner + "__" + repo + ".zip\"")
            .build();
    }

    /** Запись через фасад паспорта: тело — поля группы body; обнулённое правами тело считается «скрыто». */
    @SuppressWarnings("unchecked")
    private LoreVaultExport.Rec fromFacade(String type, String recordType, String id, Map<String, Object> row,
                                           String role, Map<String, String> unreadable, int[] hidden) {
        String title = first(row, "title", "name", "full_name", "version");
        String status = first(row, "status", "status_raw");
        StringBuilder body = new StringBuilder();
        try {
            Response r = recordResource.record(recordType, id, role);
            if (r.getStatus() == 200 && r.getEntity() instanceof Map<?, ?> env) {
                Map<String, Object> values = (Map<String, Object>) env.get("values");
                Map<String, Object> rec = (Map<String, Object>) env.get("record");
                if (rec != null) {
                    if (rec.get("title") != null) title = val(rec.get("title"));
                    if (rec.get("status") != null) status = val(rec.get("status"));
                }
                if (Boolean.TRUE.equals(env.get("body_redacted")) || (values != null && Boolean.TRUE.equals(values.get("body_redacted")))) {
                    hidden[0]++;
                    body.append("> Тело скрыто правами: нет роли в проекте записи.\n");
                } else if (values != null && env.get("schema") instanceof Map<?, ?> schema
                        && schema.get("fields") instanceof List<?> fields) {
                    for (Object o : fields) {
                        if (!(o instanceof Map<?, ?> fd) || !"body".equals(fd.get("group"))) continue;
                        Object v = values.get(String.valueOf(fd.get("key")));
                        if (v == null || String.valueOf(v).isBlank()) continue;
                        body.append("## ").append(fd.get("label")).append("\n\n").append(v).append("\n\n");
                    }
                }
            } else {
                unreadable.merge(type, "тело " + id + " не прочитано (HTTP " + r.getStatus() + ")", (a, b) -> a);
            }
        } catch (RuntimeException e) {
            LOG.warnf("[LORE EXPORT] %s/%s: %s", type, id, e.getClass().getSimpleName());
            unreadable.merge(type, "тело " + id + " не прочитано (" + e.getClass().getSimpleName() + ")", (a, b) -> a);
        }
        return new LoreVaultExport.Rec(type, id, title, status, body.toString().strip(), Map.of());
    }

    private List<Map<String, Object>> rows(String slice, Map<String, String> params) {
        try {
            return rowsOrThrow(slice, params);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE EXPORT] срез %s: %s", slice, e.getClass().getSimpleName());
            return List.of();
        }
    }

    private List<Map<String, Object>> rowsOrThrow(String slice, Map<String, String> params) {
        LoreSlices.Composed c = LoreSlices.compose(slice, params);
        return ingest.queryPublic(c.sql(), c.params());
    }

    private static String first(Map<String, Object> row, String... keys) {
        for (String k : keys) if (row.get(k) != null) return String.valueOf(row.get(k));
        return null;
    }

    /** Строка или null — в отличие от str() базы, отсутствие значения не превращается в пустую строку. */
    private static String val(Object o) { return o == null ? null : String.valueOf(o); }
}
