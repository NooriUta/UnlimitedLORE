package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.MediaType;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;
import org.jboss.resteasy.reactive.server.ServerResponseFilter;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · общий слой «вид значения записи против модели» для всех путей
 * записи {@code /lore/*} (task_set, sprint_set, spec_set, sprint_plan_set, adr_set и др.), без правки
 * каждого ресурса.
 *
 * <p>Запрос: тело JSON читается до ресурса ({@code readBody = true} — тело уже в памяти, поток событий
 * не блокируется) и возвращается ресурсу тем же байт в байт; сверка — {@link LoreWriteKinds#check}.
 * Несовпадения пишутся в журнал {@code lore.write.kinds} (WARN) и кладутся в свойство запроса.
 * Ответ: тело-объект получает {@code warnings[]}. Запись не отклоняется никогда — ответ владелицы
 * 15.11.2026: проверка типа при записи — «предупреждение».
 *
 * <p>Ошибка самой проверки (тело не JSON, неизвестный путь) не меняет ни запрос, ни ответ: ресурс
 * отвечает на тело, как раньше.
 */
public class LoreWriteKindsFilter {

    private static final Logger LOG = Logger.getLogger("lore.write.kinds");
    static final String PROP = "lore.write.kinds.warnings";
    private static final Set<String> WRITE = Set.of("POST", "PUT", "PATCH");

    @Inject
    ObjectMapper mapper;

    @ServerRequestFilter(readBody = true)
    public void onRequest(ContainerRequestContext req) {
        if (!WRITE.contains(req.getMethod())) return;
        String path = req.getUriInfo().getPath();
        if (LoreWriteKinds.fieldsFor(path).isEmpty()) return;
        MediaType mt = req.getMediaType();
        if (mt == null || !LoreTimeFormatResponseFilter.isJson(mt) || !req.hasEntity()) return;
        byte[] body;
        try (InputStream in = req.getEntityStream()) {
            body = in.readAllBytes();
        } catch (IOException e) {
            return;
        }
        req.setEntityStream(new ByteArrayInputStream(body));
        List<Map<String, Object>> warnings;
        try {
            JsonNode tree = mapper.readTree(body);
            warnings = LoreWriteKinds.check(path, tree);
        } catch (IOException | RuntimeException e) {
            return; // не JSON — ресурс ответит на тело сам, как раньше
        }
        if (warnings.isEmpty()) return;
        for (Map<String, Object> w : warnings)
            LOG.warnf("write kind mismatch path=%s field=%s model=%s kind=%s value=%s", path, w.get("field"),
                w.get("model_field"), w.get("kind"), w.get("value"));
        req.setProperty(PROP, warnings);
    }

    @ServerResponseFilter
    @SuppressWarnings("unchecked")
    public void onResponse(ContainerRequestContext req, ContainerResponseContext res) {
        Object w = req.getProperty(PROP);
        if (!(w instanceof List<?> list) || list.isEmpty() || !res.hasEntity()) return;
        MediaType mt = res.getMediaType();
        if (mt != null && !LoreTimeFormatResponseFilter.isJson(mt)) return;
        Object before = res.getEntity();
        Object after = LoreWriteKinds.withWarnings(before, (List<Map<String, Object>>) list, mapper);
        if (after != before) res.setEntity(after, res.getEntityAnnotations(), mt != null ? mt : MediaType.APPLICATION_JSON_TYPE);
    }
}
