package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/AN-06 · ADR-LORE-030 §2 срез I «реинжиниринг-нагрузка».
 * decision:D-2026-LORE-REENG-SHIPPED-IN-REWORK: новая uc-задача к выпущенному
 * сценарию переводит его в in_rework, shipped_at сохраняется.
 *
 * <p>Срез отдаёт сырые факты (принцип invest_profile): строка на uc-задачу
 * сценария с shipped_at — даты её состояний и открытый статус. Эпизод
 * переделки и его длительность считает потребитель: задача, заведённая ПОСЛЕ
 * shipped_at, — это возврат к выпущенному. Схема не меняется: история уже есть.
 */
class ReengLoadSliceTest {

    @Test
    void sliceIsRegisteredWithoutParams() {
        LoreSlices.SliceDef def = LoreSlices.get("reeng_load");
        assertNotNull(def, "срез reeng_load зарегистрирован");
        assertEquals(List.of(), def.required());
    }

    @Test
    void returnsRawFactsForEpisodes() {
        String sql = LoreSlices.compose("reeng_load", Map.of()).sql();
        for (String col : List.of("task_uid", "uc_id", "uc_title", "uc_status", "shipped_at",
                                  "state_dates", "status_raw", "status_since"))
            assertTrue(sql.contains(col), "колонка " + col + ": " + sql);
        assertTrue(sql.contains("[shipped_at IS NOT NULL]"),
            "только сценарии, которые хоть раз выпускались: " + sql);
    }

    @Test
    void scopedByTheTaskSprintProject() {
        assertEquals("out('PART_OF').out('BELONGS_TO_PROJECT').slug",
            LoreSlices.PROJECT_SCOPED.get("reeng_load"),
            "задача видна через проект своего спринта — как остальные срезы задач");
        String scoped = LoreSlices.compose("reeng_load", Map.of(), Set.of("NooriUta/UnlimitedLORE")).sql();
        assertTrue(scoped.contains("BELONGS_TO_PROJECT"), scoped);
    }
}
