package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S3_V2_INFRA/S3-11: Forgejo пишет отменённый прогон (concurrency,
 * «вытеснен более новым») как commit-status {@code failure} с описанием
 * {@code "Has been cancelled"}. Гейт §10 видел в нём красный — промо-PR #954
 * стоял RED, хотя ни одна проверка не упала (e091f83f, 09.11.2026).
 *
 * Правило:
 * <ul>
 *   <li>отменённый прогон — не красный: в карте контекстов он {@code cancelled};</li>
 *   <li>отменённый джоб, у которого на ТОМ ЖЕ sha есть зелёный двойник другого
 *       события ({@code (push)} ↔ {@code (pull_request)}), гейт не держит;</li>
 *   <li>отменённый без зелёного двойника — не GREEN и не RED: прогона на этом sha
 *       больше не будет, это STALLED (перезапустить или ждать новой головы);</li>
 *   <li>настоящий failure остаётся красным.</li>
 * </ul>
 */
class ForgejoGateCancelledTest {

    private static final Set<String> ALL = Set.of(); // прод: required_checks пуст → все обнаруженные

    private static Map<String, String> parse(String statusesJson) {
        return ForgejoBridge.statusesByContext(new JsonObject("{\"statuses\":" + statusesJson + "}"));
    }

    @Test
    void cancelledStatusIsParsedAsCancelledNotFailure() {
        Map<String, String> byCtx = parse("["
            + "{\"context\":\"Backend CI / build (push)\",\"status\":\"failure\",\"description\":\"Has been cancelled\"},"
            + "{\"context\":\"Backend CI / build (pull_request)\",\"status\":\"failure\",\"description\":\"Failing after 3m2s\"}"
            + "]");
        assertEquals("cancelled", byCtx.get("Backend CI / build (push)"));
        assertEquals("failure", byCtx.get("Backend CI / build (pull_request)"));
    }

    @Test
    void cancelledPushWithGreenPullRequestTwinIsGreen() {
        // Ровно симптом задачи: push-прогон отменён, PR-проверки того же sha зелёные.
        Map<String, String> byCtx = parse("["
            + "{\"context\":\"Frontend + MCP CI / build (push)\",\"status\":\"success\",\"description\":\"Successful in 1m9s\"},"
            + "{\"context\":\"Frontend + MCP CI / build (pull_request)\",\"status\":\"success\",\"description\":\"Successful in 1m26s\"},"
            + "{\"context\":\"Backend CI / build (pull_request)\",\"status\":\"success\",\"description\":\"Successful in 9m\"},"
            + "{\"context\":\"Backend CI / build (push)\",\"status\":\"failure\",\"description\":\"Has been cancelled\"}"
            + "]");
        String s = ForgejoBridge.gateStatus(byCtx, ALL, 60, 300, false);
        assertEquals(ForgejoBridge.GREEN, s);
        assertTrue(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void bothTwinsCancelledIsStalledNotRed() {
        // Промо #954, e091f83f: оба прогона Backend CI отменены, упавших нет.
        Map<String, String> byCtx = parse("["
            + "{\"context\":\"Frontend + MCP CI / build (push)\",\"status\":\"success\",\"description\":\"Successful in 1m9s\"},"
            + "{\"context\":\"Frontend + MCP CI / build (pull_request)\",\"status\":\"success\",\"description\":\"Successful in 1m26s\"},"
            + "{\"context\":\"Backend CI / build (pull_request)\",\"status\":\"failure\",\"description\":\"Has been cancelled\"},"
            + "{\"context\":\"Backend CI / build (push)\",\"status\":\"failure\",\"description\":\"Has been cancelled\"}"
            + "]");
        String s = ForgejoBridge.gateStatus(byCtx, ALL, 60, 300, false);
        assertEquals(ForgejoBridge.STALLED, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void cancelledWithPendingTwinIsPending() {
        String s = ForgejoBridge.gateStatus(Map.of(
                "Backend CI / build (push)", "cancelled",
                "Backend CI / build (pull_request)", "pending"),
            ALL, 60, 300, false);
        assertEquals(ForgejoBridge.PENDING, s);
    }

    @Test
    void realFailureStaysRedEvenNextToCancelled() {
        // Положительный контроль: настоящий failure — красный, отмена его не прячет.
        String s = ForgejoBridge.gateStatus(Map.of(
                "Backend CI / build (push)", "cancelled",
                "Backend CI / build (pull_request)", "failure"),
            ALL, 60, 300, false);
        assertEquals(ForgejoBridge.RED, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void cancelledTwinOfAnotherJobDoesNotCount() {
        // Зелёный двойник должен быть того же джоба: зелёный web-next не оправдывает отменённый build.
        String s = ForgejoBridge.gateStatus(Map.of(
                "Frontend + MCP CI / build (push)", "cancelled",
                "Frontend + MCP CI / web-next (pull_request)", "success"),
            ALL, 60, 300, false);
        assertEquals(ForgejoBridge.STALLED, s);
    }

    @Test
    void failureWithOtherDescriptionIsStillFailure() {
        Map<String, String> byCtx = parse("["
            + "{\"context\":\"Backend CI / build (push)\",\"status\":\"failure\",\"description\":\"Failing after 2m\"},"
            + "{\"context\":\"Backend CI / build (pull_request)\",\"status\":\"success\",\"description\":\"Successful in 9m\"}"
            + "]");
        assertEquals(ForgejoBridge.RED, ForgejoBridge.gateStatus(byCtx, ALL, 60, 300, false));
    }
}
