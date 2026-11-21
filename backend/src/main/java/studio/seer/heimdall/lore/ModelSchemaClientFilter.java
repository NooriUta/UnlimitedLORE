package studio.seer.heimdall.lore;

import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import jakarta.ws.rs.client.ClientResponseContext;
import jakarta.ws.rs.client.ClientResponseFilter;
import studio.seer.heimdall.bench.MartQuery;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · переходник новой схемы на уровне клиента ArcadeDB (configKey mart-api).
 *
 * <p>Чтение и запись идут к базе разными клиентами (MartClient — срезы, LoreCommandClient — запись и ingest),
 * поэтому переходник стоит здесь, а не в одной из точек вызова: SQL и параметры запроса — под новую схему,
 * ответ — в прежнем виде. Выключен (база со старой схемой) — фильтр ничего не делает.
 */
public class ModelSchemaClientFilter implements ClientRequestFilter, ClientResponseFilter {

    private static final org.jboss.logging.Logger LOG = org.jboss.logging.Logger.getLogger(ModelSchemaClientFilter.class);

    @Override
    public void filter(ClientRequestContext req) {
        Object e = req.getEntity();
        if (!ModelSchemaAdapter.enabled()) {
            // MDL-06 (патч 1.18.1): и на старой схеме каждый :param — в карте, даже null; пропуск — отказ движка
            if (e instanceof LoreCommandClient.LoreCommand c && isSql(c.language())) {
                java.util.Map<String, Object> p = SqlParams.complete(c.command(), c.params());
                if (p != c.params()) req.setEntity(new LoreCommandClient.LoreCommand(c.language(), c.command(), p),
                    req.getEntityAnnotations(), req.getMediaType());
            }
            return;
        }
        if (e instanceof MartQuery q && isSql(q.language())) {
            String sql = ModelSchemaAdapter.rewriteSql(q.command());
            req.setEntity(new MartQuery(q.language(), sql,
                SqlParams.complete(sql, ModelSchemaAdapter.rewriteParams(q.command(), q.params())), q.limit()), req.getEntityAnnotations(), req.getMediaType());
        } else if (e instanceof LoreCommandClient.LoreCommand c && isSql(c.language())) {
            // MDL-06 (патч 1.18.1): переходник переименовал :status_raw в :status — параметр под новым именем, и при null
            String sql = ModelSchemaAdapter.rewriteSql(c.command());
            req.setEntity(new LoreCommandClient.LoreCommand(c.language(), sql,
                SqlParams.complete(sql, ModelSchemaAdapter.rewriteParams(c.command(), c.params()))), req.getEntityAnnotations(), req.getMediaType());
        }
    }

    @Override
    public void filter(ClientRequestContext req, ClientResponseContext res) throws IOException {
        if (!ModelSchemaAdapter.enabled() || !res.hasEntity()) return;
        InputStream in = res.getEntityStream();
        String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        // Отказ базы на новой схеме — с телом ответа и SQL: без них «409»/«500» не разобрать (вызовы записи
        // разворачивают ответ не везде).
        if (res.getStatus() >= 400) {
            Object e = req.getEntity();
            String sql = e instanceof MartQuery q ? q.command() : e instanceof LoreCommandClient.LoreCommand c ? c.command() : "";
            LOG.warnf("[LORE MODEL-SCHEMA] база ответила %d: %s | sql: %s", res.getStatus(),
                body.length() > 600 ? body.substring(0, 600) : body, sql.length() > 1500 ? sql.substring(0, 1500) : sql);
        }
        res.setEntityStream(new ByteArrayInputStream(ModelSchemaAdapter.adaptJson(body).getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isSql(String language) {
        return "sql".equalsIgnoreCase(language) || "sqlscript".equalsIgnoreCase(language);
    }
}
