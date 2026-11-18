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

    @Override
    public void filter(ClientRequestContext req) {
        if (!ModelSchemaAdapter.enabled()) return;
        Object e = req.getEntity();
        if (e instanceof MartQuery q && isSql(q.language())) {
            req.setEntity(new MartQuery(q.language(), ModelSchemaAdapter.rewriteSql(q.command()),
                ModelSchemaAdapter.rewriteParams(q.command(), q.params()), q.limit()), req.getEntityAnnotations(), req.getMediaType());
        } else if (e instanceof LoreCommandClient.LoreCommand c && isSql(c.language())) {
            req.setEntity(new LoreCommandClient.LoreCommand(c.language(), ModelSchemaAdapter.rewriteSql(c.command()),
                ModelSchemaAdapter.rewriteParams(c.command(), c.params())), req.getEntityAnnotations(), req.getMediaType());
        }
    }

    @Override
    public void filter(ClientRequestContext req, ClientResponseContext res) throws IOException {
        if (!ModelSchemaAdapter.enabled() || !res.hasEntity()) return;
        InputStream in = res.getEntityStream();
        String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        res.setEntityStream(new ByteArrayInputStream(ModelSchemaAdapter.adaptJson(body).getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isSql(String language) {
        return "sql".equalsIgnoreCase(language) || "sqlscript".equalsIgnoreCase(language);
    }
}
