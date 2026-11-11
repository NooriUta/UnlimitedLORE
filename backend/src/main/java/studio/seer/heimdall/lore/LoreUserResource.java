package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * KnowUser write path (AL-82, ADR-LORE-036). Предусловие всей проектной
 * RBAC-модели: человек как вершина графа + ребро «человек × проект × роль».
 * По вердикту 148 источник истины о правах — граф, а до этой задачи человека
 * в нём не было вовсе — хранить «роль человека в проекте» было негде.
 *
 * Семейство "user" — HUMAN_ONLY (AgentScopeFilter): агент физически не может
 * назначить роль ни себе, ни своему владельцу. requireAdmin() здесь —
 * ВТОРОЙ, независимый гейт (как у dict/kc): HUMAN_ONLY снимает только
 * агентов, обычный человек без роли admin по-прежнему не должен раздавать
 * проектные роли.
 *
 * KnowUser ключуется по kc_sub (клеймом Keycloak), НЕ по имени — имя
 * меняется, sub нет (тот же принцип, что различает актора-человека от
 * учётной записи, см. ADR-LORE-036 контекст).
 */
@Path("/lore")
public class LoreUserResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreUserResource.class);

    public record UserUpsertRequest(String kc_sub, String display_name) {}

    @POST
    @Path("user")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response upsertUser(UserUpsertRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.kc_sub() == null || req.kc_sub().isBlank())
            return badParams("kc_sub required");
        if (!SAFE_ID.matcher(req.kc_sub()).matches())
            return badParams("kc_sub contains illegal characters");
        try {
            // DBR-17: исход из факта — прежнее состояние читаем до записи.
            List<Map<String, Object>> prev = ingestService.queryPublic(
                "SELECT display_name FROM KnowUser WHERE kc_sub=:sub", Map.of("sub", req.kc_sub()));
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("kc_sub", req.kc_sub());
            if (!prev.isEmpty() && (req.display_name() == null
                    || req.display_name().equals(prev.get(0).get("display_name")))) {
                out.put("outcome", LoreOutcome.UNCHANGED);
                return noStore(Response.ok(out));
            }
            upsertUserVertex(req.kc_sub(), req.display_name());
            out.put("outcome", prev.isEmpty() ? LoreOutcome.CREATED : LoreOutcome.UPDATED);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE USER UPSERT] %s: %s", req.kc_sub(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
    }

    /**
     * AL-100: причина, по которой снятие роли запрещено, либо {@code null},
     * если снимать можно.
     *
     * <p>Два сценария, оба необратимы при включённом {@code lore.scope.enforce}:
     * <ol>
     *   <li><b>Своя последняя роль.</b> Сняв её, человек теряет доступ ко всему
     *       LORE — включая саму админку, через которую роль возвращают.
     *       Восстановление остаётся только прямым запросом в БД.</li>
     *   <li><b>Последний owner проекта.</b> Проектом становится некому
     *       управлять, и назначить нового владельца тоже некому.</li>
     * </ol>
     *
     * <p><b>Правило «сам себе» — только для людей.</b> Когда роль снимает агент,
     * его собственный доступ не зависит от {@code HAS_PROJECT_ROLE} (права
     * агента идут по {@code client_id}), и запрет был бы ложным срабатыванием.
     *
     * <p><b>superadmin эти проверки НЕ обходит.</b> Здесь защита не от нехватки
     * прав, а от необратимой ошибки — большие права её не отменяют.
     */
    private String removalBlockedBecause(String kcSub, String project) {
        String caller = callerKcSub();
        boolean callerIsHuman = callerClientId() == null && caller != null;
        if (callerIsHuman && caller.equals(kcSub)) {
            long mine = countRows("SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub",
                Map.of("sub", kcSub));
            if (mine <= 1) {
                return "Это ваша единственная проектная роль. Сняв её, вы потеряете доступ "
                     + "ко всему LORE, как только включится lore.scope.enforce, — и вернуть "
                     + "роль этой же админкой уже не сможете.";
            }
        }
        String role = firstString(
            "SELECT role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub AND @in.slug = :proj",
            Map.of("sub", kcSub, "proj", project));
        if ("owner".equals(role)) {
            long owners = countRows(
                "SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE @in.slug = :proj AND role = 'owner'",
                Map.of("proj", project));
            if (owners <= 1) {
                return "Это последний владелец проекта " + project + ". Без владельца проектом "
                     + "некому управлять — назначьте другого owner'а до снятия этого.";
            }
        }
        return null;
    }

    private long countRows(String sql, Map<String, Object> params) {
        List<Map<String, Object>> rows = ingestService.queryPublic(sql, params);
        if (rows.isEmpty()) return 0;
        Object n = rows.get(0).get("n");
        return n instanceof Number num ? num.longValue() : 0;
    }

    private String firstString(String sql, Map<String, Object> params) {
        List<Map<String, Object>> rows = ingestService.queryPublic(sql, params);
        if (rows.isEmpty()) return null;
        Object v = rows.get(0).get("role");
        return v == null ? null : String.valueOf(v);
    }

    // LH-44 partial-safe: display_name опущен -> не трогаем существующее значение.
    private void upsertUserVertex(String kcSub, String displayName) {
        StringBuilder sql = new StringBuilder("UPDATE KnowUser SET kc_sub=:sub");
        Map<String, Object> p = new HashMap<>();
        p.put("sub", kcSub);
        if (displayName != null) { sql.append(", display_name=:dn"); p.put("dn", displayName); }
        sql.append(" UPSERT WHERE kc_sub=:sub");
        writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
            sql.toString(), p)).await().indefinitely();
    }

    public record UserRoleRequest(String kc_sub, String display_name, String project, String role, String action) {}

    public record UserRoleBatchRequest(String kc_sub, String display_name, List<Map<String, Object>> changes,
                                       Boolean dry_run,
                                       // Kit 2 (K2-BATCH-UNDO): этот вызов — отмена пачки batch_id; вне окна — отказ.
                                       String undo_of) {}

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-05 · S7B-09 · S7B-13 — массовая смена ролей человека.
     * dry_run → только план «было → станет» для одного подтверждения на N. Иначе
     * каждое изменение идёт через {@link #setUserRole} (те же проверки, блокировки
     * снятия AL-100 и события AL-102), а ответ несёт итог по каждому проекту и
     * {@code undo} — обратный пакет для отката всей пачки этим же вызовом.
     * Журнал AO-01 пишет одну точку на HTTP-вызов — пачка видна одной записью.
     * Пакет НЕ атомарен: отказ по одному проекту не откатывает уже сделанные —
     * это сказано в ответе (atomic=false) и видно по item.outcome.
     */
    @POST
    @Path("user/role/batch")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setUserRoleBatch(UserRoleBatchRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.kc_sub() == null || req.kc_sub().isBlank()) return badParams("kc_sub required");
        if (!SAFE_ID.matcher(req.kc_sub()).matches()) return badParams("kc_sub contains illegal characters");
        String err = LoreRoleBatch.error(req.changes());
        if (err != null) return badParams(err);
        java.time.Instant now = java.time.Instant.now();
        if (req.undo_of() != null) {
            String undoErr = LoreRoleBatch.undoError(req.undo_of(), now);
            if (undoErr != null) return badParams(undoErr);
        }
        try {
            Map<String, String> current = new java.util.LinkedHashMap<>();
            for (Map<String, Object> r : ingestService.queryPublic(
                    "SELECT @in.slug AS slug, role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub = :sub",
                    Map.of("sub", req.kc_sub())))
                if (r.get("slug") != null) current.put(String.valueOf(r.get("slug")), String.valueOf(r.get("role")));
            List<Map<String, Object>> plan = LoreRoleBatch.plan(current, req.changes());
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("kc_sub", req.kc_sub());
            out.put("plan", plan);
            out.put("undo", LoreRoleBatch.undo(plan));
            if (Boolean.TRUE.equals(req.dry_run())) {
                // S7B-20: отказ AL-100 — строкой плана «нельзя» с причиной, как его скажет
                // применение (removalBlockedBecause), а не «проверено» с 409 потом.
                Map<String, Long> owners = new java.util.HashMap<>();
                for (Map<String, Object> p : plan) {
                    if ("remove".equals(p.get("kind")) && "owner".equals(p.get("before"))) {
                        String proj = String.valueOf(p.get("project"));
                        owners.put(proj, countRows(
                            "SELECT count(*) AS n FROM HAS_PROJECT_ROLE WHERE @in.slug = :proj AND role = 'owner'",
                            Map.of("proj", proj)));
                    }
                }
                String caller = callerKcSub();
                boolean selfRemoval = callerClientId() == null && caller != null && caller.equals(req.kc_sub());
                int blocked = LoreRoleBatch.markRemovalBlocks(plan, owners, selfRemoval ? (long) current.size() : null);
                out.put("blocked", blocked);
                out.put("dry_run", true);
                out.put("applied", 0);
                return noStore(Response.ok(out));
            }
            // Kit 2 (K2-BATCH-UNDO) + S7B-13: id пачки — до применения: каждое событие AL-102 пачки
            // несёт его, и пачку раскрывают из журнала (GET /lore/admin/actions/batch/{id}).
            // В ответе batch_id — ПЕРВОЕ *_id поле: фильтр журнала AO-01 пишет его сущностью записи.
            String batchId = LoreRoleBatch.batchId(now);
            Map<String, Object> head = new java.util.LinkedHashMap<>();
            head.put("ok", true);
            head.put("batch_id", batchId);
            out.remove("ok");
            head.putAll(out);
            out = head;
            List<Map<String, Object>> items = new java.util.ArrayList<>();
            int applied = 0, failed = 0;
            for (Map<String, Object> p : plan) {
                // Kit 09.11: итог у КАЖДОЙ строки плана — пачка не атомарна, и клиент не должен
                // считать успех вычитанием. «Уже так» — своя строка с result=unchanged.
                if ("unchanged".equals(p.get("kind"))) {
                    Map<String, Object> same = new java.util.LinkedHashMap<>();
                    same.put("project", p.get("project"));
                    same.put("kind", "unchanged");
                    same.put("result", "unchanged");
                    items.add(same);
                    continue;
                }
                boolean remove = "remove".equals(p.get("kind"));
                Response r = setUserRole(new UserRoleRequest(req.kc_sub(), req.display_name(),
                    String.valueOf(p.get("project")), remove ? null : String.valueOf(p.get("after")),
                    remove ? "remove" : null), role, batchId);
                Map<String, Object> item = new java.util.LinkedHashMap<>();
                item.put("project", p.get("project"));
                item.put("kind", p.get("kind"));
                item.put("status", r.getStatus());
                Object entity = r.getEntity();
                if (entity instanceof Map<?, ?> m && m.get("outcome") != null) item.put("outcome", m.get("outcome"));
                if (entity instanceof LoreError le) item.put("error", le);
                item.put("result", r.getStatus() == 200 ? "applied" : "failed");
                if (r.getStatus() == 200) applied++; else failed++;
                items.add(item);
            }
            out.put("applied", applied);
            out.put("failed", failed);
            out.put("atomic", false);
            out.put("items", items);
            // Kit 2 (K2-BATCH-UNDO): идентификатор пачки и окно отмены. Отмена — этот же вызов
            // с changes = undo и undo_of = batch_id. Журнал AO-01 — одна запись на вызов = на пачку.
            out.put("undo_until", String.valueOf(LoreRoleBatch.undoUntil(batchId)));
            if (req.undo_of() != null) out.put("undo_of", req.undo_of());
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE USER ROLE BATCH] %s: %s", req.kc_sub(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /**
     * SPRINT_UXR_S7B_ADMIN/S7B-ACL-1 · S7B-ACL-2 — выдать / изменить / снять допуск человека к
     * машине miniLORE. Машина — актор с {@code client_id = minilore-link-<machine_id>}; ребро
     * {@code MACHINE_ACCESS} KnowUser → актор-машина, одно на пару. Решает владелец машины
     * ({@code OWNED_BY}) или admin — проверка здесь, на сервере ({@link MachineAccess#writeRefusal}),
     * отказ 403 словами. {@code dry_run} — только план «было → станет», как у user/role/batch.
     * Журнал AO-01 — фильтром, сущность записи — {@code machine_id} (первое *_id поле ответа).
     */
    @POST
    @Path("user/machine-access")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setMachineAccess(MachineAccessRequest body, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        MachineAccess.Request req = body == null ? null : body.toRequest();
        List<String> roles = activeDictCodes(MachineAccess.ROLE_DICT, MachineAccess.ROLES_FALLBACK);
        String err = MachineAccess.requestError(req, roles, activeDictCodes("harness", LoreActorHarness.REGISTRY));
        if (err != null) return badParams(err);
        String clientId = MachineAccess.clientIdOf(req.machine_id());
        try {
            List<Map<String, Object>> machine = ingestService.queryPublic(
                "SELECT actor_id, out('OWNED_BY').kc_sub AS owner_kc_sub FROM KnowActor "
                + "WHERE kind = 'agent' AND client_id = :c", Map.of("c", clientId));
            if (machine.isEmpty())
                return targetNotFound("машина " + req.machine_id() + " не заведена: нет актора-агента с client_id "
                    + clientId + " (Агенты → «имя, роль, владелец, учётка»)");
            String owner = MachineAccess.ownerOf(machine.get(0));
            String refusal = MachineAccess.writeRefusal(callerAgentScope(), role, callerKcSub(), owner, req.machine_id());
            if (refusal != null)
                return noStore(Response.status(Response.Status.FORBIDDEN)
                    .entity(new LoreError("MACHINE_ACCESS_FORBIDDEN", refusal)));
            String self = MachineAccess.selfGrantRefusal(req.kc_sub(), owner);
            if (self != null) return badParams(self);
            if (!req.revoke())
                for (String p : new java.util.LinkedHashSet<>(req.projects()))
                    if (!exists("KnowGitProject", "slug", p))
                        return targetNotFound("проект " + p + " не зарегистрирован — заведите его project_new");

            Map<String, Object> pair = Map.of("sub", req.kc_sub(), "c", clientId);
            List<Map<String, Object>> cur = ingestService.queryPublic(
                "SELECT role, projects, harnesses FROM MACHINE_ACCESS WHERE @out.kc_sub = :sub AND @in.client_id = :c", pair);
            MachineAccess.Grant current = cur.isEmpty() ? null : MachineAccess.grantsOf(Map.of(
                "grant_kc_subs", List.of(req.kc_sub()),
                "grant_roles", java.util.Collections.singletonList(cur.get(0).get("role")),
                "grant_projects", java.util.Collections.singletonList(cur.get(0).get("projects")),
                "grant_harnesses", java.util.Collections.singletonList(cur.get(0).get("harnesses")))).get(0);
            Map<String, Object> plan = MachineAccess.plan(current, req);

            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("machine_id", req.machine_id());   // первое *_id — сущность записи журнала AO-01
            out.put("ok", true);
            out.put("client_id", clientId);
            out.put("kc_sub", req.kc_sub());
            out.put("plan", plan);
            if (Boolean.TRUE.equals(body.dry_run())) {
                out.put("dry_run", true);
                out.put("applied", 0);
                return noStore(Response.ok(out));
            }
            String kind = String.valueOf(plan.get("kind"));
            if ("unchanged".equals(kind)) {
                out.put("outcome", LoreOutcome.UNCHANGED);
                return noStore(Response.ok(out));
            }
            if ("revoke".equals(kind)) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM MACHINE_ACCESS WHERE @out.kc_sub = :sub AND @in.client_id = :c", pair))
                    .await().indefinitely();
                boolean gone = !edgeExists(MachineAccess.EDGE, "kc_sub", req.kc_sub(), "client_id", clientId);
                out.put("outcome", gone ? LoreOutcome.DELETED : LoreOutcome.NOOP);
                if (!gone) out.put("reason", "DELETE выполнен, но ребро допуска осталось в графе");
                return noStore(Response.ok(out));
            }
            MachineAccess.Grant target = MachineAccess.target(req);
            Map<String, Object> p = new HashMap<>();
            p.put("sub", req.kc_sub());
            p.put("c", clientId);
            p.put("r", target.role());
            p.put("by", callerLabel());
            p.put("at", Instant.now().toString());
            if ("update".equals(kind)) {
                setMachineAccessProps(p, target);
                out.put("outcome", LoreOutcome.UPDATED);
                return noStore(Response.ok(out));
            }
            // grant: вершину человека заводим тут же — допуск из карточки машины не должен
            // распадаться на два запроса (тот же приём, что user/role).
            upsertUserVertex(req.kc_sub(), req.display_name());
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE MACHINE_ACCESS FROM (SELECT FROM KnowUser WHERE kc_sub = :sub) "
                + "TO (SELECT FROM KnowActor WHERE client_id = :c) IF NOT EXISTS", pair))
                .await().indefinitely();
            boolean made = edgeExists(MachineAccess.EDGE, "kc_sub", req.kc_sub(), "client_id", clientId);
            if (made) setMachineAccessProps(p, target);
            out.put("outcome", made ? LoreOutcome.CREATED : LoreOutcome.NOOP);
            if (!made) out.put("reason", "ребро MACHINE_ACCESS не создано: человек или машина не найдены");
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE MACHINE ACCESS] %s @ %s: %s", req.kc_sub(), req.machine_id(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /**
     * Свойства ребра допуска — отдельным UPDATE после CREATE EDGE. CI 11.11 (#1225):
     * «CREATE EDGE … IF NOT EXISTS SET …» с параметрами-списками ArcadeDB отверг 400.
     * Списки пишем литералом: значения уже проверены (проекты — по KnowGitProject,
     * harness — по словарю), кавычки экранируются {@link #sqlList}.
     */
    private void setMachineAccessProps(Map<String, Object> p, MachineAccess.Grant target) {
        // Второй прогон CI 11.11: UPDATE с «:by» тоже 400 — BY ключевое слово парсера,
        // параметры переименованы; списки — отдельной командой, чтобы сбой назвал свою половину.
        Map<String, Object> q = new HashMap<>();
        q.put("sub", p.get("sub"));
        q.put("c", p.get("c"));
        q.put("grole", p.get("r"));
        q.put("gwho", p.get("by"));
        q.put("gwhen", p.get("at"));
        machineAccessCommand("UPDATE MACHINE_ACCESS SET role = :grole, granted_by = :gwho, granted_at = :gwhen "
            + "WHERE @out.kc_sub = :sub AND @in.client_id = :c", q);
        machineAccessCommand("UPDATE MACHINE_ACCESS SET projects = " + sqlList(target.projects())
            + ", harnesses = " + sqlList(target.harnesses())
            + " WHERE @out.kc_sub = :sub AND @in.client_id = :c", q);
    }

    /** Команда с телом ответа ArcadeDB в исключении: «400» без тела не называет причину. */
    private void machineAccessCommand(String sql, Map<String, Object> params) {
        try {
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, params))
                .await().indefinitely();
        } catch (jakarta.ws.rs.WebApplicationException e) {
            String body = "";
            try { body = e.getResponse().readEntity(String.class); } catch (Exception ignored) { /* тела нет */ }
            throw new IllegalStateException("ArcadeDB " + e.getResponse().getStatus() + " на «" + sql + "»: " + body, e);
        }
    }

    static String sqlList(java.util.Collection<String> values) {
        StringBuilder b = new StringBuilder("[");
        for (String v : values) {
            if (b.length() > 1) b.append(", ");
            b.append('\'').append(v.replace("\\", "\\\\").replace("'", "\\'")).append('\'');
        }
        return b.append("]").toString();
    }

    public record MachineAccessRequest(String machine_id, String kc_sub, String display_name, String action,
                                       String role, List<String> projects, List<String> harnesses, Boolean dry_run) {
        MachineAccess.Request toRequest() {
            return new MachineAccess.Request(machine_id, kc_sub, display_name, action, role, projects, harnesses);
        }
    }

    @POST
    @Path("user/role")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setUserRole(UserRoleRequest req, @HeaderParam("X-Seer-Role") String role) {
        return setUserRole(req, role, null);
    }

    /** S7B-13: {@code batchId} — правка идёт в составе пачки; событие AL-102 несёт её id. */
    Response setUserRole(UserRoleRequest req, String role, String batchId) {
        if (!enabled) return disabled();
        requireAdmin(role);
        if (req == null || req.kc_sub() == null || req.kc_sub().isBlank())
            return badParams("kc_sub required");
        if (!SAFE_ID.matcher(req.kc_sub()).matches())
            return badParams("kc_sub contains illegal characters");
        if (req.project() == null || req.project().isBlank())
            return badParams("project required");
        if (!SAFE_ID.matcher(req.project()).matches())
            return badParams("project contains illegal characters");
        boolean remove = "remove".equals(req.action());
        if (!remove && (req.role() == null || req.role().isBlank()))
            return badParams("role required unless action=remove");
        try {
            // DBR-17: проект — до записи. CREATE EDGE к несуществующему проекту
            // молча не создавал ребра, а событие «grant» в журнал всё равно
            // уходило: аудит показывал выдачу, которой не было.
            if (!exists("KnowGitProject", "slug", req.project()))
                return targetNotFound("проект " + req.project() + " не зарегистрирован — заведите его project_new");
            Map<String, Object> pair = Map.of("sub", req.kc_sub(), "proj", req.project());
            List<Map<String, Object>> existing = ingestService.queryPublic(
                "SELECT @rid AS rid, role FROM HAS_PROJECT_ROLE WHERE @out.kc_sub=:sub AND @in.slug=:proj", pair);
            if (remove) {
                // Снимать нечего — законный повтор: ни блокировок, ни события в журнале.
                if (existing.isEmpty())
                    return noStore(Response.ok(LoreOutcome.unlink(Map.of("ok", true, "removed", false), false)));
                // AL-100: снятие роли необратимо в обе стороны — вернуть её можно
                // только этой же админкой, а она сама живёт за проектным скоупом.
                // Поэтому две проверки ДО удаления, а не предупреждение после.
                String block = removalBlockedBecause(req.kc_sub(), req.project());
                if (block != null) {
                    // 409, а не 400: запрос корректен, конфликтует состояние графа.
                    return noStore(Response.status(Response.Status.CONFLICT)
                        .entity(new LoreError("ROLE_REMOVAL_BLOCKED", block)));
                }
                // ArcadeDB грамматика: DELETE EDGE не существует ни в одной форме
                // (памятка feedback_arcadedb_edge_delete) — DELETE FROM по @rid,
                // @out/@in для матча по свойствам соседних вершин.
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "DELETE FROM HAS_PROJECT_ROLE WHERE @out.kc_sub=:sub AND @in.slug=:proj", pair))
                    .await().indefinitely();
                boolean gone = !edgeExists("HAS_PROJECT_ROLE", "kc_sub", req.kc_sub(), "slug", req.project());
                if (gone) logRoleEvent(req.kc_sub(), req.project(), null, "remove", role, // AL-102
                    batchId, roleOf(existing));
                Map<String, Object> out = new java.util.LinkedHashMap<>();
                out.put("ok", true);
                out.put("removed", gone);
                out.put("outcome", gone ? LoreOutcome.DELETED : LoreOutcome.NOOP);
                if (!gone) out.put("reason", "DELETE выполнен, но ребро роли осталось в графе");
                return noStore(Response.ok(out));
            }
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("kc_sub", req.kc_sub());
            out.put("project", req.project());
            out.put("role", req.role());
            // Роль человека в проекте — ребро ОДНО на пару (человек, проект),
            // роль свойством (то же устройство, что HAS_ACTOR/role, ADR-028 D19).
            // Вершину пользователя заводим тут же, а не отдельным вызовом —
            // назначение роли из «Люди» (карточка KC-пользователя) не должно
            // распадаться на два запроса ради одного действия админа.
            upsertUserVertex(req.kc_sub(), req.display_name());
            if (!existing.isEmpty()) {
                if (req.role().equals(existing.get(0).get("role"))) {
                    // Та же роль — не правка: без события в журнале, иначе аудит
                    // насчитал бы изменения там, где их не было.
                    out.put("outcome", LoreOutcome.UNCHANGED);
                    out.put("hint", "роль уже такая — повторять вызов не нужно");
                    return noStore(Response.ok(out));
                }
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE HAS_PROJECT_ROLE SET role=:r WHERE @out.kc_sub=:sub AND @in.slug=:proj",
                    Map.of("r", req.role(), "sub", req.kc_sub(), "proj", req.project())))
                    .await().indefinitely();
                logRoleEvent(req.kc_sub(), req.project(), req.role(), "update", role, // AL-102
                    batchId, roleOf(existing));
                out.put("outcome", LoreOutcome.UPDATED);
                out.put("previous_role", existing.get(0).get("role"));
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_PROJECT_ROLE FROM (SELECT FROM KnowUser WHERE kc_sub=:sub) " +
                    "TO (SELECT FROM KnowGitProject WHERE slug=:proj) SET role=:r",
                    Map.of("sub", req.kc_sub(), "proj", req.project(), "r", req.role())))
                    .await().indefinitely();
                if (!edgeExists("HAS_PROJECT_ROLE", "kc_sub", req.kc_sub(), "slug", req.project())) {
                    out.put("outcome", LoreOutcome.NOOP);
                    out.put("reason", "ребро HAS_PROJECT_ROLE не создано: пользователь или проект не найден");
                    return noStore(Response.ok(out));
                }
                logRoleEvent(req.kc_sub(), req.project(), req.role(), "grant", role, batchId, null); // AL-102
                out.put("outcome", LoreOutcome.CREATED);
            }
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE USER ROLE] %s @ %s: %s", req.kc_sub(), req.project(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
    }

    /**
     * AL-102: append-запись события выдачи/снятия проектной роли. best-effort —
     * сбой журналирования не должен ронять уже выполненное изменение роли (оно
     * первично; лог — производное наблюдение). role=null при снятии (SET строим
     * динамически: ArcadeDB не принимает null-биндинг). event_uid — UUID.
     * by_role = X-Seer-Role вызывающего: точная идентичность человека backend'у
     * недоступна (аутентификация на ролевом заголовке), появится с sub в токене
     * (AL-105).
     */
    private static String roleOf(List<Map<String, Object>> existing) {
        Object r = existing.isEmpty() ? null : existing.get(0).get("role");
        return r == null ? null : String.valueOf(r);
    }

    /** S7B-13: batchId — пачка, в составе которой правка; roleBefore — роль до правки (для отката из журнала). */
    private void logRoleEvent(String kcSub, String project, String roleGranted, String action, String byRole,
                              String batchId, String roleBefore) {
        try {
            Map<String, Object> p = new HashMap<>();
            p.put("eid", UUID.randomUUID().toString());
            p.put("sub", kcSub);
            p.put("proj", project);
            p.put("act", action);
            p.put("at", Instant.now().toString());
            StringBuilder sql = new StringBuilder(
                "INSERT INTO KnowProjectRoleEvent SET event_uid=:eid, kc_sub=:sub, project=:proj, "
                + "action=:act, at=:at");
            if (roleGranted != null) { sql.append(", role=:r");     p.put("r", roleGranted); }
            if (byRole != null)      { sql.append(", by_role=:br"); p.put("br", byRole); }
            if (batchId != null)     { sql.append(", batch_id=:bid"); p.put("bid", batchId); }
            if (roleBefore != null)  { sql.append(", role_before=:rb"); p.put("rb", roleBefore); }
            writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql.toString(), p)).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf("[LORE ROLE EVENT] %s @ %s (%s): %s", kcSub, project, action, e.getMessage());
        }
    }
}
