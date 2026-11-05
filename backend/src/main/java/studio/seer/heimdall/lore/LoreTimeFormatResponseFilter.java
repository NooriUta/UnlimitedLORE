package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.ext.Provider;

import java.util.Collection;
import java.util.Map;

/**
 * RM-P13: ЕДИНАЯ точка, где время уходит наружу как ISO-8601 UTC с {@code Z} —
 * для всех JSON-ответов сервера, а не только слайсов.
 *
 * <p>После V56 время *Hist — нативный DATETIME, и ArcadeDB печатает его
 * «2026-04-13 00:00:00.123» без зоны. Через {@code queryPublic} такие строки
 * идут в паспорта, историю и прочие ~120 вызовов ресурсов; {@code new Date()}
 * в браузере прочёл бы их как МЕСТНОЕ время. Правило значения —
 * {@link LoreTimeFormat#isoUtc} (строка ЦЕЛИКОМ формы рендера → ISO-Z, прочее
 * без изменений).
 *
 * <p><b>Почему фильтр ответа, а не {@code ObjectMapperCustomizer}.</b>
 * Сериализация — Jackson ({@code quarkus-rest-jackson}), но тот же CDI
 * {@code ObjectMapper} инжектится и в {@code ClientJacksonMessageBodyWriter}
 * REST-клиента ({@code quarkus-rest-client-jackson} 3.38.0, конструктор с
 * {@code @Inject ObjectMapper}). Глобальный сериализатор {@code String}
 * переписывал бы и ИСХОДЯЩИЕ тела — параметры команд в ArcadeDB, запросы в
 * Forgejo и Keycloak. {@code ContainerResponseFilter} — только сервер, только
 * ответ.
 *
 * <p>Тело, которое не Map/List (record, POJO корпуса), переводится в дерево тем
 * же {@code ObjectMapper}, что потом его и сериализует, — JSON на выходе тот же,
 * кроме приведённых строк. Строковое тело (уже готовый JSON или текст), байты и
 * потоки не трогаются.
 *
 * <p><b>Исключение — {@code /bench/*}.</b> Это витрина эксперимента RAGVSDL, а
 * не корпус: её отметки времени записаны МЕСТНЫМИ часами стенда
 * ({@code parseMuninnTimestamp} во фронте так их и читает). Дописать им
 * {@code Z} значило бы сдвинуть их на смещение машины.
 */
@Provider
public class LoreTimeFormatResponseFilter implements ContainerResponseFilter {

    @Inject
    ObjectMapper mapper;

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        if (!res.hasEntity() || isBench(req.getUriInfo().getPath())) return;
        MediaType mt = res.getMediaType();
        if (mt != null && !isJson(mt)) return;
        Object before = res.getEntity();
        Object after = isoUtcEntity(before, mapper);
        if (after != before) res.setEntity(after, res.getEntityAnnotations(),
            mt != null ? mt : MediaType.APPLICATION_JSON_TYPE);
    }

    static boolean isBench(String path) {
        String p = path == null ? "" : path;
        return p.equals("/bench") || p.startsWith("/bench/") || p.equals("bench") || p.startsWith("bench/");
    }

    static boolean isJson(MediaType mt) {
        return MediaType.APPLICATION_JSON_TYPE.isCompatible(mt) || mt.getSubtype().endsWith("+json");
    }

    /**
     * Тело ответа → то же тело с приведённым временем (дерево Jackson) либо сам
     * вход, если такое тело не наше (строка, байты, поток, чужой тип).
     */
    static Object isoUtcEntity(Object e, ObjectMapper mapper) {
        if (!walkable(e)) return e;
        JsonNode tree = e instanceof JsonNode n ? n.deepCopy() : mapper.valueToTree(e);
        return LoreTimeFormat.isoUtcTree(tree);
    }

    private static boolean walkable(Object e) {
        if (e == null) return false;
        if (e instanceof Map<?, ?> || e instanceof Collection<?> || e instanceof JsonNode || e instanceof Record) return true;
        Package p = e.getClass().getPackage();
        return p != null && p.getName().startsWith("studio.seer.");
    }
}
