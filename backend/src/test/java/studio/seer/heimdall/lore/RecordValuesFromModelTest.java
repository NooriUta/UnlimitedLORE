package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * KREG-13. Владелец 26.11.2026: «src\main\java\studio\seer\heimdall\lore\LoreRecordFrom.java — это же не похоже
 * на json по модели». Правило: тип без ручной записи в LoreRecordFrom.VALUES собирается из lore-model.json —
 * поля и тело типа, колонка по aliases. Типы выпуска 1.19.1 (skill, tag, kind, agent_session) описаны только в модели.
 */
class RecordValuesFromModelTest {

    private static final List<String> MODEL_ONLY = List.of("skill", "tag", "kind", "agent_session");

    @Test
    void новыеТипыОписаныТолькоВМодели_безРучнойЗаписиВJava() {
        for (String t : MODEL_ONLY) {
            assertFalse(LoreRecordFrom.VALUES.containsKey(t), t + ": ручная запись в Java — должен собираться из модели");
            assertNotNull(LoreRecordFrom.fromModel(t), t + ": тип не описан в модели");
        }
    }

    @Test
    void скиллСобираетсяПоПолямИПсевдонимамМодели() {
        Map<String, Object> row = new HashMap<>();
        row.put("skill_id", "skill:release-cutover");
        row.put("title", "Срез релиза");
        row.put("status", "active");
        row.put("version", "3");
        row.put("source", "seed");
        row.put("body_md", "# Шаги");
        Map<String, Object> v = LoreRecordValues.values("skill", row);
        assertEquals("Срез релиза", v.get("title"));
        assertEquals("skill:release-cutover", v.get("code"), "code ← aliases.skill.code = skill_id");
        assertEquals("active", v.get("status"));
        assertEquals("3", v.get("version"));
        assertEquals("# Шаги", v.get("body_md"));
    }

    @Test
    void сессияБезНазванияПоказываетсяКодом() {
        Map<String, Object> row = new HashMap<>();
        row.put("session_id", "c12e671c");
        row.put("machine_id", "arharaga");
        row.put("dialogue_name", null);
        Map<String, Object> v = LoreRecordValues.values("agent_session", row);
        assertEquals("c12e671c", v.get("title"), "title ← dialogue_name, пусто — код сессии");
        assertEquals("c12e671c", v.get("code"));
        assertEquals("arharaga", v.get("machine"), "machine ← aliases.agent_session.machine = machine_id");
    }

    @Test
    void неизвестныйТипНеВыдаётсяЗаСпеку() {
        Map<String, Object> row = new HashMap<>();
        row.put("spec_id", "SPEC-X");
        row.put("title", "чужое");
        assertNull(LoreRecordFrom.fromModel("no_such_type"));
        assertFalse(LoreRecordValues.values("no_such_type", row).containsKey("code"),
            "раньше неизвестный тип собирался как спека и показывал spec_id кодом");
    }
}
