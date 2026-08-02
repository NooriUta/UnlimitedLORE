package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

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
            upsertUserVertex(req.kc_sub(), req.display_name());
            return noStore(Response.ok(Map.of("ok", true, "kc_sub", req.kc_sub())));
        } catch (Exception e) {
            LOG.warnf("[LORE USER UPSERT] %s: %s", req.kc_sub(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
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

    @POST
    @Path("user/role")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setUserRole(UserRoleRequest req, @HeaderParam("X-Seer-Role") String role) {
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
            if (remove) {
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
                    "DELETE FROM HAS_PROJECT_ROLE WHERE @out.kc_sub=:sub AND @in.slug=:proj",
                    Map.of("sub", req.kc_sub(), "proj", req.project())))
                    .await().indefinitely();
                return noStore(Response.ok(Map.of("ok", true, "removed", true)));
            }
            // Роль человека в проекте — ребро ОДНО на пару (человек, проект),
            // роль свойством (то же устройство, что HAS_ACTOR/role, ADR-028 D19).
            // Вершину пользователя заводим тут же, а не отдельным вызовом —
            // назначение роли из «Люди» (карточка KC-пользователя) не должно
            // распадаться на два запроса ради одного действия админа.
            upsertUserVertex(req.kc_sub(), req.display_name());
            List<Map<String, Object>> existing = ingestService.queryPublic(
                "SELECT @rid AS rid FROM HAS_PROJECT_ROLE WHERE @out.kc_sub=:sub AND @in.slug=:proj",
                Map.of("sub", req.kc_sub(), "proj", req.project()));
            if (!existing.isEmpty()) {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "UPDATE HAS_PROJECT_ROLE SET role=:r WHERE @out.kc_sub=:sub AND @in.slug=:proj",
                    Map.of("r", req.role(), "sub", req.kc_sub(), "proj", req.project())))
                    .await().indefinitely();
            } else {
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE HAS_PROJECT_ROLE FROM (SELECT FROM KnowUser WHERE kc_sub=:sub) " +
                    "TO (SELECT FROM KnowGitProject WHERE slug=:proj) SET role=:r",
                    Map.of("sub", req.kc_sub(), "proj", req.project(), "r", req.role())))
                    .await().indefinitely();
            }
            return noStore(Response.ok(Map.of(
                "ok", true, "kc_sub", req.kc_sub(), "project", req.project(), "role", req.role())));
        } catch (Exception e) {
            LOG.warnf("[LORE USER ROLE] %s @ %s: %s", req.kc_sub(), req.project(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(new LoreError("LORE_UPSTREAM", e.getMessage())));
        }
    }
}
