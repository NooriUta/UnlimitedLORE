package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-NOTE-APPEND (приёмка препрода 14.11.2026): правка заметки задачи открыла
 * версию, но сравнение версий показывало одну строку — content_hash, текста заметки не было ни старого,
 * ни нового. Корень: выборка истории брала тело версии только у дока (S7B-06).
 *
 * Правило: история каждого типа несёт поля тела своей версии — дифф показывает, ЧТО изменилось.
 */
class HistoryBodyFieldsTest {

    @Test
    void historySelectsBodyFieldsOfEveryType() {
        Map<String, List<String>> want = Map.of(
            "task", List.of("note_md"),
            "sprint", List.of("context_md", "outcome_md"),
            "adr", List.of("context_md", "decision_md", "consequences_md"),
            "spec", List.of("content_md"),
            "doc", List.of("content_md"));
        for (Map.Entry<String, List<String>> e : want.entrySet()) {
            if (!LoreEntityHistory.types().contains(e.getKey())) continue;
            String sql = LoreEntityHistory.sql(e.getKey());
            for (String f : e.getValue()) assertTrue(sql.contains(f), e.getKey() + ": нет поля тела " + f + " в " + sql);
        }
        assertTrue(LoreEntityHistory.types().contains("task"), "положительный контроль: история задачи ведётся");
    }
}
