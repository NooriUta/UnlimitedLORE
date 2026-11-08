package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CI-STATUS-NULL: Forgejo для SHA без статусов отдаёт
 * {@code "statuses": null}, а не пустой массив. Vert.x {@code getJsonArray(key, def)}
 * возвращает def только при ОТСУТСТВИИ ключа — при ключе со значением null это null,
 * и {@code .size()} падал NPE. forgejo_ci_status отвечал «сбой обращения к Forgejo»
 * (UNKNOWN), хотя честный ответ — «ранов ещё нет» (NO_RUN, после grace — STALLED).
 * Чистая функция, без сети.
 */
class ForgejoCiStatusesNullTest {

    private static final Set<String> REQUIRED = Set.of("Backend CI", "Frontend + MCP CI");

    @Test
    void nullStatusesMeansNoChecksNotFailure() {
        Map<String, String> byCtx = ForgejoBridge.statusesByContext(
            new JsonObject("{\"state\":\"\",\"sha\":\"abc\",\"total_count\":0,\"statuses\":null}"));
        assertTrue(byCtx.isEmpty());
        assertEquals(ForgejoBridge.NO_RUN, ForgejoBridge.gateStatus(byCtx, REQUIRED, 10, 300, false));
    }

    @Test
    void nullStatusesPastGraceIsStalled() {
        Map<String, String> byCtx = ForgejoBridge.statusesByContext(
            new JsonObject("{\"statuses\":null}"));
        assertEquals(ForgejoBridge.STALLED, ForgejoBridge.gateStatus(byCtx, REQUIRED, 900, 300, false));
    }

    @Test
    void missingStatusesKeyIsAlsoEmpty() {
        assertTrue(ForgejoBridge.statusesByContext(new JsonObject("{\"state\":\"\"}")).isEmpty());
    }

    // Положительный контроль: непустой ответ по-прежнему разбирается, и первый
    // статус на контекст (Forgejo кладёт новее→старше) — актуальный.
    @Test
    void realStatusesStillParsedNewestFirstPerContext() {
        Map<String, String> byCtx = ForgejoBridge.statusesByContext(new JsonObject(
            "{\"statuses\":["
                + "{\"context\":\"Backend CI\",\"status\":\"success\"},"
                + "{\"context\":\"Frontend + MCP CI\",\"status\":\"pending\"},"
                + "{\"context\":\"Backend CI\",\"status\":\"failure\"}"
                + "]}"));
        assertEquals(Map.of("Backend CI", "success", "Frontend + MCP CI", "pending"), byCtx);
        assertEquals(ForgejoBridge.PENDING, ForgejoBridge.gateStatus(byCtx, REQUIRED, 10, 300, false));
    }
}
