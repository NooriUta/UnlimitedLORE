package studio.seer.heimdall.lore;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.UriInfo;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Приёмка препрода 0dccfe73 (14.11.2026): в «Последних отказах доступа» у анонимного 401
 * колонка «Роль» показывала слово «null». Корень: String.valueOf(getHeaderString(...))
 * превращает ОТСУТСТВУЮЩИЙ заголовок X-Seer-Role в строку "null", и клиент честно её рисует.
 * Правило: нет заголовка — роли нет (null), а не четыре буквы.
 *
 * Чистый юнит: контексты JAX-RS — прокси, Quarkus и БД не нужны.
 */
class LoreDenialRecorderRoleTest {

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, Map<String, Object> answers) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type},
            (p, m, args) -> {
                if (m.getName().equals("getHeaderString")) return answers.get("header:" + args[0]);
                return answers.get(m.getName());
            });
    }

    private static LoreDenialRecorder.Denial record(String roleHeader) {
        LoreDenialRecorder rec = new LoreDenialRecorder();
        UriInfo uri = proxy(UriInfo.class, Map.of("getPath", "/lore/version"));
        java.util.HashMap<String, Object> req = new java.util.HashMap<>(Map.of("getUriInfo", uri, "getMethod", "GET"));
        if (roleHeader != null) req.put("header:X-Seer-Role", roleHeader);
        ContainerRequestContext rq = proxy(ContainerRequestContext.class, req);
        ContainerResponseContext rs = proxy(ContainerResponseContext.class, Map.of("getStatus", 401));
        rec.filter(rq, rs);
        return rec.snapshot().get(0);
    }

    @Test
    void absentRoleHeaderIsNullNotTheWordNull() {
        assertNull(record(null).role(), "нет X-Seer-Role — роли нет, а не строка \"null\"");
    }

    @Test
    void presentRoleHeaderIsKept() {
        assertEquals("admin", record("admin").role());
    }
}
