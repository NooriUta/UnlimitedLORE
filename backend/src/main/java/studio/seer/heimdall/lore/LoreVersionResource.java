package studio.seer.heimdall.lore;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

/**
 * SE-10: из какого коммита собран бэкенд и какую версию схемы несёт код.
 *
 * <p>MCP-сервер сессий собирается из основного чекаута руками и живёт своей
 * жизнью: 10.09.2026 он оказался на 281 коммит позади develop, и правки схем
 * инструментов до агентов не доходили — новый параметр давал честный отказ
 * «Unrecognized key», а исправленное описание не давало ничего. Чтобы такое
 * расхождение стало ВИДНЫМ, обе стороны должны знать свою сборку. Эта ручка —
 * половина бэкенда; MCP сверяет с ней свою отметку и предупреждает.
 *
 * <p>Читается без admin: версия — не секрет, а спрашивает её в первую очередь
 * агент, у которого прав может не быть вовсе.
 *
 * <p>Отметку кладёт Gradle в {@code build-info.properties} (см. build.gradle,
 * задача generateBuildInfo). Нет файла — «unknown», не пустота и не 500:
 * пустое поле неотличимо от «ручки нет», а 500 — от «бэкенд лежит».
 */
@Path("/lore")
public class LoreVersionResource extends LoreResourceBase {

    private static final Logger LOG = Logger.getLogger(LoreVersionResource.class);

    private static final Map<String, String> BUILD = loadBuildInfo();

    @GET
    @Path("version")
    @Produces(MediaType.APPLICATION_JSON)
    public Response version() {
        if (!enabled) return disabled();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("commit", BUILD.get("commit"));
        out.put("built_at", BUILD.get("built_at"));
        // Из того же реестра, что ведёт миграции: две правды о номере схемы
        // разошлись бы первой же правкой.
        out.put("schema_version", LoreSchemaMigrations.codeVersion());
        return noStore(Response.ok(out));
    }

    static Map<String, String> loadBuildInfo() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("commit", "unknown");
        m.put("built_at", "");
        try (InputStream in = LoreVersionResource.class.getClassLoader()
                .getResourceAsStream("build-info.properties")) {
            if (in == null) {
                LOG.warn("[LORE VERSION] build-info.properties нет в classpath — отвечаю unknown");
                return m;
            }
            Properties p = new Properties();
            p.load(in);
            String commit = p.getProperty("commit", "").trim();
            String builtAt = p.getProperty("built_at", "").trim();
            if (!commit.isEmpty()) m.put("commit", commit);
            m.put("built_at", builtAt);
        } catch (Exception e) {
            LOG.warnf("[LORE VERSION] build-info.properties не прочитан: %s — отвечаю unknown", e.getMessage());
        }
        return m;
    }
}
