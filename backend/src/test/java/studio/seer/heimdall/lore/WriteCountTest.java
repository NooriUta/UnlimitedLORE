package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** MT-MCP-TRUTH Б11 · общий хелпер «задето 0 строк → 404/409 с причиной». */
class WriteCountTest {

    private static LoreCommandClient.LoreCommandResult res(Object count) {
        return new LoreCommandClient.LoreCommandResult(List.of(Map.of("count", count)));
    }

    @Test
    void readsCountFromEngineAnswer() {
        assertEquals(1, WriteCount.of(res(1)));
        assertEquals(0, WriteCount.of(res(0)));
        assertEquals(3, WriteCount.of(List.of(Map.of("count", 3L))));
    }

    @Test
    void unknownIsNotZero() {
        // «не смогли узнать» ≠ «промах»: ответ без count — не отказ
        assertEquals(WriteCount.UNKNOWN, WriteCount.of(new LoreCommandClient.LoreCommandResult(null)));
        assertEquals(WriteCount.UNKNOWN, WriteCount.of(new LoreCommandClient.LoreCommandResult(List.of())));
        assertFalse(WriteCount.missed(new LoreCommandClient.LoreCommandResult(List.of(Map.of("x", 1)))));
        assertTrue(WriteCount.missed(res(0)));
    }

    @Test
    void zeroRowsIs404WithReason() {
        var r = res(1);
        assertSame(r, WriteCount.requireHit(r, "task", "S/T1", "правка задачи"));
        WriteCount.MissedException e = assertThrows(WriteCount.MissedException.class,
            () -> WriteCount.requireHit(res(0), "task", "S/NOPE", "правка задачи"));
        Response resp = e.response();
        assertEquals(404, resp.getStatus());
        @SuppressWarnings("unchecked") Map<String, Object> body = (Map<String, Object>) resp.getEntity();
        assertEquals("NOT_FOUND", body.get("error"));
        assertEquals("S/NOPE", body.get("id"));
        assertTrue(String.valueOf(body.get("detail")).contains("ни одна строка не изменена"));
    }

    @Test
    void conflictCarriesItsCode() {
        Response resp = WriteCount.conflict("NO_OPEN_STATE", "sprint", "S", "нет открытой версии");
        assertEquals(409, resp.getStatus());
        @SuppressWarnings("unchecked") Map<String, Object> body = (Map<String, Object>) resp.getEntity();
        assertEquals("NO_OPEN_STATE", body.get("error"));
    }
}
