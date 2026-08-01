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
