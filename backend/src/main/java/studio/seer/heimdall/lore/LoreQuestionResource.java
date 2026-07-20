package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * KnowQuestion write path — the open-questions register (ADR-LORE-020/021).
 *
 * Vertex-only, like KnowDecision (ADR-021 §SCD2): status / opened_date /
 * closed_date are plain vertex fields, NO KnowQuestionHist. `closed` is set
 * ONLY when a decision ANSWERS the question (the /question/answers link) — never
 * directly — so "closed without a closing decision" cannot happen. `deferred`
 * requires a non-empty trigger (otherwise the register rots into a dump).
 */
@Path("/lore")
public class LoreQuestionResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreQuestionResource.class);

    private static final java.util.Set<String> STATUSES = java.util.Set.of("open", "deferred", "closed", "dropped");

    public record QuestionCreateRequest(
        String question_id, String title, String body_md, String status,
        String trigger, String component_id, String due_date, String priority,
        String owner, String raised_by, String opened_date, String closed_date) {}

    @POST
    @Path("question")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createQuestion(QuestionCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.question_id() == null || req.question_id().isBlank())
            return badParams("question_id required");
        if (!SAFE_ID.matcher(req.question_id()).matches())
            return badParams("question_id contains illegal characters");
        if (req.status() != null && !STATUSES.contains(req.status()))
            return badParams("status must be one of open|deferred|closed|dropped");
        // closed is a consequence of an ANSWERS link, never set by hand.
        if ("closed".equals(req.status()))
            return badParams("status='closed' is set automatically via /question/answers, not directly");
        // deferred without a trigger is exactly the rot ADR-021 warns against.
        if ("deferred".equals(req.status()) && (req.trigger() == null || req.trigger().isBlank()))
            return badParams("status='deferred' requires a non-empty trigger");
        try {
            StringBuilder sql = new StringBuilder("UPDATE KnowQuestion SET question_id=:qid");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("qid", req.question_id());
            putIf(sql, p, "title",        ":title", req.title());
            putIf(sql, p, "body_md",      ":body",  req.body_md());
            putIf(sql, p, "status",       ":status", req.status());
            // `trigger` В ОБРАТНЫХ КАВЫЧКАХ — зарезервированное слово SQL ArcadeDB.
            // Без них запрос не парсится вовсе:
            //   CommandSQLParsingException: mismatched input ',' … trigger=:trig
            // Из-за этого статус deferred был НЕДОСТИЖИМ: D3 требует непустой
            // trigger, валидация выше не пускает deferred без него, а запись
            // самого trigger падала на разборе. Замкнутый круг, который не
            // проявлялся, пока никто не пробовал отложить вопрос по-настоящему
            // (первый случай — 2026-07-19, вопросов с trigger было ноль).
            putIf(sql, p, "`trigger`",    ":trig",  req.trigger());
            putIf(sql, p, "component_id", ":comp",  req.component_id());
            putIf(sql, p, "due_date",     ":due",   req.due_date());
            putIf(sql, p, "priority",     ":prio",  req.priority());
            putIf(sql, p, "owner",        ":owner", req.owner());
            putIf(sql, p, "raised_by",    ":rb",    req.raised_by());
            putIf(sql, p, "opened_date",  ":od",    req.opened_date());
            putIf(sql, p, "closed_date",  ":cd",    req.closed_date());
            sql.append(" UPSERT WHERE question_id=:qid");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            // Defaults on fresh insert: status=open, opened_date=today (only where null).
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowQuestion SET status='open' WHERE question_id=:qid AND status IS NULL",
                Map.of("qid", req.question_id()))).await().indefinitely();
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "UPDATE KnowQuestion SET opened_date=:d WHERE question_id=:qid AND opened_date IS NULL",
                Map.of("d", java.time.LocalDate.now().toString(), "qid", req.question_id()))).await().indefinitely();
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id())));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION CREATE] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── Links ────────────────────────────────────────────────────────────────

    public record QAnswersRequest(String decision_id, String question_id, String action) {}

    @POST
    @Path("question/answers")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkAnswers(QAnswersRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.decision_id() == null || req.question_id() == null)
            return badParams("decision_id and question_id required");
        if (!SAFE_ID.matcher(req.decision_id()).matches() || !SAFE_ID.matcher(req.question_id()).matches())
            return badParams("ids contain illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("ANSWERS", "@out.decision_id=:d AND @in.question_id=:q",
                    Map.of("d", req.decision_id(), "q", req.question_id()));
                // AL-26: инвариант «closed ⇔ на вопрос есть ANSWERS» должен работать
                // в ОБЕ стороны. Раньше remove снимал ребро и оставлял status=closed —
                // вопрос повисал закрытым без единого ответа, и состояние врало.
                //
                // Возвращаем в open ТОЛЬКО когда снят ПОСЛЕДНИЙ ответ: если у вопроса
                // остаются другие ANSWERS, он закрыт по праву. Условие `in('ANSWERS').size()=0`
                // проверяет это на самой вершине, а не доверяет тому, что снятое ребро
                // было единственным.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowQuestion SET status='open', closed_date=null " +
                    "WHERE question_id=:q AND status='closed' AND in('ANSWERS').size()=0",
                    Map.of("q", req.question_id()))).await().indefinitely();
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE ANSWERS FROM (SELECT FROM KnowDecision WHERE decision_id=:d) " +
                    "TO (SELECT FROM KnowQuestion WHERE question_id=:q) IF NOT EXISTS",
                    Map.of("d", req.decision_id(), "q", req.question_id()))).await().indefinitely();
                // The invariant: a question is closed exactly when a decision answers it.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowQuestion SET status='closed', closed_date=:cd " +
                    "WHERE question_id=:q AND status <> 'closed'",
                    Map.of("cd", java.time.LocalDate.now().toString(), "q", req.question_id()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id(),
                "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION ANSWERS] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record QRaisedInRequest(String question_id, String target_type, String target_id, String action) {}

    @POST
    @Path("question/raised_in")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkRaisedIn(QRaisedInRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.question_id() == null || req.target_type() == null || req.target_id() == null)
            return badParams("question_id, target_type and target_id required");
        if (!SAFE_ID.matcher(req.question_id()).matches() || !SAFE_ID.matcher(req.target_id()).matches())
            return badParams("ids contain illegal characters");
        // target_type → (vertex type, id field)
        String type, field;
        switch (req.target_type()) {
            case "adr":    type = "KnowADR";    field = "adr_id";    break;
            case "sprint": type = "KnowSprint"; field = "sprint_id"; break;
            case "task":   type = "KnowTask";   field = "task_uid";  break;
            default: return badParams("target_type must be adr|sprint|task");
        }
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("RAISED_IN", "@out.question_id=:q AND @in." + field + "=:t",
                    Map.of("q", req.question_id(), "t", req.target_id()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE RAISED_IN FROM (SELECT FROM KnowQuestion WHERE question_id=:q) " +
                    "TO (SELECT FROM " + type + " WHERE " + field + "=:t) IF NOT EXISTS",
                    Map.of("q", req.question_id(), "t", req.target_id()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id(),
                "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION RAISED_IN] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record QGatesRequest(String question_id, String task_uid, String action) {}

    @POST
    @Path("question/gates")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkGates(QGatesRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.question_id() == null || req.task_uid() == null)
            return badParams("question_id and task_uid required");
        if (!SAFE_ID.matcher(req.question_id()).matches() || !SAFE_ID.matcher(req.task_uid()).matches())
            return badParams("ids contain illegal characters");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("GATES", "@out.question_id=:q AND @in.task_uid=:t",
                    Map.of("q", req.question_id(), "t", req.task_uid()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE GATES FROM (SELECT FROM KnowQuestion WHERE question_id=:q) " +
                    "TO (SELECT FROM KnowTask WHERE task_uid=:t) IF NOT EXISTS",
                    Map.of("q", req.question_id(), "t", req.task_uid()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id(),
                "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION GATES] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record QComponentRequest(String question_id, String component_id, String action) {}

    @POST
    @Path("question/component")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkComponent(QComponentRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.question_id() == null || req.component_id() == null)
            return badParams("question_id and component_id required");
        if (!SAFE_ID.matcher(req.question_id()).matches() || !SAFE_ID.matcher(req.component_id()).matches())
            return badParams("ids contain illegal characters");
        // T43: components are now MULTI, via BELONGS_TO edges (like tasks) — add/remove.
        // The legacy component_id vertex field is kept in sync as the "primary" (first) one.
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("BELONGS_TO", "@out.question_id=:q AND @in.component_id=:c",
                    Map.of("q", req.question_id(), "c", req.component_id()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO FROM (SELECT FROM KnowQuestion WHERE question_id=:q) " +
                    "TO (SELECT FROM LoreComponent WHERE component_id=:c) IF NOT EXISTS",
                    Map.of("q", req.question_id(), "c", req.component_id()))).await().indefinitely();
                // keep the legacy single field pointing at the primary component if unset
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowQuestion SET component_id=:c WHERE question_id=:q AND component_id IS NULL",
                    Map.of("c", req.component_id(), "q", req.question_id()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id(),
                "component_id", req.component_id(), "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION COMPONENT] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    public record QProjectRequest(String question_id, String project, String action) {}

    @POST
    @Path("question/project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkProject(QProjectRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.question_id() == null || req.project() == null)
            return badParams("question_id and project required");
        if (!SAFE_ID.matcher(req.question_id()).matches())
            return badParams("question_id contains illegal characters");
        // T43: questions belong to one or more git projects (multi) via BELONGS_TO_PROJECT.
        boolean remove = "remove".equalsIgnoreCase(req.action());
        try {
            if (remove) {
                deleteEdges("BELONGS_TO_PROJECT", "@out.question_id=:q AND @in.slug=:p",
                    Map.of("q", req.question_id(), "p", req.project()));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowQuestion WHERE question_id=:q) " +
                    "TO (SELECT FROM KnowGitProject WHERE slug=:p) IF NOT EXISTS",
                    Map.of("q", req.question_id(), "p", req.project()))).await().indefinitely();
            }
            return noStore(Response.ok(Map.of("ok", true, "question_id", req.question_id(),
                "project", req.project(), "action", remove ? "removed" : "added")));
        } catch (Exception e) {
            LOG.warnf("[LORE QUESTION PROJECT] %s: %s", req.question_id(), e.getMessage());
            return upstream(e);
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private static void putIf(StringBuilder sql, Map<String, Object> p, String col, String bind, Object val) {
        if (val != null) { sql.append(", ").append(col).append('=').append(bind); p.put(bind.substring(1), val); }
    }

    private void deleteEdges(String edgeType, String where, Map<String, Object> params) {
        List<Map<String, Object>> edges = ingestService.queryPublic(
            "SELECT @rid FROM " + edgeType + " WHERE " + where, params);
        for (Map<String, Object> e : edges) {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "DELETE FROM " + edgeType + " WHERE @rid=" + e.get("@rid").toString(), null)).await().indefinitely();
        }
    }

    private Response upstream(Exception e) {
        return noStore(Response.status(Response.Status.BAD_GATEWAY)
            .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
    }
}
