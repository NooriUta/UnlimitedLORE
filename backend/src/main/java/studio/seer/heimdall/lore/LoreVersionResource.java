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
        Map<String, Object> out = info(System.getenv("LORE_RELEASE_TAG"));
        // MIG-01: база из модели (отметка LoreModelSchema) — версия модели, а не номер шага V кода. Отметки не прочитали —
        // номер шага, как раньше (база шагов или ещё не поднялась).
        java.util.List<Map<String, Object>> markers;
        try {
            markers = ingestService.queryPublic("SELECT model_hash, source, built_at FROM LoreModelSchema", Map.of());
        } catch (RuntimeException e) {
            markers = java.util.List.of();
        }
        out.putAll(schemaOf(LoreSchemaMigrations.codeVersion(), markers));
        return noStore(Response.ok(out));
    }

    /**
     * Сведения о сборке — одни для {@code /lore/version} и блока {@code server} в {@code /lore/model}
     * (MC-09: клиент сравнивает с ними {@code since} контракта списка).
     */
    static Map<String, Object> info(String releaseEnv) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("commit", BUILD.get("commit"));
        out.put("built_at", BUILD.get("built_at"));
        // Из того же реестра, что ведёт миграции: две правды о номере схемы
        // разошлись бы первой же правкой.
        out.put("schema_version", LoreSchemaMigrations.codeVersion());
        // Владелица 09.11: версия в правом нижнем углу. Тег релиза сборка не знает — его
        // передаёт выкатка прода (LORE_RELEASE_TAG). Нет — null, а не выдуманная версия.
        out.put("release", releaseTag(releaseEnv));
        return out;
    }

    /** Версия схемы базы: из модели — {@code model:<хэш модели>}, иначе — номер последнего шага V кода. */
    static Map<String, Object> schemaOf(int codeVersion, java.util.List<Map<String, Object>> markers) {
        Map<String, Object> m = new LinkedHashMap<>();
        String hash = markers.stream().map(x -> x.get("model_hash")).filter(h -> h != null && !String.valueOf(h).isBlank())
            .map(String::valueOf).findFirst().orElse(null);
        if (hash != null) {
            m.put("schema_version", "model:" + hash);
            m.put("schema_source", "model");
        } else {
            m.put("schema_version", codeVersion);
            m.put("schema_source", "steps");
        }
        return m;
    }

    private static final java.util.regex.Pattern TAG = java.util.regex.Pattern.compile("^v[0-9]+[.][0-9]+[.][0-9]+$");

    /** Тег релиза вида vX.Y.Z или null. */
    static String releaseTag(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        return TAG.matcher(t).matches() ? t : null;
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
