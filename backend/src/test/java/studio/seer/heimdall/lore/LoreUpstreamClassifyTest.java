package studio.seer.heimdall.lore;

import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-03 (B-05): «база лежит» ≠ «запрос упал».
 *
 * <p>До правки любой отказ чтения уходил наружу одним кодом LORE_UPSTREAM, а
 * клиент читает его как «LORE недоступен» и заменяет ВСЮ страницу. Сломанный
 * SQL одного слайса (битый индекс, ошибка разбора) гасил так экран целиком,
 * хотя база жива и остальные блоки отвечают.
 *
 * <p>Правило: LORE_UPSTREAM — только когда до базы не достучались (соединение,
 * таймаут, DNS, 502/503/504 прокси, отвергнутый кред — всё это глобально).
 * База ответила ошибкой на конкретный запрос — LORE_QUERY_FAILED, ошибка блока.
 */
class LoreUpstreamClassifyTest {

    private static WebApplicationException http(int status) {
        return new WebApplicationException(Response.status(status).build());
    }

    @Test
    void отказСоединенияЭтоБазаНедоступна() {
        assertTrue(LoreUpstream.dbUnreachable(new ProcessingException(new ConnectException("Connection refused"))));
        assertTrue(LoreUpstream.dbUnreachable(new ProcessingException(new UnknownHostException("ygg"))));
        assertTrue(LoreUpstream.dbUnreachable(new ProcessingException(new SocketTimeoutException("read timed out"))));
        assertTrue(LoreUpstream.dbUnreachable(new java.util.concurrent.TimeoutException()));
    }

    @Test
    void причинаИщетсяПоВсейЦепочке() {
        // queryRows оборачивает отказ в IllegalStateException("[LORE QUERY] …").
        Throwable wrapped = new IllegalStateException("[LORE QUERY] x",
            new ProcessingException(new ConnectException("Connection refused")));
        assertTrue(LoreUpstream.dbUnreachable(wrapped));
    }

    @Test
    void шлюзИКредГлобальны() {
        assertTrue(LoreUpstream.dbUnreachable(http(502)));
        assertTrue(LoreUpstream.dbUnreachable(http(503)));
        assertTrue(LoreUpstream.dbUnreachable(http(504)));
        assertTrue(LoreUpstream.dbUnreachable(http(401)));
        assertTrue(LoreUpstream.dbUnreachable(http(403)));
    }

    @Test
    void базаОтветилаОшибкойЭтоУпалЗапрос() {
        assertFalse(LoreUpstream.dbUnreachable(http(500)));
        assertFalse(LoreUpstream.dbUnreachable(http(400)));
        assertFalse(LoreUpstream.dbUnreachable(new IllegalStateException("[LORE QUERY] Index not found", http(500))));
        assertFalse(LoreUpstream.dbUnreachable(new IllegalArgumentException("parse")));
        assertFalse(LoreUpstream.dbUnreachable(new NullPointerException()));
        assertFalse(LoreUpstream.dbUnreachable(null));
    }

    @Test
    void кодОшибкиСледуетКлассификации() {
        LoreResourceBase.LoreError down = LoreUpstream.error(new ProcessingException(new ConnectException("refused")));
        assertEquals("LORE_UPSTREAM", down.error());
        LoreResourceBase.LoreError failed = LoreUpstream.error(http(500));
        assertEquals("LORE_QUERY_FAILED", failed.error());
        assertEquals("сообщение", LoreUpstream.error(new IllegalStateException("сообщение")).detail());
    }

    @Test
    void ответВсегда502АРазличаетКод() {
        // Статус не меняется — клиенты, читающие 502, не ломаются; различает код.
        Response r = LoreUpstream.failure(http(500)).build();
        assertEquals(502, r.getStatus());
        assertEquals("LORE_QUERY_FAILED", ((LoreResourceBase.LoreError) r.getEntity()).error());
    }

    @Test
    void ниОднаТочкаНеОтдаётLoreUpstreamВслепую() throws Exception {
        // Обобщение до правила: код LORE_UPSTREAM выбирает только классификатор.
        // Литерал в ресурсе снова склеил бы «база лежит» и «запрос упал».
        java.nio.file.Path dir = java.nio.file.Path.of("src/main/java/studio/seer/heimdall/lore");
        java.util.List<String> offenders = new java.util.ArrayList<>();
        try (var files = java.nio.file.Files.list(dir)) {
            for (java.nio.file.Path f : (Iterable<java.nio.file.Path>) files::iterator) {
                if (!java.nio.file.Files.isRegularFile(f) || !f.toString().endsWith(".java")) continue;
                if (f.getFileName().toString().equals("LoreUpstream.java")) continue;
                String src = java.nio.file.Files.readString(f);
                if (src.contains("new LoreError(\"LORE_UPSTREAM\"")) offenders.add(f.getFileName().toString());
            }
        }
        assertTrue(offenders.isEmpty(), "литерал LORE_UPSTREAM мимо LoreUpstream.error: " + offenders);
    }
}
