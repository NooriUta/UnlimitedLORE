package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * FJ-07: чистая функция гейта ADR-LORE-024 §10 — без Forgejo, без сети.
 * Инвариант (б): merge разрешён ТОЛЬКО из GREEN — здесь проверяется каждый
 * не-GREEN статус по отдельности, чтобы регрессия любого из них ловилась
 * именованным тестом, а не «каким-то» упавшим кейсом.
 */
class ForgejoGateStatusTest {

    private static final Set<String> REQUIRED = Set.of("Backend CI", "Frontend + MCP CI");

    @Test
    void greenWhenAllRequiredSuccess() {
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "success", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.GREEN, s);
        assertTrue(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void redWhenAnyRequiredFails() {
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "failure", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.RED, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void errorStateCountsAsRed() {
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "error", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.RED, s);
    }

    @Test
    void pendingWhenAnyRequiredStillRunning() {
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "pending", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.PENDING, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void pendingWhenRequiredContextNotYetRegistered() {
        // §10 (а): один required-ран уже отчитался, второго ещё нет — это PENDING,
        // не GREEN: «неизвестный чек не пропускается молча».
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.PENDING, s);
    }

    @Test
    void redBeatsPending() {
        // Красный сильнее pending: чинить уже есть что, ждать второй ран незачем.
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "failure", "Frontend + MCP CI", "pending"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.RED, s);
    }

    @Test
    void noRunInsideGraceWindow() {
        String s = ForgejoBridge.gateStatus(Map.of(), REQUIRED, 120, 300, false);
        assertEquals(ForgejoBridge.NO_RUN, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void stalledAfterGraceWindow() {
        // §10: «рана ещё нет» ≠ «рана не будет» — но после grace-окна это STALLED.
        String s = ForgejoBridge.gateStatus(Map.of(), REQUIRED, 301, 300, false);
        assertEquals(ForgejoBridge.STALLED, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void unknownWhenUpstreamFailed() {
        // 503/сеть/нет прав → UNKNOWN, а НЕ красный и НЕ зелёный (§10, отдельный статус).
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "success", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, true);
        assertEquals(ForgejoBridge.UNKNOWN, s);
        assertFalse(ForgejoBridge.mergeAllowed(s));
    }

    @Test
    void emptyRequiredMeansAllDiscoveredMustBeGreen() {
        // Консервативный дефолт (решение 135): required не сконфигурированы →
        // гейт требует зелёными ВСЕ обнаруженные контексты.
        assertEquals(ForgejoBridge.GREEN, ForgejoBridge.gateStatus(
            Map.of("anything", "success", "else", "success"), Set.of(), 60, 300, false));
        assertEquals(ForgejoBridge.RED, ForgejoBridge.gateStatus(
            Map.of("anything", "success", "else", "failure"), Set.of(), 60, 300, false));
    }

    @Test
    void warningStateIsNotGreen() {
        // warning — не success: гейт консервативен, «почти зелёный» не мержится.
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "warning", "Frontend + MCP CI", "success"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.PENDING, s);
    }

    @Test
    void nonRequiredFailureDoesNotBlockMerge() {
        // Явно сконфигурированные required: посторонний красный контекст (например,
        // экспериментальный workflow) merge не блокирует.
        String s = ForgejoBridge.gateStatus(
            Map.of("Backend CI", "success", "Frontend + MCP CI", "success", "nightly-experiment", "failure"),
            REQUIRED, 60, 300, false);
        assertEquals(ForgejoBridge.GREEN, s);
    }
}
