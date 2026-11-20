package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S14_KIT5/K5-MODEL-NAV-EDGE-LABELS — обратная подпись связи в модели (решение владелицы
 * 20.11.2026, вариант «а»): у связи {@code types[].relations[]} есть {@code inverse_label} — подпись,
 * которой связь называется с ДРУГОГО конца («Зависит от» ↔ «Блокирует»). Без неё вкладка входящих
 * подписана тем же словом, что исходящих (методика SPEC-LORE-MODEL-PASSPORT-METHOD §7.3.2).
 *
 * <p>Ключ ответа есть у каждой связи всегда; {@code null} — обратной подписи в модели нет, и клиент
 * говорит это словами, а не показывает то же слово.
 */
class LoreModelInverseLabelTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> rel(String type, String key) {
        List<Map<String, Object>> rels = (List<Map<String, Object>>) LoreRecordRegistry.schemaJson(type).get("relations");
        return rels.stream().filter(r -> key.equals(r.get("key"))).findFirst()
            .orElseThrow(() -> new AssertionError("у типа " + type + " нет связи " + key));
    }

    @Test
    void inverseLabelOfCoreEdges() {
        // MDL-13 (владелица 20.11.2026: «выровнять»): у всех типов «Зависит от» / «От неё зависят».
        assertEquals("От неё зависят", rel("sprint", "dependsOn").get("inverse_label"));
        assertEquals("От неё зависят", rel("task", "dependsOn").get("inverse_label"));
        assertEquals("Зависит от", rel("milestone", "blocks").get("inverse_label"));
        assertEquals("Зависит от", rel("sprint", "blocks").get("inverse_label"));
        assertEquals("Спринт", rel("sprint", "tasks").get("inverse_label"));
        assertEquals("Задачи", rel("task", "sprint").get("inverse_label"));
        assertEquals("Спринты", rel("sprint", "adrs").get("inverse_label"));
        assertEquals("Реализует ADR", rel("adr", "sprints").get("inverse_label"));
        assertEquals("Блокирует задачи", rel("task", "gates").get("inverse_label"));
        assertEquals("Блокирующие вопросы", rel("question", "gates").get("inverse_label"));
        assertNotNull(rel("task", "prs").get("inverse_label"), "CLOSED_BY: у PR своей стороны в модели нет — обратная подпись задана явно");
    }

    @SuppressWarnings("unchecked")
    @Test
    void keyPresentOnEveryRelation() {
        int checked = 0;
        for (String type : List.of("sprint", "task", "adr", "spec", "doc")) {
            for (Map<String, Object> r : (List<Map<String, Object>>) LoreRecordRegistry.schemaJson(type).get("relations")) {
                assertTrue(r.containsKey("inverse_label"), type + "." + r.get("key") + ": ключа inverse_label нет");
                checked++;
            }
        }
        // Положительный контроль: проверено не ноль связей.
        assertTrue(checked > 10, "проверено связей: " + checked);
    }
}
