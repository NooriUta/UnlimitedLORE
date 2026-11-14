package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-CAL-CLASS-REQUIRED — решение владелицы 14.11.2026 (D5 «подсказка»):
 * task_new без work_class создаёт задачу (отказа нет), но ответ несёт отдельное явное поле
 * {@code warning} с допустимыми значениями uc / jtd / enb — заметнее, чем строка в quality.missing.
 */
class TaskWorkClassWarningTest {

    @Test
    void missingClassGivesExplicitWarningWithAllowedValues() {
        for (String wc : new String[]{null, "", "  "}) {
            Map<String, Object> w = LoreSprintTaskResource.workClassWarning(wc);
            assertNotNull(w, "класс не задан — подсказка обязательна: [" + wc + "]");
            assertEquals("WORK_CLASS_MISSING", w.get("code"));
            assertEquals("work_class", w.get("field"));
            assertEquals(List.of("uc", "jtd", "enb"), w.get("allowed"));
            String detail = String.valueOf(w.get("detail"));
            assertTrue(detail.contains("uc") && detail.contains("jtd") && detail.contains("enb"), detail);
            assertTrue(detail.contains("task_set"), "подсказка называет, чем дописать класс: " + detail);
        }
    }

    @Test
    void givenClassGivesNoWarning() {
        for (String wc : List.of("uc", "jtd", "enb"))
            assertNull(LoreSprintTaskResource.workClassWarning(wc), wc);
    }
}
