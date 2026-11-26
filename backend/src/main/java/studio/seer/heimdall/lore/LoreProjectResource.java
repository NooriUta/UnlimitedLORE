package studio.seer.heimdall.lore;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.Map;

/**
 * KnowGitProject write path (T15, SPRINT_LORE_MCP_EVOLUTION). Before this, KnowGitProject
 * vertices only ever came from a direct ArcadeDB INSERT (no MCP tool, no REST endpoint —
 * see MEMORY lore_git_project_registration) — sprint_link(rel:"project")/release_new/
 * release_mv all assume the target KnowGitProject vertex already exists and silently no-op
 * (ok:true, no edge/vertex written) when it doesn't. This gives project registration a real,
 * idempotent write path.
 *
 * <p>AL-84/ADR-LORE-025-D17: единственный write-путь этого ресурса (create И update —
 * LH-44 partial upsert по slug, отдельного «только создание» пути нет) требует
 * super-admin, не admin. Привязка УЖЕ существующих сущностей к проекту
 * (sprint_link rel=project, release_new) идёт другими путями, этого ограничения
 * не касается.
 *
 * <p><b>Поправка 2026-08-11</b> (решение владельца): гейт был непроходим НИ ДЛЯ
 * КОГО на практике — {@code project} сидел в {@code AgentScopeFilter.HUMAN_ONLY}
 * (ни один из семи агентных профилей, включая {@code full}, не писал сюда), а у
 * человека нет ни UI-кнопки, ни проверенной {@code superadmin}-учётки отдельно от
 * обычного {@code admin}. Открыт РОВНО {@code agent-full}
 * ({@link LoreResourceBase#requireSuperAdminOrProjectAgent}) — человеческий порог не
 * тронут, там по-прежнему нужна именно {@code superadmin}, не {@code admin}.
 */
@Path("/lore")
public class LoreProjectResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreProjectResource.class);

    @jakarta.inject.Inject
    ProjectRbacService projectRbac;

    // hosts = JSON array string (ADR-018); default_branch = repo default branch.
    // JSON field names map 1:1 to record components (snake_case kept deliberately).
    // 22.11.2026: полей стало тринадцать. Состав держит сторож ProjectFieldParityTest — «что паспорт ПОКАЗЫВАЕТ,
    // то и должно записываться». До этого их было четыре, и короткий код проекта изменить было нечем НИКОМУ:
    // ни агенту (дверь не принимала), ни человеку (паспорт проекта в вебе только читается — его нет в
    // PASSPORT_TYPES). Выяснилось, когда владелица попросила переименовать MIGGEN → UDWE.
    // Не принимаются намеренно: slug (он и есть ключ), title и short_title (вычисляются из name/slug),
    // aliases (собираются из адресов репозиториев).
    public record ProjectCreateRequest(String slug, String name, String hosts, String default_branch,
                                       String short_code, String short_title_en, String short_title_pl,
                                       String title_en, String title_pl,
                                       String description, String description_en, String description_pl,
                                       Boolean is_private) {}

    @POST
    @Path("project")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createProject(ProjectCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        // AL-84/ADR-LORE-025-D17, поправка 2026-08-11: проект — единица изоляции
        // всей RBAC-модели, требует super-admin (не admin) — либо agent-full.
        requireSuperAdminOrProjectAgent(role);
        if (req == null || req.slug() == null || req.slug().isBlank())
            return badParams("slug required");
        if (!SAFE_ID.matcher(req.slug()).matches())
            return badParams("slug contains illegal characters");
        try {
            boolean existed = exists("KnowGitProject", "slug", req.slug()); // DBR-17: исход из факта
            // LH-44 partial-safe upsert: only SET fields that were actually supplied,
            // so a slug-only call never wipes an existing name.
            StringBuilder sql = new StringBuilder("UPDATE KnowGitProject SET slug=:slug");
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("slug", req.slug());
            if (req.name() != null) { sql.append(", name=:name"); p.put("name", req.name()); }
            if (req.hosts() != null) { sql.append(", hosts=:hosts"); p.put("hosts", req.hosts()); }
            if (req.default_branch() != null) { sql.append(", default_branch=:db"); p.put("db", req.default_branch()); }
            // Тем же правилом «пишем только переданное»: вызов с одним полем не стирает остальные.
            // Имя поля в SQL совпадает с именем в запросе — иначе сторож паритета их не сопоставит.
            String[][] plain = {
                {"short_code", req.short_code()}, {"short_title_en", req.short_title_en()},
                {"short_title_pl", req.short_title_pl()}, {"title_en", req.title_en()},
                {"title_pl", req.title_pl()}, {"description", req.description()},
                {"description_en", req.description_en()}, {"description_pl", req.description_pl()},
            };
            for (String[] kv : plain) {
                if (kv[1] == null) continue;
                sql.append(", ").append(kv[0]).append("=:").append(kv[0]);
                p.put(kv[0], kv[1]);
            }
            if (req.is_private() != null) { sql.append(", is_private=:is_private"); p.put("is_private", req.is_private()); }
            sql.append(" UPSERT WHERE slug=:slug");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                sql.toString(), p)).await().indefinitely();
            Map<String, Object> out = new java.util.LinkedHashMap<>();
            out.put("ok", true);
            out.put("slug", req.slug());
            out.put("outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED);
            grantCreatorOwnerIfOrphan(req.slug(), role, out);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE PROJECT CREATE] %s: %s", req.slug(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY)
                .entity(LoreUpstream.error(e)));
        }
    }

    /**
     * DS-1 (сверка DWL 24.10.2026): проект рождался БЕЗ единой роли, и скоуп
     * чтения прятал тела его доков и спек даже от того, кто его завёл. Скрытие
     * было честным («нет роли»), но вызывающему никто не говорил, что так будет.
     *
     * <p>Правило: если у проекта ещё НЕТ ни одной роли, роль {@code owner}
     * получает создатель — для агента это его владелец ({@code OWNED_BY}), для
     * человека — он сам, если заведён в графе. Проект с ролями не трогается:
     * повторный upsert не должен перехватывать чужое владение.
     *
     * <p>Права не расширяются сверх уже решённого: агент full и так выдаёт роли
     * своему владельцу (D-2026-LORE-FULL-WRITES-PROJECT-ROLES), а регистрировать
     * проект может только full или superadmin. Выдача журналируется, как любая.
     *
     * <p>Не вышло назначить — ответ говорит об этом прямо ({@code roles_warning}),
     * а не молчит: молчание и было исходной находкой.
     */
    private void grantCreatorOwnerIfOrphan(String slug, String byRole, Map<String, Object> out) {
        try {
            boolean hasRoles = !ingestService.queryPublic(
                "SELECT @rid AS rid FROM HAS_PROJECT_ROLE WHERE valid_to IS NULL AND @in.slug = :proj LIMIT 1",
                Map.of("proj", slug)).isEmpty();
            if (hasRoles) { out.put("roles_granted", java.util.List.of()); return; }

            String clientId = callerClientId();
            String grantee = clientId != null ? projectRbac.ownerKcSub(clientId) : callerKcSub();
            boolean known = grantee != null && !ingestService.queryPublic(
                "SELECT kc_sub FROM KnowUser WHERE kc_sub = :sub", Map.of("sub", grantee)).isEmpty();
            if (!known) {
                out.put("roles_granted", java.util.List.of());
                out.put("roles_warning", clientId != null
                    ? "у проекта нет ролей, а у агента " + clientId + " нет владельца в графе (OWNED_BY) — "
                      + "тела доков и спек проекта будут скрыты от всех, кроме superadmin; выдайте роль: project_role_set"
                    : "у проекта нет ролей, а вызывающий не заведён в графе (KnowUser) — "
                      + "тела доков и спек проекта будут скрыты от всех, кроме superadmin; выдайте роль: project_role_set");
                return;
            }
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "CREATE EDGE HAS_PROJECT_ROLE FROM (SELECT FROM KnowUser WHERE kc_sub=:sub) " +
                "TO (SELECT FROM KnowGitProject WHERE slug=:proj) SET role='owner', valid_from=:now",
                Map.of("sub", grantee, "proj", slug, "now", java.time.Instant.now().toString()))).await().indefinitely();
            // DBR-17: CREATE EDGE по пустой выборке — тихий no-op; без сверки
            // ответ заявил бы выданную роль, которой в графе нет.
            if (!edgeExists("HAS_PROJECT_ROLE", "kc_sub", grantee, "slug", slug)) {
                out.put("roles_granted", java.util.List.of());
                out.put("roles_warning", "ребро HAS_PROJECT_ROLE " + grantee + " → " + slug
                    + " не создано — выдайте роль project_role_set");
                return;
            }
            Map<String, Object> ev = new java.util.HashMap<>();
            ev.put("eid", java.util.UUID.randomUUID().toString());
            ev.put("sub", grantee);
            ev.put("proj", slug);
            ev.put("at", java.time.Instant.now().toString());
            ev.put("br", byRole == null ? "project_new" : byRole + " (project_new)");
            writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                "INSERT INTO KnowProjectRoleEvent SET event_uid=:eid, kc_sub=:sub, project=:proj, "
                + "role='owner', action='grant', at=:at, by_role=:br", ev)).await().indefinitely();
            out.put("roles_granted", java.util.List.of(Map.of("kc_sub", grantee, "role", "owner")));
        } catch (Exception e) {
            // Проект уже записан — роль вторична, но сбой обязан быть виден.
            LOG.warnf("[LORE PROJECT CREATE] роль владельцу %s не выдана: %s", slug, e.getMessage());
            out.put("roles_granted", java.util.List.of());
            out.put("roles_warning", "роль создателю не выдана: " + e.getMessage());
        }
    }
}
