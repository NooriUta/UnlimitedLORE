package studio.seer.heimdall.lore;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.Map;

/**
 * AL-20 (R5) — аудит-лог write-операций: ось (human|agent), роль из токена,
 * write-семейство, entity_id (по возможности), время. Отдельная строка в
 * логе на каждую write-попытку — принятую ИЛИ отклонённую (403 от
 * {@link AgentScopeFilter} или {@code requireAdmin} тоже попадает сюда,
 * потому что response-фильтр отрабатывает даже после {@code abortWith}).
 *
 * <h2>Почему лог-файл, а не вершина графа</h2>
 * Вариант "вершина KnowAuditEvent" требует новый тип в схеме ArcadeDB — то
 * есть новый шаг миграции. Любой локальный {@code ./gradlew test} применяет
 * незакоммиченный шаг миграции к БОЕВОЙ {@code system_aida_lore}
 * (см. заметку в LORE lore-livedb-test-migrates-prod) — то есть само
 * тестирование PR со схемным изменением рискует увести прод-схему вперёд
 * задеплоенного бинаря. Строка в лог-файле такого риска не несёт: она
 * аддитивна, ничего не мигрирует и видна через {@code docker compose logs}
 * / любой log-шиппер без отдельного эндпоинта.
 *
 * <p>Слайс {@code audit_writes}, который просило R5, здесь сознательно НЕ
 * заведён — слайсы читают ArcadeDB, а эти записи там не лежат. Если
 * понадобится запрос из UI, это отдельный маленький REST-эндпоинт поверх
 * лог-файла (grep/tail), а не {@code query_slice}.
 *
 * <h2>«Кто писал» = факт токена</h2>
 * Ось и роль берутся из JWT-клеймов ({@code agent_scope} → agent, иначе
 * {@code X-Seer-Role} → human), а не из тела запроса. {@code author_agent} в
 * теле задачи/спринта остаётся человекочитаемой меткой автора — она может
 * не совпадать с реальным вызывающим (например, PM заводит задачу и ставит
 * себя автором вручную), и подменять ею факт токена значило бы утверждать
 * то, чего фильтр не проверял.
 *
 * <h2>entity_id — best-effort</h2>
 * Читается из ТЕЛА ОТВЕТА (response-фильтр видит Java-объект контроллера,
 * а не сериализованный поток), а не из тела запроса — так не нужно ни
 * буферизовать/восстанавливать input stream, ни знать имя id-поля для
 * каждого из ~30 семейств заранее. Большинство write-эндпоинтов уже эхуют
 * свой id обратно ({@code Map.of("ok", true, "task_uid", ...)}) — ищем
 * первый ключ, оканчивающийся на {@code _id}/{@code _uid}, либо ровно
 * {@code id}. Если эндпоинт не эхует — entity_id остаётся null, это не
 * авария: семейство+путь и так есть в строке.
 */
@Provider
public class LoreAuditLogFilter implements ContainerResponseFilter {

    private static final Logger AUDIT = Logger.getLogger("lore.audit");

    @Inject
    SecurityIdentity identity;

    @ConfigProperty(name = "quarkus.oidc.enabled", defaultValue = "false")
    boolean oidcEnabled;

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        if (AgentScopeFilter.READ_METHODS.contains(req.getMethod())) return;
        String path = req.getUriInfo().getPath();
        String family = AgentScopeFilter.familyOf(path);
        if (family == null) return; // не /lore/* — не наш периметр

        String axis;
        String role;
        if (oidcEnabled && identity != null && !identity.isAnonymous()) {
            String scope = AgentScopeFilter.agentScopeOf(identity);
            if (scope != null) { axis = "agent"; role = scope; }
            else { axis = "human"; role = humanRole(req); }
        } else {
            // dev/local без токенов (LORE_AUTH_ENABLED=false) — ось известна быть не
            // может, роль берём из заголовка как и остальной путь без auth.
            axis = "unauth";
            role = humanRole(req);
        }

        AUDIT.infof("ts=%s axis=%s role=%s family=%s path=%s method=%s status=%d entity_id=%s",
            Instant.now(), axis, role, family, path, req.getMethod(), res.getStatus(),
            entityIdOf(res.getEntity()));
    }

    private static String humanRole(ContainerRequestContext req) {
        String r = req.getHeaderString("X-Seer-Role");
        return r == null || r.isBlank() ? "unknown" : r;
    }

    /** Первый ключ вида *_id / *_uid / "id" в ответе-Map — иначе null. */
    private static String entityIdOf(Object entity) {
        if (!(entity instanceof Map<?, ?> m)) return null;
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (!(e.getKey() instanceof String k)) continue;
            if (k.equals("id") || k.endsWith("_id") || k.endsWith("_uid")) {
                Object v = e.getValue();
                if (v != null) return String.valueOf(v);
            }
        }
        return null;
    }
}
