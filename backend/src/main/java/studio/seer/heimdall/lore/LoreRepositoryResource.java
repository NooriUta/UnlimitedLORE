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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Путь записи реестра репозиториев (решение владелицы 22.11.2026, на вопрос «реестровые правки руками или через
 * дверь MCP»: «а что я, пусть доделывает MCP»).
 *
 * <p><b>Повод.</b> Сверка реестра LORE с живым Forgejo 22.11.2026: 13 репозиториев в реестре отсутствовали вовсе
 * (в том числе новый {@code AIDA/lorekit} и оба зеркала), у четырёх проект не выводился ниоткуда, связей
 * «использует» не было ни одной. Починить это было нечем: вершины {@code KnowRepository} и их рёбра создавал
 * ТОЛЬКО инструмент переноса — реестр чинился раз в миграцию и между миграциями протухал.
 *
 * <p><b>Права.</b> Слово владелицы: «репозиторий только админам И КТО ЗАВОДИТ ПРОЕКТЫ; организацию только с
 * административными правами full и с подтверждением». Поэтому замок тот же, что у проекта —
 * {@link LoreResourceBase#requireSuperAdminOrProjectAgent}: человек-админ или агент с профилем, которому
 * разрешено семейство project (full, architect, pm; см. AgentScopeFilter.FAMILY_AGENTS). Организация строже и
 * остаётся человеческой (HUMAN_ONLY).
 *
 * <ul>
 *   <li>{@code POST /lore/repository} — завести или обновить по адресу: {@code {url, default_branch}};</li>
 *   <li>{@code POST /lore/repository/link} — связь {@code project | component | uses | mirror}, {@code action=add|remove}.</li>
 * </ul>
 *
 * <p><b>Ключ — адрес</b> (D-2026-MIG-REPOSITORY-ORGANIZATION): {@code url} уникален у KnowRepository. Остальные
 * поля вычисляются ИЗ него ({@link #parseUrl}), чтобы в реестре не появилось записи, чей {@code full_path} не
 * сходится с адресом. Адрес клонирования ({@code …/repo.git}) и адрес страницы — один репозиторий: хвостовые
 * {@code /} и {@code .git} снимаются, иначе в реестре завёлся бы двойник.
 */
@Path("/lore")
public class LoreRepositoryResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreRepositoryResource.class);

    static final String NO_SCHEMA = "в схеме базы нет репозиториев (KnowRepository): они появляются с переносом 1.18 "
        + "(схема из модели); на старой схеме репозиторий завести нельзя";

    /** Адрес репозитория: схема, хост, владелец, имя — ровно два отрезка пути. */
    private static final Pattern URL = Pattern.compile("^(https?)://([A-Za-z0-9.\\-]+(?::\\d+)?)/([A-Za-z0-9._\\-]+)/([A-Za-z0-9._\\-]+?)(?:\\.git)?/?$");

    /** Связь реестра → ребро, вершина цели и её деловой ключ. Те же рёбра, что читает срез repositories. */
    static final Map<String, List<String>> TARGETS;
    static {
        Map<String, List<String>> m = new LinkedHashMap<>();
        // Направление — от проекта к репозиторию: срез читает in('HAS_REPOSITORY').slug.
        m.put("project", List.of("HAS_REPOSITORY", "KnowGitProject", "slug"));
        m.put("component", List.of("COMPONENT_REPOSITORY", "LoreComponent", "component_id"));
        m.put("uses", List.of("USES_REPOSITORY", "KnowRepository", "url"));
        m.put("mirror", List.of("MIRRORED_TO", "KnowRepository", "url"));
        TARGETS = java.util.Collections.unmodifiableMap(m);
    }

    /** Ребро, вершина и ключ цели; {@code null} — связь двери неизвестна. */
    static List<String> target(String rel) {
        return rel == null ? null : TARGETS.get(rel);
    }

    /** Роль ребра «проект ↔ репозиторий»; не задана — ребро без роли. */
    static boolean validRole(String role) {
        return role == null || role.isBlank() || "primary".equals(role) || "mirror".equals(role);
    }

    /** Связь допустима: репозиторий не ссылается сам на себя (это не связь, а порча графа). */
    static boolean linkAllowed(String rel, String url, String target) {
        if (!("uses".equals(rel) || "mirror".equals(rel))) return true;
        return url != null && !url.equals(target);
    }

    /** Разобранный адрес репозитория. */
    public record RepoKey(String url, String host, String owner, String name) {
        public String fullPath() { return host + "/" + owner + "/" + name; }
    }

    /** Адрес → ключ реестра; {@code null} — это не адрес репозитория (отказ до записи). */
    static RepoKey parseUrl(String raw) {
        if (raw == null) return null;
        Matcher m = URL.matcher(raw.trim());
        if (!m.matches()) return null;
        String url = m.group(1) + "://" + m.group(2) + "/" + m.group(3) + "/" + m.group(4);
        return new RepoKey(url, m.group(2), m.group(3), m.group(4));
    }

    public record RepoCreateRequest(String url, String default_branch) {}

    public record RepoLinkRequest(String url, String rel, String target, String role, String action) {}

    @POST
    @Path("repository")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createRepository(RepoCreateRequest req, @HeaderParam("X-Seer-Role") String role) {
        if (!enabled) return disabled();
        requireSuperAdminOrProjectAgent(role);
        RepoKey k = parseUrl(req == null ? null : req.url());
        if (k == null) return badParams("url: нужен адрес репозитория вида https://хост/владелец/имя");
        try {
            if (!hasRepositoryType()) return noSchema();
            boolean existed = exists("KnowRepository", "url", k.url());
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("url", k.url());
            p.put("host", k.host());
            p.put("owner", k.owner());
            p.put("name", k.name());
            p.put("full_path", k.fullPath());
            String branch = req.default_branch() == null || req.default_branch().isBlank() ? null : req.default_branch().trim();
            String set = "host=:host, owner=:owner, name=:name, full_path=:full_path";
            if (branch != null) { set += ", default_branch=:branch"; p.put("branch", branch); }
            // UPSERT ArcadeDB требует уникального индекса по url, а он в схеме из модели не гарантирован:
            // поэтому «есть — UPDATE, нет — INSERT», как у организации.
            String sql = existed
                ? "UPDATE KnowRepository SET " + set + " WHERE url=:url"
                : "INSERT INTO KnowRepository SET url=:url, " + set;
            Object wrote = writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql, p))
                .await().indefinitely();
            // Правка по ключу, не нашедшая строку, — отказ, а не ok:true (сторож UpdateAffectedRowsGuardTest).
            // Случай живой: запись могли удалить между проверкой exists и этим UPDATE.
            if (existed && WriteCount.missed(wrote))
                return WriteCount.notFound("repository", k.url(), "обновление полей репозитория");
            for (String e : TARGETS.values().stream().map(t -> t.get(0)).distinct().toList())
                writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql",
                    "CREATE EDGE TYPE " + e + " IF NOT EXISTS", Map.of())).await().indefinitely();
            if (!exists("KnowRepository", "url", k.url()))   // DBR-17: исход из факта, а не из кода ответа
                return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(new LoreError("NOT_WRITTEN",
                    "репозиторий " + k.url() + " не появился после записи")));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("url", k.url());
            out.put("full_path", k.fullPath());
            out.put("outcome", existed ? LoreOutcome.UPDATED : LoreOutcome.CREATED);
            return noStore(Response.ok(out));
        } catch (Exception e) {
            LOG.warnf("[LORE REPO CREATE] %s: %s", k.url(), e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    @POST
    @Path("repository/link")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response linkRepository(RepoLinkRequest req, @HeaderParam("X-Seer-Role") String seerRole) {
        if (!enabled) return disabled();
        requireSuperAdminOrProjectAgent(seerRole);
        if (req == null || req.target() == null || req.target().isBlank())
            return badParams("url, rel, target required");
        RepoKey k = parseUrl(req.url());
        if (k == null) return badParams("url: нужен адрес репозитория вида https://хост/владелец/имя");
        List<String> t = target(req.rel());
        if (t == null) return badParams("rel must be one of " + TARGETS.keySet());
        if (!validRole(req.role())) return badParams("role must be primary or mirror");
        String rel = t.get(0), vertex = t.get(1), key = t.get(2);
        // Цель-репозиторий тоже приводим к канону: иначе связь уйдёт на двойник с .git на конце.
        String targetKey = req.target().trim();
        if ("KnowRepository".equals(vertex)) {
            RepoKey tk = parseUrl(targetKey);
            if (tk == null) return badParams("target: нужен адрес репозитория вида https://хост/владелец/имя");
            targetKey = tk.url();
        } else if (!SAFE_READ_ID.matcher(targetKey).matches()) {
            return badParams("target contains illegal characters");
        }
        if (!linkAllowed(req.rel(), k.url(), targetKey))
            return badParams("репозиторий не может ссылаться сам на себя");
        boolean remove = "remove".equalsIgnoreCase(req.action());
        // Направление ребра: у project и component начало — ЧУЖАЯ вершина (срез читает in('…')), у uses и
        // mirror — сам репозиторий. Перепутать направление значит получить связь, которой не видно в реестре.
        boolean fromRepo = "uses".equals(req.rel()) || "mirror".equals(req.rel());
        try {
            if (!hasRepositoryType()) return noSchema();
            Map<String, Object> base = new LinkedHashMap<>();
            base.put("ok", true);
            base.put("url", k.url());
            base.put("rel", req.rel());
            base.put("target", targetKey);
            boolean had = fromRepo
                ? edgeExists(rel, "url", k.url(), key, targetKey)
                : edgeExists(rel, key, targetKey, "url", k.url());
            if (remove) {
                String sql = fromRepo
                    ? "DELETE FROM (SELECT expand(outE('" + rel + "')) FROM KnowRepository WHERE url=:url) WHERE @in." + key + " = :t"
                    : "DELETE FROM (SELECT expand(inE('" + rel + "')) FROM KnowRepository WHERE url=:url) WHERE @out." + key + " = :t";
                if (had) writeClient.command(db, basicAuth(), new LoreCommandClient.LoreCommand("sql", sql,
                    Map.of("url", k.url(), "t", targetKey))).await().indefinitely();
                base.put("action", "removed");
                return unlinkOutcome(base, had);
            }
            // Отказ ДО записи: отсутствующий конец не оставляет полузаписи.
            if (!exists("KnowRepository", "url", k.url())) return targetNotFound("репозитория " + k.url() + " нет");
            if (!exists(vertex, key, targetKey)) return targetNotFound(vertex + " " + targetKey + " нет");
            String role = req.role() == null || req.role().isBlank() ? null : req.role().trim();
            String setRole = role == null ? "" : " SET role = :role";
            String sql = fromRepo
                ? "CREATE EDGE " + rel + " FROM (SELECT FROM KnowRepository WHERE url = :url) "
                  + "TO (SELECT FROM " + vertex + " WHERE " + key + " = :t)" + setRole + " IF NOT EXISTS"
                : "CREATE EDGE " + rel + " FROM (SELECT FROM " + vertex + " WHERE " + key + " = :t) "
                  + "TO (SELECT FROM KnowRepository WHERE url = :url)" + setRole + " IF NOT EXISTS";
            Map<String, Object> p = new java.util.HashMap<>();
            p.put("url", k.url());
            p.put("t", targetKey);
            if (role != null) p.put("role", role);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> created = (List<Map<String, Object>>) writeClient.command(db, basicAuth(),
                new LoreCommandClient.LoreCommand("sql", sql, p)).await().indefinitely().result();
            base.put("action", "added");
            if (role != null) base.put("role", role);
            return fromRepo
                ? linkOutcome(had, base, created != null && !created.isEmpty(), rel, "url", k.url(), key, targetKey,
                    "репозиторий " + k.url() + " или " + vertex + " " + targetKey)
                : linkOutcome(had, base, created != null && !created.isEmpty(), rel, key, targetKey, "url", k.url(),
                    vertex + " " + targetKey + " или репозиторий " + k.url());
        } catch (Exception e) {
            LOG.warnf("[LORE REPO LINK] %s %s %s: %s", k.url(), req.rel(), targetKey, e.getMessage());
            return noStore(Response.status(Response.Status.BAD_GATEWAY).entity(LoreUpstream.error(e)));
        }
    }

    /** Есть ли в схеме вершина репозитория. Сбой чтения летит наверх: «не смогли проверить» ≠ «нет». */
    boolean hasRepositoryType() {
        return !ingestService.queryPublic("SELECT name FROM schema:types WHERE name = 'KnowRepository'", Map.of()).isEmpty();
    }

    private Response noSchema() {
        return noStore(Response.status(Response.Status.CONFLICT).entity(new LoreError("NO_REPOSITORY_SCHEMA", NO_SCHEMA)));
    }
}
