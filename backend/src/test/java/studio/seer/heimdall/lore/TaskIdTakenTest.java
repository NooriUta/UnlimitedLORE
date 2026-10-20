package studio.seer.heimdall.lore;

import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_SLICE_ERGONOMICS/SE-17: task_new с занятым кодом отвечал
 * 502 LORE_UPSTREAM «Conflict, status code 409 … LoreCommandClient#command» —
 * ответ о сбое СУБД, хотя сбоя нет: уникальный индекс отверг дубль. Агент
 * читает 502 как временную неисправность и повторяет тот же вызов.
 *
 * <p>По ADR-LORE-043 §3 отказ называет допустимое: 409 TASK_ID_TAKEN и
 * следующий свободный код. Здесь — чистые части: распознать конфликт и
 * подобрать код.
 */
class TaskIdTakenTest {

    @Test
    void nextFreeContinuesTheNumericSeriesOfTheSamePrefix() {
        assertEquals("DBR-17", LoreSprintTaskResource.nextFreeTaskId("DBR-11",
            List.of("DBR-01", "DBR-11", "DBR-16", "DBR-03")));
    }

    @Test
    void zeroPaddingOfTheTakenCodeIsKept() {
        assertEquals("T07", LoreSprintTaskResource.nextFreeTaskId("T03", List.of("T01", "T03", "T06")));
    }

    @Test
    void otherPrefixesDoNotCount() {
        assertEquals("SE-2", LoreSprintTaskResource.nextFreeTaskId("SE-1", List.of("SE-1", "DBU-40")));
    }

    @Test
    void codeWithoutNumberGetsASuffixThatIsReallyFree() {
        assertEquals("SELF-PROVISION-3", LoreSprintTaskResource.nextFreeTaskId("SELF-PROVISION",
            List.of("SELF-PROVISION", "SELF-PROVISION-2")));
    }

    @Test
    void conflictIsRecognisedOnlyFor409() {
        assertTrue(LoreSprintTaskResource.isConflict(new WebApplicationException(Response.status(409).build())));
        assertFalse(LoreSprintTaskResource.isConflict(new WebApplicationException(Response.status(500).build())));
        assertFalse(LoreSprintTaskResource.isConflict(new RuntimeException("Conflict")));
    }
}
