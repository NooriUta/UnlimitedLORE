package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_MINILORE_POLISH/LORE-DOOR-HISTORY-ALL-PASSPORTS — история в паспорте у всех типов с версиями.
 * Клиент (веб и телефон) рисует вкладку истории без кода под тип: модель объявляет связь с местом
 * «история», а ответ паспорта говорит, есть ли история и каким типом звать {@code /lore/history}.
 */
class LoreRecordHistoryFlagTest {

    @Test
    void typeWithVersionsAndHistoryDoorIsAvailable() {
        Map<String, Object> h = LoreRecordHistory.flag("release");
        assertEquals(true, h.get("available"));
        assertEquals("release", h.get("type"), "тип для GET /lore/history?type=");
        assertNull(h.get("reason"));
    }

    @Test
    void typeWithoutVersionsSaysSoInsteadOfAnEmptyTab() {
        Map<String, Object> h = LoreRecordHistory.flag("quality_gate");
        assertEquals(false, h.get("available"));
        assertEquals("no_versions", h.get("reason"));
        assertNull(h.get("type"));
    }

    @Test
    void typeWithVersionsButWithoutHistoryDoorIsNamedHonestly() {
        // Технология хранится в цепочке спеки, продукт — в цепочке статьи справочника: двери истории
        // под их код записи нет, и «истории нет» было бы неправдой.
        for (String t : List.of("tech", "product")) {
            Map<String, Object> h = LoreRecordHistory.flag(t);
            assertEquals(false, h.get("available"), t);
            assertEquals("no_door", h.get("reason"), t);
        }
    }

    @Test
    void everyTypeWithAvailableHistoryDeclaresTheHistoryTabInTheModel() {
        List<String> missing = new ArrayList<>();
        int available = 0;
        for (String t : LoreRecordRegistry.TYPES) {
            if (!Boolean.TRUE.equals(LoreRecordHistory.flag(t).get("available"))) continue;
            available++;
            boolean declared = LoreRecordRegistry.get(t).relations().stream().anyMatch(r -> "history".equals(r.place()));
            if (!declared) missing.add(t);
        }
        assertTrue(available >= 8, "положительный контроль: типов с историей — " + available);
        assertEquals(List.of(), missing, "у типа есть история, а вкладка истории в модели не объявлена");
    }

    @Test
    void historyTabIsNotDeclaredWhereHistoryIsNotAvailable() {
        for (String t : LoreRecordRegistry.TYPES) {
            boolean declared = LoreRecordRegistry.get(t).relations().stream().anyMatch(r -> "history".equals(r.place()));
            if (declared) assertEquals(true, LoreRecordHistory.flag(t).get("available"), t + ": вкладка истории объявлена, а истории нет");
        }
    }
}
