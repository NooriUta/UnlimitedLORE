package studio.seer.heimdall.lore;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import studio.seer.heimdall.bench.MartQuery;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The cross-entity status-transition engine (B2 God-class split). Handles
 * generic SCD2 status flips for sprint/task/phase plus the direct (non-SCD2)
 * ADR status setter, batch status updates, and sprint plan-field edits — all
 * genuinely cross-cutting concerns that don't belong to any single CRUD
 * domain. Shares infra via LoreResourceBase.
 */
@Path("/lore")
public class LoreStatusResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreStatusResource.class);

    @jakarta.inject.Inject
    LoreHashStamper hashStamper; // SV-10: content_hash на открытой Hist-строке после записи тел

    @jakarta.inject.Inject
    UcReadinessCalculator readiness; // PL-15 (D17): готовность сценария — из задач

    /** QG-16: reason — причина блокировки спринта (текст), пишется на открывшуюся строку истории. */
    /** S2-09: expected — «было» (токен или status_raw); не совпало с открытой версией → 409 CONFLICT. */
    public record StatusUpdateRequest(String entity_type, String id, String status, String reason, String expected) {
        public StatusUpdateRequest(String entity_type, String id, String status) { this(entity_type, id, status, null, null); }
        public StatusUpdateRequest(String entity_type, String id, String status, String reason) { this(entity_type, id, status, reason, null); }
    }

    /**
     * SPRINT_QG_REBUILD/QG-16, владелица 06.11: «главное чтобы инструмент знал
     * причину». Блокировка спринта без текста причины не отклоняется (объяснением
     * может служить и незакрытая зависимость, и открытый вопрос — их видит гейт
     * QG-LORE-BLOCKED-REASON), но ответ говорит об этом прямо, а не молчит.
     */
    /**
     * SPRINT_QG_REBUILD/QG-17, владелица 06.11: «связь не должна сниматься, но должна
     * помечаться как solved». Задача закрыта (done|cancelled) — входящие GATES получают
     * solved_at; задача снова открыта — метка снимается. Ребро не удаляется никогда.
     */
    static String gatesSolvedSql(String status) {
        boolean closed = "done".equals(status) || "cancelled".equals(status);
        return closed
            ? "UPDATE GATES SET solved_at = :now WHERE @in.task_uid = :id AND solved_at IS NULL"
            : "UPDATE GATES SET solved_at = null WHERE @in.task_uid = :id AND solved_at IS NOT NULL";
    }

    static String blockReasonHint(String entityType, String status, String reason) {
        if (!"sprint".equals(entityType) || !"blocked".equals(status)) return null;
        if (reason != null && !reason.isBlank()) return null;
        return "блокировка без причины: передайте reason (текст) — или объяснением должна служить "
            + "незакрытая зависимость (DEPENDS_ON) либо открытый вопрос; иначе гейт QG-LORE-BLOCKED-REASON "
            + "покажет спринт как «блокировка без объяснения»";
    }
    /**
     * Сторож закрытия спринта ({@link SprintCloseGuard}): переход в done/cancelled при
     * открытых задачах — 409 SPRINT_HAS_OPEN_TASKS; иначе {@code null}. Блокирующее
     * чтение — на рабочем пуле.
     */
    Uni<Response> sprintCloseRefusal(String sprintId, String status) {
        if (!SprintCloseGuard.closing(status)) return Uni.createFrom().nullItem();
        return Uni.createFrom().item(() -> {
                List<Map<String, Object>> open = SprintCloseGuard.openTasks(
                    ingestService.queryPublic(SprintCloseGuard.TASKS_SQL, Map.of("sid", sprintId)));
                return open.isEmpty() ? null : noStore(Response.status(Response.Status.CONFLICT)
                    .entity(SprintCloseGuard.conflictBody(sprintId, status, open)));
            })
            .runSubscriptionOn(io.smallrye.mutiny.infrastructure.Infrastructure.getDefaultWorkerPool());
    }

    record StatusRevision(String valid_from, String plan_version) {}
    public record StatusUpdateResponse(
        boolean ok, String entity_type, String id,
        String old_status, String new_status, StatusRevision revision) {}
    public record BatchStatusRequest(String entity_type, List<String> ids, String status) {}

    // ── Write-path: status update (SCD2) ────────────────────────────────────

    @POST
    @Path("status")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> updateStatus(StatusUpdateRequest req,
                                      @HeaderParam("X-Seer-Role") String role,
                                      @HeaderParam(AgentMachine.HEADER) String machineHeader) {
        if (!enabled) return Uni.createFrom().item(disabled());
        if (!"admin".equals(role) && !"superadmin".equals(role)) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.FORBIDDEN)
                .entity(new LoreError("FORBIDDEN", "admin role required"))));
        }
        if (req == null || req.entity_type() == null || req.id() == null || req.status() == null) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "entity_type, id, status required"))));
        }
        if (!ENTITY_TYPES.contains(req.entity_type())) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "entity_type must be one of: " + ENTITY_TYPES))));
        }
        if (!SAFE_ID.matcher(req.id()).matches()) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "id contains illegal characters"))));
        }
        if ("adr".equals(req.entity_type())) {
            if (!ADR_STATUSES.contains(req.status().toLowerCase())) {
                return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                    .entity(new LoreError("BAD_PARAMS", "adr status must be one of: " + ADR_STATUSES))));
            }
        } else if (!PLAN_STATUSES.contains(req.status())) {
            return Uni.createFrom().item(noStore(Response.status(Response.Status.BAD_REQUEST)
                .entity(new LoreError("BAD_PARAMS", "unknown status: " + req.status()))));
        }
        String now  = Instant.now().toString();
        String nsid = UUID.randomUUID().toString();
        // S2-12: автор версии — из проверенного токена, снят до асинхронной цепочки.
        final ChangeAuthor author = changeAuthor();
        // AO-MACHINE-OBJ: машина агента — в ответ (привязку в графе делает AgentMachineFilter
        // на любой мутации; здесь — чтобы агент видел «машина не указана» в самом ответе).
        // AO-REVIEWER-AUTHOR: ревьюер задачи — после смены статуса, ниже. Значения могут
        // быть null (machine_id без машины), поэтому синхронизированный LinkedHashMap.
        final Map<String, Object> extras = java.util.Collections.synchronizedMap(new LinkedHashMap<>());
        Uni<Response> flip = switch (req.entity_type()) {
            // Read the currently-open row's plan fields (priority/planned_*/track_id)
            // BEFORE the SCD2 flip, then restore them onto the freshly-opened row —
            // updateScd2Status's INSERT only carries state_uid/status_raw/valid_from,
            // so without this a status change would silently wipe planning data.
            // D-2026-LORE-SPRINT-CLOSE-NEEDS-TASKS-CLOSED (ADR-LORE-047 A5): закрыть или
            // отменить спринт с открытыми задачами нельзя — 409 со списком до любой записи.
            case "sprint"    -> sprintCloseRefusal(req.id(), req.status()).chain(refusal -> refusal != null
                                  ? Uni.createFrom().item(refusal)
                                  : readSprintPlanFields(req.id())
                                  .chain(fields -> updateScd2Status("sprint", "KnowSprint", "KnowSprintHist",
                                    "sprint_id", req.id(), req.status(), now, nsid, req.expected(), author)
                                  .chain(resp -> resp.getStatus() >= 300
                                    ? Uni.createFrom().item(resp)
                                    // Best-effort: the status flip above already succeeded and is
                                    // the primary outcome the caller asked for. A failure restoring
                                    // plan fields (priority/planned_*/track_id/pr_refs) onto the new
                                    // hist row is a secondary consistency nicety — surface it in
                                    // logs, but don't turn an already-successful status change into
                                    // an opaque 500 for the caller.
                                    : restoreSprintPlanFields(nsid, fields)
                                        .onFailure().invoke(ex -> LOG.warnf(
                                            "[LORE STATUS] sprint=%s plan-field restore failed (status flip itself succeeded): %s",
                                            req.id(), ex.getMessage()))
                                        .onFailure().recoverWithItem(new LoreCommandClient.LoreCommandResult(null))
                                        .chain(__ -> withBlockReason(resp, req, nsid)))));
            // ADR-LORE-014 §4: →done is gated — refuse self-acceptance (reviewer_agent
            // unset or equal to executor_agent) BEFORE the SCD2 flip. Every other task
            // transition is ungated (RBAC-only, per the ADR's "one hard-gate" decision).
            case "task"      -> ("done".equals(req.status())
                                    ? checkTaskDoneGate(req.id(), role)
                                    : Uni.createFrom().<Response>item((Response) null))
                                  .chain(gate -> gate != null
                                    ? Uni.createFrom().item(gate)
                                    : readTaskHistCarryFields(req.id())
                                        .chain(fields -> updateScd2Status("task", "KnowTask", "KnowTaskHist",
                                          "task_uid", req.id(), req.status(), now, nsid, req.expected(), author)
                                        .chain(resp -> resp.getStatus() >= 300
                                          ? Uni.createFrom().item(resp)
                                          : restoreTaskHistFields(nsid,
                                                (String) fields.get("note_md"),
                                                fields.get("effort_days") == null ? null
                                                    : ((Number) fields.get("effort_days")).doubleValue())
                                              .onFailure().invoke(ex -> LOG.warnf(
                                                  "[LORE STATUS] task=%s note/effort carry-forward failed (status flip itself succeeded): %s",
                                                  req.id(), ex.getMessage()))
                                              .onFailure().recoverWithItem(new LoreCommandClient.LoreCommandResult(null))
                                              .replaceWith(resp))));
            // MCP-PHASES: same SCD2 flip as sprint/task — KnowPhase carries HAS_STATE → KnowPhaseHist
            case "phase"     -> updateScd2Status("phase", "KnowPhase", "KnowPhaseHist",
                                    "phase_uid", req.id(), req.status(), now, nsid, req.expected(), author);
            // S2-13: статус ADR — новая версия KnowADRHist (раньше — голый UPDATE поля
            // вершины, в истории его не было; §7.3 новостей считался диапазоном).
            case "adr"       -> updateScd2Status("adr", "KnowADR", "KnowADRHist",
                                    "adr_id", req.id(), req.status(), now, nsid, req.expected(), author);
            default          -> Uni.createFrom().item(noStore(Response.status(501)
                                    .entity(new LoreError("NOT_IMPLEMENTED",
                                        req.entity_type() + " not supported yet"))));
        };
        // SV-10: у задач carry-forward несёт note_md, но не content_hash — доштамповать
        // на свежеоткрытой строке (спринт несёт хэш через SPRINT_PLAN_FIELDS).
        // PL-15 (D17): готовность сценария выводится ИЗ ЗАДАЧ, поэтому пересчёт
        // живёт ровно здесь — в единственной точке, где статус задачи меняется.
        // Вешать его на чтение нельзя: shipped_at всё равно требует записи, а
        // два источника правды разъезжаются.
        //
        // runSubscriptionOn(worker) обязателен. Вычислитель ходит в БД
        // блокирующими вызовами, и на IO-потоке они падают — а падение здесь
        // проглатывается (пересчёт вторичен по отношению к самой смене
        // статуса), то есть без переезда на worker-пул он молча не работал бы
        // вовсе. Ровно так первая редакция и вела себя: тесты показали статус
        // «proposed» там, где ждали «shipped», без единой ошибки в ответе.
        final Map<String, Object> machine = AgentMachine.answerFields(AgentMachine.judge(author, machineHeader, false));
        return flip.chain(r -> {
            if (r == null || r.getStatus() >= 300 || !"task".equals(req.entity_type()))
                return Uni.createFrom().item(r);
            return Uni.createFrom().item(() -> {
                    hashStamper.stampOpenHist("KnowTaskHist", "KnowTask", "task_uid", req.id());
                    extras.put("reviewer", fillReviewer(req.id(), author));
                    readiness.recomputeForTask(req.id());
                    // QG-17: связь «вопрос держит задачу» не снимается, а помечается решённой.
                    try {
                        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                            gatesSolvedSql(req.status()), Map.of("id", req.id(), "now", now)))
                            .await().indefinitely();
                    } catch (Exception ex) {
                        LOG.warnf("[LORE STATUS] task=%s GATES solved_at не обновлён (статус сменён): %s",
                            req.id(), ex.getMessage());
                    }
                    return r;
                })
                .runSubscriptionOn(io.smallrye.mutiny.infrastructure.Infrastructure.getDefaultWorkerPool())
                // A sprint shouldn't stay in `planned` once its tasks are moving —
                // recompute + persist the parent sprint's status. Best-effort: a
                // failure here is logged, never turned into a failed task change.
                .chain(rr -> autoDeriveSprintStatus(req.id(), author)
                    .onFailure().invoke(ex -> LOG.warnf(
                        "[LORE STATUS] sprint auto-derive failed for task=%s (task flip itself succeeded): %s",
                        req.id(), ex.getMessage()))
                    .onFailure().recoverWithItem((Void) null)
                    .replaceWith(rr));
        }).map(r -> {
            synchronized (extras) { extras.putAll(machine); }
            return withExtras(r, extras);
        });
    }

    /**
     * Добавить к успешному ответу status_set поля сверх основных (reviewer, machine_id,
     * machine_warning). Пусто — ответ не трогаем: форма прежняя (StatusUpdateResponse).
     */
    static Response withExtras(Response r, Map<String, Object> extras) {
        if (r == null || r.getStatus() >= 300 || extras == null || extras.isEmpty()) return r;
        Map<String, Object> out = new LinkedHashMap<>();
        if (r.getEntity() instanceof StatusUpdateResponse s) {
            out.put("ok", s.ok()); out.put("entity_type", s.entity_type()); out.put("id", s.id());
            out.put("old_status", s.old_status()); out.put("new_status", s.new_status()); out.put("revision", s.revision());
        } else if (r.getEntity() instanceof Map<?, ?> m) {
            m.forEach((k, v) -> out.put(String.valueOf(k), v));
        } else {
            return r;
        }
        synchronized (extras) { out.putAll(extras); }
        return noStore(Response.ok(out));
    }

    @jakarta.inject.Inject
    TaskRoleService roleService; // AO-REVIEWER-AUTHOR: единственная точка записи роли

    /**
     * AO-REVIEWER-AUTHOR: ревьюера на задаче нет — поставить человека-инициатора
     * (агент → его владелец, человек → он сам; {@link ReviewerFill}). Блокирующий —
     * звать с worker-потока. Вторичен по отношению к смене статуса: сбой — в ответ
     * и в лог, но статус уже сменён и не откатывается.
     */
    Map<String, Object> fillReviewer(String taskUid, ChangeAuthor author) {
        try {
            List<String> current = roleService.currentHolders(taskUid, TaskRole.REVIEWER);
            List<String> humans = new java.util.ArrayList<>();
            ReviewerFill.Query q = current.isEmpty() ? ReviewerFill.resolveQuery(author) : null;
            if (q != null) {
                for (Map<String, Object> row : ingestService.queryPublic(q.sql(), q.params())) {
                    Object n = row.get("names");
                    if (n instanceof java.util.Collection<?> c) c.forEach(x -> { if (x != null) humans.add(String.valueOf(x)); });
                    else if (n != null) humans.add(String.valueOf(n));
                }
            }
            ReviewerFill.Decision d = ReviewerFill.decide(author, current, humans);
            Map<String, Object> applied = null;
            if (d.action() == ReviewerFill.Action.FILL) {
                TaskRoleService.Result res = roleService.apply(new TaskRoleService.RoleRequest(
                    taskUid, TaskRole.REVIEWER, d.identity(), null, null, null, null));
                applied = new LinkedHashMap<>(res.body());
                if (!res.applied()) applied.put("outcome", "noop");
            }
            return ReviewerFill.answer(d, applied);
        } catch (RuntimeException e) {
            LOG.warnf("[LORE STATUS] task=%s ревьюер не подставлен (статус сменён): %s", taskUid, e.getMessage());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("outcome", "error");
            out.put("reason", "ревьюер не подставлен: " + LoreUpstream.detail(e));
            return out;
        }
    }

    /**
     * QG-16: причина блокировки — на ТОЛЬКО ЧТО открытую строку истории (state_uid = nsid).
     * Новая строка открывается на каждую смену статуса и block_reason не переносит
     * (его нет в SPRINT_PLAN_FIELDS), поэтому при разблокировке причина уходит
     * вместе с состоянием, которому принадлежала.
     */
    private Uni<Response> withBlockReason(Response resp, StatusUpdateRequest req, String nsid) {
        if (!"blocked".equals(req.status())) return Uni.createFrom().item(resp);
        String hint = blockReasonHint("sprint", req.status(), req.reason());
        Uni<Void> write = hint != null ? Uni.createFrom().voidItem()
            : writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE KnowSprintHist SET block_reason = :r WHERE state_uid = :nsid",
                    Map.of("r", req.reason().trim(), "nsid", nsid)))
                .replaceWithVoid();
        return write.map(__ -> {
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            if (resp.getEntity() instanceof StatusUpdateResponse s) {
                out.put("ok", s.ok()); out.put("entity_type", s.entity_type()); out.put("id", s.id());
                out.put("old_status", s.old_status()); out.put("new_status", s.new_status()); out.put("revision", s.revision());
            }
            if (hint != null) out.put("hint", hint); else out.put("block_reason", req.reason().trim());
            return noStore(Response.ok(out));
        });
    }

    /**
     * SCD2 status flip for KnowSprint / KnowTask:
     *   1. close the current open state row (valid_to = now)
     *   2. insert a new {@code <histType>} state row (valid_from = now, status_raw = mapped)
     *   3. link it: CREATE EDGE HAS_STATE entity → new state
     *   4. denormalise the current status_raw onto the entity vertex
     * Entities with no open state row (some backfilled tasks) skip step 1.
     *
     * Package-private (not private): ADR-LORE-013's task/move endpoint
     * (LoreSprintTaskResource) reuses this — plus the two task carry-forward
     * helpers below — to cancel the source task via the exact same SCD2 flip
     * every other status change goes through, instead of duplicating the
     * transition logic. LoreStatusResource stays the sole owner of the
     * mechanism; callers inject this class as a bean (same pattern as
     * ingestService) and call through it.
     */
    Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid) {
        return updateScd2Status(entityType, vertexType, histType, keyField, id, token, now, nsid, null, changeAuthor());
    }

    /** S2-12: то же от имени явного автора (task/move, авто-вывод статуса спринта). */
    Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid, ChangeAuthor author) {
        return updateScd2Status(entityType, vertexType, histType, keyField, id, token, now, nsid, null, author);
    }

    /**
     * S2-09: то же с оптимистической блокировкой. Закрытие открытой версии условно
     * (ещё открыта; при expected — ещё и прежний статус); иначе 409 CONFLICT с
     * текущим состоянием и без единой записи.
     */
    Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid, String expected) {
        return updateScd2Status(entityType, vertexType, histType, keyField, id, token, now, nsid, expected, changeAuthor());
    }

    /**
     * S2-09 + S2-12: оптимистическая блокировка и автор новой версии. author — из
     * проверенного токена ({@link ChangeAuthor#of}), снятый в начале запроса.
     */
    Uni<Response> updateScd2Status(String entityType, String vertexType, String histType,
                                           String keyField, String id, String token,
                                           String now, String nsid, String expected,
                                           ChangeAuthor author) {
        // S2-13: единственный путь смены статуса — StatusHistoryService.transition.
        // vertexType/histType/keyField остаются в сигнатуре ради вызывающих
        // (task/move, авто-вывод спринта); тип элемента определяет реестр сервиса.
        // Сервис сам проверяет существование вершины (404 вместо осиротевшей
        // строки), закрывает версию условно (409, S2-09), переносит ВСЕ поля
        // открытой строки и пишет автора (S2-12) — одним sqlscript.
        final ChangeAuthor by = author == null ? ChangeAuthor.UNKNOWN : author;
        final StatusHistoryService.Db sdb = statusDb();
        return Uni.createFrom().item(() -> StatusHistoryService.transition(
                    sdb, entityType, id, expected, token, by, now, nsid))
            .runSubscriptionOn(io.smallrye.mutiny.infrastructure.Infrastructure.getDefaultWorkerPool())
            .map(o -> {
                Response err = statusOutcomeError(o);
                if (err != null) return err;
                StatusHistoryService.Outcome.Ok ok = (StatusHistoryService.Outcome.Ok) o;
                return noStore(Response.ok(new StatusUpdateResponse(
                    true, entityType, id, ok.oldStatus(), ok.newStatus(), new StatusRevision(now, null))));
            })
            .onFailure().recoverWithItem(ex -> {
                LOG.warnf("[LORE STATUS] %s=%s: %s", entityType, id, ex.getMessage());
                if (Scd2Guard.isConcurrentModification(ex)) {
                    return Scd2Guard.conflict(entityType + " '" + id
                        + "': concurrent write to the same version — re-read and retry", Map.of());
                }
                return noStore(Response.status(Response.Status.BAD_GATEWAY)
                    .entity(LoreUpstream.error(ex)));
            });
    }

    // ── SPRINT_PLANITEM_RETIRE: sprint plan-field carry-forward helpers ──────
    // priority/planned_start_date/planned_end_date/track_id all live on the open
    // KnowSprintHist row. Any SCD2 transition that inserts a fresh row (status
    // flip via updateScd2Status, or an explicit plan edit via /lore/sprint/plan)
    // must carry these forward, or they silently disappear. pr_refs joined this
    // list after a live bug: a status flip right after sprint_set (pr_refs)
    // wiped the just-added PR links, because the freshly-opened hist row only
    // ever inherited the plan fields above.
    // planned_milestone_id used to live here too — retired. It required this
    // exact carry-forward mechanism to stay in sync with the TARGETS_MILESTONE
    // edge (which needs no such handling — edges point at the stable KnowSprint
    // vertex, not the hist row, so they survive SCD2 transitions untouched) and
    // drifted on 62+ sprints in production before removal.
    // SV-10/ADR-021 (2026-07-17): + context_md/outcome_md/content_hash. До этого
    // смена статуса спринта ПЕРЕНОСИЛА план-поля, но НЕ тела — каждый флип
    // осиротлял эссе спринта на закрытой строке (ровно carry-forward класс,
    // от которого задачи защищены restoreTaskHistFields, а спринты не были).
    private static final List<String> SPRINT_PLAN_FIELDS = List.of(
        "priority", "planned_start_date", "planned_end_date", "track_id", "pr_refs",
        "context_md", "outcome_md", "content_hash");

    private Uni<Map<String, Object>> readSprintPlanFields(String sprintId) {
        MartQuery q = new MartQuery("sql",
            "SELECT priority, planned_start_date, planned_end_date, track_id, pr_refs, " +
            "context_md, outcome_md, content_hash " +
            "FROM KnowSprintHist WHERE in('HAS_STATE').sprint_id[0] = :sid AND valid_to IS NULL LIMIT 1",
            Map.of("sid", sprintId), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            return rows.isEmpty() ? Map.<String, Object>of() : rows.get(0);
        });
    }

    // Targets the new hist row by state_uid (the same value used to CREATE EDGE
    // HAS_STATE moments earlier in updateScd2Status) rather than re-traversing
    // in('HAS_STATE') — a live bug showed that traversal-based UPDATE right
    // after a CREATE EDGE on the same connection can find zero rows (the edge
    // not yet visible to a fresh traversal query), silently failing to carry
    // pr_refs forward and surfacing as an opaque 500. state_uid is a plain
    // indexed property lookup, no edge traversal required, so it can't miss.
    private Uni<LoreCommandClient.LoreCommandResult> restoreSprintPlanFields(
            String nsid, Map<String, Object> fields) {
        if (fields.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        StringBuilder sb = new StringBuilder("UPDATE KnowSprintHist SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        for (String f : SPRINT_PLAN_FIELDS) {
            if (fields.get(f) != null) { sb.append(f).append("=:").append(f).append(", "); p.put(f, fields.get(f)); }
        }
        // fields can be non-empty (one hist row read) while every SPRINT_PLAN_FIELDS
        // value on it is null (a bare sprint with no priority/dates/track/pr_refs set
        // yet) — p stays empty in that case, which is the real "nothing to restore"
        // signal. A string-equality check on the built SET clause used to gate this
        // instead and never matched (StringBuilder's seed already has a trailing
        // space the check didn't account for), so every status flip on such a
        // sprint fired an invalid empty "UPDATE ... SET " and logged a spurious 500.
        if (p.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        String set = sb.toString().replaceAll(",\\s*$", "");
        p.put("nsid", nsid);
        return writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            set + " WHERE state_uid = :nsid", p));
    }

    // ── Auto-derive sprint status from its tasks ─────────────────────────────
    // A sprint should not sit in `planned` while its tasks are already moving.
    // After every task status flip we recompute the parent sprint's effective
    // status and PROMOTE it (SCD2, persisted) when warranted:
    //   • no open tasks left, at least one done   → sprint `done`
    //   • any task in progress AND sprint is one of
    //     planned / todo / backlog                → sprint `active` (in progress)
    // Deliberate/terminal sprint states are never overridden: blocked,
    // cancelled, deferred, and ready_for_deploy (RFD is "work done, waiting for
    // release" — an intentional hold, so all-done must not silently flip it to
    // done). Best-effort: a failure here never fails the task status change.
    private static final java.util.Set<String> SPRINT_AUTO_GUARD =
        java.util.Set.of("blocked", "cancelled", "deferred", "ready_for_deploy");
    // MT-SPRINT-STATUS-FOLLOWS-TASKS (decision:D-2026-SPRINT-STATUS-FOLLOWS-LAST-TASK):
    // «в работе» — только задачи, над которыми работают. "done" здесь был
    // дефектом: закрытие задачи открывало спринт (VE-1, 06.11.2026).
    private static final java.util.Set<String> TASK_PROGRESS =
        java.util.Set.of("active", "partial", "ready_for_deploy");
    private static final java.util.Set<String> SPRINT_PROMOTABLE =
        java.util.Set.of("planned", "todo", "backlog");

    /** Classify a stored status_raw ("✅ DONE", "🔄 IN PROGRESS", …) into a token,
     *  mirroring lore-status.ts taskTick. Returns null if unrecognised. */
    static String rawToToken(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.startsWith("✅")) return "done";
        if (s.startsWith("🔄")) return "active";
        if (s.startsWith("🟡")) return "partial";
        if (s.startsWith("🚀")) return "ready_for_deploy";
        if (s.startsWith("🔴")) return "blocked";
        if (s.startsWith("🚫")) return "cancelled";
        if (s.startsWith("🔬")) return "design";
        if (s.startsWith("🟣")) return "backlog";
        if (s.startsWith("📋")) return "planned";
        if (s.startsWith("⬜")) return "todo";
        if (s.startsWith("⏸")) return "deferred";
        // Keyword fallbacks for legacy rows written before the emoji convention.
        String u = s.toUpperCase();
        if (u.startsWith("DONE") || u.startsWith("CLOSED") || u.startsWith("ЗАВЕРШ")) return "done";
        if (u.startsWith("IN PROGRESS") || u.startsWith("WIP") || u.startsWith("ACTIVE")) return "active";
        if (u.startsWith("PARTIAL") || u.startsWith("ЧАСТИЧ")) return "partial";
        if (u.startsWith("READY") || u.startsWith("RFD")) return "ready_for_deploy";
        if (u.startsWith("BLOCK") || u.startsWith("ЗАБЛОК")) return "blocked";
        if (u.startsWith("CANCEL") || u.startsWith("ОТМЕН")) return "cancelled";
        if (u.startsWith("DESIGN") || u.startsWith("ДИЗАЙН")) return "design";
        if (u.startsWith("BACKLOG") || u.startsWith("БЭКЛ")) return "backlog";
        if (u.startsWith("PLAN") || u.startsWith("ЗАПЛАН")) return "planned";
        if (u.startsWith("TODO") || u.startsWith("НЕ НАЧ")) return "todo";
        if (u.startsWith("DEFER") || u.startsWith("ОТЛОЖ") || u.startsWith("HOLD") || u.startsWith("PAUSE")) return "deferred";
        return null;
    }

    /** Given a sprint's current status token and its task status tokens, return the
     *  token the sprint should be promoted to, or null for "leave unchanged". */
    static String deriveSprintTarget(String currentToken, List<String> taskTokens) {
        if (currentToken != null && SPRINT_AUTO_GUARD.contains(currentToken)) return null;
        int total = 0, done = 0, cancelled = 0, progress = 0;
        for (String tok : taskTokens) {
            if (tok == null) continue;
            total++;
            if (tok.equals("done")) done++;
            if (tok.equals("cancelled")) cancelled++;
            if (TASK_PROGRESS.contains(tok)) progress++;
        }
        String target = null;
        // Открытых задач не осталось и хоть одна сделана → DONE. Отменённая
        // задача закрыта, но не «сделана»: спринт из одних отменённых сюда не
        // попадает — оговорка решения, ждёт слова владелицы (не подменять
        // отменённое сделанным).
        if (total > 0 && done + cancelled == total && done > 0) target = "done";
        else if (progress > 0 && (currentToken == null || SPRINT_PROMOTABLE.contains(currentToken))) target = "active";
        if (target == null || target.equals(currentToken)) return null;
        return target;
    }

    /** Recompute + persist the parent sprint's status after a task flip (best-effort). */
    Uni<Void> autoDeriveSprintStatus(String taskUid) {
        return autoDeriveSprintStatus(taskUid, changeAuthor());
    }

    /** S2-12: авто-вывод статуса спринта пишет версию от имени того, кто сменил задачу. */
    Uni<Void> autoDeriveSprintStatus(String taskUid, ChangeAuthor author) {
        MartQuery ctxQ = new MartQuery("sql",
            "SELECT out('PART_OF').sprint_id[0] AS sid, " +
            "out('PART_OF').out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS sprint_status " +
            "FROM KnowTask WHERE task_uid = :uid LIMIT 1",
            Map.of("uid", taskUid), -1);
        return client.query(db, basicAuth(), ctxQ).chain(ctxRes -> {
            List<Map<String, Object>> ctx = ctxRes.result() != null ? ctxRes.result() : List.of();
            if (ctx.isEmpty() || ctx.get(0).get("sid") == null) return Uni.createFrom().voidItem();
            final String sid = String.valueOf(ctx.get(0).get("sid"));
            final String curToken = rawToToken((String) ctx.get(0).get("sprint_status"));

            MartQuery tasksQ = new MartQuery("sql",
                "SELECT out('HAS_STATE')[status_raw IS NOT NULL].status_raw[0] AS status_raw " +
                "FROM KnowTask WHERE out('PART_OF').sprint_id[0] = :sid",
                Map.of("sid", sid), -1);
            return client.query(db, basicAuth(), tasksQ).chain(tRes -> {
                List<Map<String, Object>> trows = tRes.result() != null ? tRes.result() : List.of();
                List<String> tokens = trows.stream().map(r -> rawToToken((String) r.get("status_raw"))).toList();
                final String target = deriveSprintTarget(curToken, tokens);
                if (target == null) return Uni.createFrom().voidItem();

                final String now2  = Instant.now().toString();
                final String nsid2 = UUID.randomUUID().toString();
                LOG.infof("[LORE STATUS] sprint=%s auto %s→%s (task %s changed)", sid, curToken, target, taskUid);
                return readSprintPlanFields(sid).chain(fields ->
                    updateScd2Status("sprint", "KnowSprint", "KnowSprintHist", "sprint_id", sid, target, now2, nsid2, author)
                        .chain(resp -> resp.getStatus() >= 300
                            ? Uni.createFrom().voidItem()
                            : restoreSprintPlanFields(nsid2, fields).replaceWithVoid()));
            });
        });
    }

    // ── Write-path: real-SCD2 edit of sprint plan fields ─────────────────────
    // Unlike updateSprint() (in-place vertex mutation, no history), this closes
    // the open KnowSprintHist row and opens a new one — same contract as
    // updateScd2Status — carrying forward every SPRINT_PLAN_FIELDS value the
    // caller didn't explicitly override. priority moves here exclusively;
    // updateSprint() no longer accepts it (see its handler).

    /** S2-09: expected — «было» по полям плана (priority, planned_start_date, planned_end_date, track_id, status); расхождение → 409. */
    public record SprintPlanRequest(String sprint_id, String priority, String planned_start_date,
        String planned_end_date, String track_id, Map<String, Object> expected) {
        public SprintPlanRequest(String sprint_id, String priority, String planned_start_date,
                String planned_end_date, String track_id) {
            this(sprint_id, priority, planned_start_date, planned_end_date, track_id, null);
        }
    }

    @POST
    @Path("sprint/plan")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Uni<Response> updateSprintPlan(SprintPlanRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return Uni.createFrom().item(disabled());
        requireAdmin(role);
        if (req == null || req.sprint_id() == null || req.sprint_id().isBlank())
            return Uni.createFrom().item(badParams("sprint_id required"));
        if (!SAFE_ID.matcher(req.sprint_id()).matches())
            return Uni.createFrom().item(badParams("sprint_id contains illegal characters"));
        if (req.priority() == null && req.planned_start_date() == null && req.planned_end_date() == null
                && req.track_id() == null)
            return Uni.createFrom().item(badParams("at least one field required"));

        final String sid  = req.sprint_id();
        final String now  = Instant.now().toString();
        final String nsid = UUID.randomUUID().toString();
        final ChangeAuthor author = changeAuthor(); // S2-12: снят до асинхронной цепочки

        // + context_md/outcome_md/content_hash (2026-07-17): этот close-open нёс тот же
        // carry-forward баг, что и статус-флип, — тела спринта терялись при правке плана.
        MartQuery readQ = new MartQuery("sql",
            "SELECT @rid AS rid, status_raw, priority, planned_start_date, planned_end_date, " +
            "track_id, pr_refs, context_md, outcome_md, content_hash" +
            StatusHistoryService.STATUS_FIELDS_SELECT.replace(", status_raw", "") + " FROM KnowSprintHist " +
            "WHERE in('HAS_STATE').sprint_id[0] = :sid AND valid_to IS NULL LIMIT 1",
            Map.of("sid", sid), -1);

        return client.query(db, basicAuth(), readQ).chain(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            if (rows.isEmpty())
                return Uni.createFrom().item(badParams("sprint has no open hist row: " + sid));
            Map<String, Object> cur = rows.get(0);
            String oldRid = String.valueOf(cur.getOrDefault("rid", ""));
            // S2-09: «было» не совпало с открытой версией — отказ до записи.
            String mismatch = Scd2Guard.firstMismatch(req.expected(), cur);
            if (mismatch != null)
                return Uni.createFrom().item(Scd2Guard.conflict("sprint '" + sid + "': expected "
                    + mismatch + " = '" + req.expected().get(mismatch) + "' does not match the open version — re-read and retry",
                    cur));

            Map<String, Object> next = new LinkedHashMap<>();
            next.put("status_raw",           cur.get("status_raw"));
            next.put("priority",             req.priority()             != null ? req.priority()             : cur.get("priority"));
            next.put("planned_start_date",   req.planned_start_date()   != null ? req.planned_start_date()   : cur.get("planned_start_date"));
            next.put("planned_end_date",     req.planned_end_date()     != null ? req.planned_end_date()     : cur.get("planned_end_date"));
            next.put("track_id",             req.track_id()             != null ? req.track_id()             : cur.get("track_id"));
            next.put("pr_refs",              cur.get("pr_refs"));
            next.put("context_md",           cur.get("context_md"));
            next.put("outcome_md",           cur.get("outcome_md"));
            next.put("content_hash",         cur.get("content_hash"));

            Map<String, Object> insertParams = new java.util.HashMap<>(next);
            insertParams.put("nsid", nsid);
            insertParams.put("now", now);
            insertParams.put("sid", sid);
            author.bind(insertParams);
            // S2-11: правка плана — не смена статуса. Статусные поля версии
            // (категория, «статус известен с», пометка бэкфилла) переносятся как
            // есть — иначе терялись, и дата закрытия спринта плыла (тот же класс
            // carry-forward, что 2026-07-17). status_raw уже перенесён выше.
            Map<String, Object> statusRow = new LinkedHashMap<>(cur);
            statusRow.remove("status_raw");
            String carryStatus = StatusHistoryService.carryStatusSet(statusRow, insertParams);

            // S2-09: close-open одним sqlscript (раньше — три отдельные команды без
            // атомарности) с условным закрытием: версия должна быть ЕЩЁ открыта,
            // иначе выход до первой записи и 409.
            StringBuilder script = new StringBuilder();
            if (oldRid.startsWith("#")) {
                script.append(Scd2Guard.guardedClose("KnowSprintHist", false));
                insertParams.put("oldrid", oldRid);
            } else {
                // S2-15: открытой версии не было видно — проверить внутри скрипта.
                script.append(Scd2Guard.guardedNoOpen("KnowSprintHist", "sprint_id", "sid"));
            }
            script.append("INSERT INTO KnowSprintHist SET state_uid = :nsid, valid_from = :now, " +
                    "status_raw = :status_raw, priority = :priority, planned_start_date = :planned_start_date, " +
                    "planned_end_date = :planned_end_date, " +
                    "track_id = :track_id, pr_refs = :pr_refs, " +
                    "context_md = :context_md, outcome_md = :outcome_md, content_hash = :content_hash" +
                    carryStatus + ChangeAuthor.SET_SQL + ";")
                .append("CREATE EDGE HAS_STATE FROM (SELECT FROM KnowSprint WHERE sprint_id = :sid) ")
                .append("TO (SELECT FROM KnowSprintHist WHERE state_uid = :nsid AND in('HAS_STATE').size() = 0);");

            return writeClient.command(db, basicAuth(),
                    new LoreCommandClient.LoreCommand("sqlscript", script.toString(), insertParams))
                .chain(r -> !Scd2Guard.isConflict(r.result())
                    ? Uni.createFrom().item((Response) null)
                    : client.query(db, basicAuth(), readQ).map(again -> Scd2Guard.conflict(
                        "sprint '" + sid + "': the plan version read was closed by a concurrent write — re-read and retry",
                        again.result() == null || again.result().isEmpty() ? Map.of() : again.result().get(0))))
                .map(conflict -> {
                    if (conflict != null) return conflict;
                    Map<String, Object> out = new LinkedHashMap<>(next);
                    out.put("ok", true);
                    out.put("sprint_id", sid);
                    out.remove("status_raw");
                    return noStore(Response.ok(out));
                });
        }).onFailure().recoverWithItem(ex -> {
            LOG.warnf("[LORE SPRINT PLAN] %s: %s", sid, ex.getMessage());
            if (Scd2Guard.isConcurrentModification(ex))
                return Scd2Guard.conflict("sprint '" + sid
                    + "': concurrent write to the same plan version — re-read and retry", Map.of());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(ex)));
        });
    }

    /**
     * ADR-LORE-014 §4 hard-gate: a task may not move to {@code done} if it has no
     * reviewer_agent, or if reviewer_agent equals executor_agent (no self-acceptance).
     * Returns null when the transition may proceed, or a 409 Response to short-circuit
     * with otherwise. author/executor/reviewer_agent are plain KnowTask vertex fields
     * (not Hist — see LoreSchemaInitializer), so this is a single non-traversal read.
     */
    private Uni<Response> checkTaskDoneGate(String taskUid, String role) {
        // ADR-LORE-014-D4: полный носитель (admin/superadmin, agent-full) работает
        // соло. Гейт рассчитан на ДВОИХ, а второго участника у него взять
        // неоткуда — требование ревьюера превращалось бы в требование выдумать
        // имя, то есть в фикцию, а не в проверку.
        //
        // Гейт остаётся для узких профилей: у architect/developer/pm/tester
        // разделение исполнителя и ревьюера осмысленно, там есть кому принимать.
        if (isFullScopeCaller(role)) return Uni.createFrom().nullItem();

        MartQuery q = new MartQuery("sql",
            "SELECT executor_agent, reviewer_agent FROM KnowTask WHERE task_uid = :uid LIMIT 1",
            Map.of("uid", taskUid), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            if (rows.isEmpty()) return null; // unknown task — let the normal flip report NOT_FOUND-shaped failure
            String executor = (String) rows.get(0).get("executor_agent");
            String reviewer = (String) rows.get(0).get("reviewer_agent");
            if (reviewer == null || reviewer.isBlank() || reviewer.equals(executor)) {
                return noStore(Response.status(Response.Status.CONFLICT)
                    .entity(new LoreError("NO_SELF_ACCEPTANCE",
                        "task cannot move to done: reviewer_agent must be set and differ from executor_agent "
                        + "(снимается только для полного носителя — admin/superadmin/agent-full, ADR-LORE-014-D4)")));
            }
            return null;
        });
    }

    /** Read note_md / effort_days from the currently-open KnowTaskHist row BEFORE a SCD2 flip.
     * Package-private — see updateScd2Status's Javadoc (ADR-LORE-013 task/move reuse). */
    Uni<Map<String, Object>> readTaskHistCarryFields(String taskUid) {
        MartQuery q = new MartQuery("sql",
            "SELECT note_md, effort_days FROM KnowTaskHist" +
            " WHERE in('HAS_STATE').task_uid CONTAINS :uid AND valid_to IS NULL LIMIT 1",
            Map.of("uid", taskUid), -1);
        return client.query(db, basicAuth(), q).map(res -> {
            List<Map<String, Object>> rows = res.result() != null ? res.result() : List.of();
            return rows.isEmpty() ? Map.<String, Object>of() : rows.get(0);
        });
    }

    /**
     * Restore note_md / effort_days onto the newly-opened KnowTaskHist row after a SCD2 flip.
     * Targets by state_uid (indexed property, no edge traversal) to avoid the CREATE EDGE
     * visibility race that would break an in('HAS_STATE') traversal done on the same connection.
     * Package-private — see updateScd2Status's Javadoc (ADR-LORE-013 task/move reuse).
     */
    Uni<LoreCommandClient.LoreCommandResult> restoreTaskHistFields(
            String nsid, String noteMd, Double effortDays) {
        StringBuilder sb = new StringBuilder("UPDATE KnowTaskHist SET ");
        Map<String, Object> p = new LinkedHashMap<>();
        if (noteMd     != null) { sb.append("note_md = :note, ");     p.put("note", noteMd); }
        if (effortDays != null) { sb.append("effort_days = :eff, ");  p.put("eff", effortDays); }
        if (p.isEmpty()) return Uni.createFrom().item(new LoreCommandClient.LoreCommandResult(null));
        String set = sb.toString().replaceAll(",\\s*$", "");
        p.put("nsid", nsid);
        return writeClient.command(db, basicAuth(),
            new LoreCommandClient.LoreCommand("sql", set + " WHERE state_uid = :nsid", p));
    }

    // ── Write-path: batch status update ──────────────────────────────────────

    @POST
    @Path("status/batch")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response batchSetStatus(BatchStatusRequest req,
                                   @HeaderParam("X-Seer-Role") String role,
                                   @HeaderParam(AgentMachine.HEADER) String machineHeader) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.ids() == null || req.ids().isEmpty())
            return badParams("ids required");
        if (req.entity_type() == null || req.status() == null)
            return badParams("entity_type and status required");
        int updated = 0;
        int unchanged = 0;
        List<String> errors = new java.util.ArrayList<>();
        for (String id : req.ids()) {
            try {
                var body = new StatusUpdateRequest(req.entity_type(), id, req.status());
                Response r = updateStatus(body, "admin", machineHeader).await().indefinitely();
                if (r.getStatus() == 200) {
                    // «Уже был такой статус» и «статус сменили» — разные исходы, и до
                    // сих пор они складывались в одно число. «Обновлено 3» не
                    // отличало работу от повтора (ADR-LORE-043).
                    if (r.getEntity() instanceof Map<?, ?> m
                            && m.get("old_status") != null
                            && m.get("old_status").equals(m.get("new_status"))) {
                        unchanged++;
                    } else {
                        updated++;
                    }
                } else {
                    errors.add(id + ": HTTP " + r.getStatus());
                }
            } catch (Exception e) {
                errors.add(id + ": " + e.getMessage());
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", errors.isEmpty());
        // Три числа вместо одного, и ноль печатается наравне с ненулём:
        // отсутствие ошибок не должно быть неотличимо от отсутствия проверки.
        out.put("outcome", errors.isEmpty()
            ? (updated > 0 ? LoreOutcome.UPDATED : LoreOutcome.UNCHANGED)
            : LoreOutcome.NOOP);
        out.put("updated", updated);
        out.put("unchanged", unchanged);
        out.put("failed", errors.size());
        if (!errors.isEmpty()) out.put("errors", errors);
        return noStore(Response.ok(out));
    }
}
