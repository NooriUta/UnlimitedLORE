package studio.seer.heimdall.lore;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * AL-45 (UC-A7 «почему отказано», реактивный минимум): кольцевой буфер последних
 * отказов доступа по /lore/*. Полный аудит по осям — AL-20; этот буфер — то, что
 * можно дать УЖЕ сейчас без схемы: сами 401/403/409 ответы и есть данные.
 * Держим в памяти (переживает до рестарта) — для «агент только что получил 403,
 * почему?» этого достаточно; долговременная история — задача аудита, не буфера.
 *
 * Не пишем: тела запросов, токены, заголовки кроме X-Seer-Role. Пишем: время,
 * метод, путь, статус, код ошибки из LoreError, роль как её увидел сервер.
 */
@Provider
@ApplicationScoped
public class LoreDenialRecorder implements ContainerResponseFilter {

    public record Denial(String ts, String method, String path, int status, String error, String role) {}

    private static final int CAPACITY = 200;
    private final Deque<Denial> ring = new ArrayDeque<>(CAPACITY);

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext resp) {
        int s = resp.getStatus();
        if (s != 401 && s != 403 && s != 409) return;
        String path = req.getUriInfo().getPath();
        if (!path.startsWith("lore") && !path.startsWith("/lore")) return;
        String error = resp.getEntity() instanceof LoreResourceBase.LoreError le ? le.error() : "";
        Denial d = new Denial(Instant.now().toString(), req.getMethod(), path, s, error,
            String.valueOf(req.getHeaderString("X-Seer-Role")));
        synchronized (ring) {
            if (ring.size() >= CAPACITY) ring.removeLast();
            ring.addFirst(d);
        }
    }

    /** Снимок новейшие-первыми для /lore/kc/denials. */
    public List<Denial> snapshot() {
        synchronized (ring) { return new ArrayList<>(ring); }
    }
}
