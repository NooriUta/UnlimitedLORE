package studio.seer.heimdall.lore;

import io.vertx.core.Context;
import io.vertx.core.Vertx;
import jakarta.annotation.Priority;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.ext.Provider;

import java.lang.reflect.Method;
import java.util.regex.Pattern;

/**
 * SPRINT_LORE_OWN_HOST/OH-SLOW-QUERY-LOG · источник вызова ArcadeDB для журнала медленных запросов.
 *
 * <p>Серверный фильтр кладёт в локальные данные Vert.x-контекста запроса подпись источника: шаблон
 * эндпоинта LORE ({@code GET /lore/slice/{id}}), а у среза — ещё и его id ({@code slice:tasks_of_sprint}).
 * Клиентский {@link SlowQueryClientFilter} читает её при вызове базы. Берётся шаблон пути, а не сам путь:
 * в пути бывают идентификаторы записей, а журнал должен сводиться к топу по источникам.
 *
 * <p>Вызов вне HTTP-запроса (планировщик, старт) — {@link #NONE}.
 */
@Provider
@Priority(Priorities.USER)
public class QuerySource implements ContainerRequestFilter {

    static final String NONE = "background";
    private static final String KEY = "lore.query-source";
    private static final Pattern SLICE_ID = Pattern.compile("[a-z0-9_]{1,80}");

    @jakarta.ws.rs.core.Context
    ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext req) {
        try {
            Context ctx = Vertx.currentContext();
            if (ctx == null) return;
            String template = template(resourceInfo == null ? null : resourceInfo.getResourceClass(),
                resourceInfo == null ? null : resourceInfo.getResourceMethod());
            String sliceId = req.getUriInfo().getPathParameters().getFirst("id");
            ctx.putLocal(KEY, label(req.getMethod(), template, sliceId));
        } catch (RuntimeException ignore) {
            // подпись источника — удобство журнала, не повод ронять запрос
        }
    }

    /** Подпись источника для текущего контекста или {@link #NONE}. */
    static String current() {
        try {
            Context ctx = Vertx.currentContext();
            Object v = ctx == null ? null : ctx.getLocal(KEY);
            return v == null ? NONE : v.toString();
        } catch (RuntimeException e) {
            return NONE;
        }
    }

    /** «METHOD /шаблон»; у среза — «slice:&lt;id&gt;», если id похож на имя среза. */
    static String label(String method, String template, String sliceId) {
        String t = template == null || template.isBlank() ? "?" : template;
        if (t.contains("/slice/{id}") && sliceId != null && SLICE_ID.matcher(sliceId).matches())
            return "slice:" + sliceId + (t.endsWith("/{id}") ? "" : t.substring(t.indexOf("/{id}") + 5));
        return (method == null ? "" : method + " ") + t;
    }

    static String template(Class<?> cls, Method m) {
        StringBuilder sb = new StringBuilder();
        if (cls != null) append(sb, cls.getAnnotation(Path.class));
        if (m != null) append(sb, m.getAnnotation(Path.class));
        return sb.toString();
    }

    private static void append(StringBuilder sb, Path p) {
        if (p == null) return;
        String v = p.value();
        if (v.isEmpty() || v.equals("/")) return;
        if (!v.startsWith("/")) sb.append('/');
        sb.append(v.endsWith("/") ? v.substring(0, v.length() - 1) : v);
    }
}
