package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_EXT_ISSUES_W2/ISS-02-DICT-SEED-GUARD · доводка v3: task_type, priority, agent_profile — только недостающее.
 */
class UiDictSeedTest {

    private static List<String> codes(List<StatusDictCoreSeed.Insert> plan, String dict) {
        return plan.stream().filter(i -> i.dictType().equals(dict)).map(StatusDictCoreSeed.Insert::code).toList();
    }

    @Test
    void пустая_база_получает_все_три_словаря() {
        List<StatusDictCoreSeed.Insert> plan = UiDictSeed.plan(Map.of());
        assertEquals(List.of("planning", "design", "dev", "test", "ops", "research", "analytics", "docs", "content"), codes(plan, "task_type"),
            "ADR-LORE-015");
        assertEquals(List.of("critical", "high", "normal", "low"), codes(plan, "priority"), "шкала модели и установщика");
        assertEquals(List.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer", "product-analyst"),
            codes(plan, "agent_profile"), "профили модели (mcp-server/agent-profiles)");
    }

    @Test
    void прод_с_P_кодами_приоритета_второй_шкалы_не_получает() {
        List<StatusDictCoreSeed.Insert> plan = UiDictSeed.plan(Map.of("priority", Set.of("P0", "P1", "P2", "P3")));
        assertEquals(List.of(), codes(plan, "priority"), "P0–P3 — синонимы critical/high/normal/low");
    }

    @Test
    void только_недостающее_без_учёта_регистра() {
        List<StatusDictCoreSeed.Insert> plan = UiDictSeed.plan(Map.of(
            "task_type", Set.of("DEV", "docs"),
            "agent_profile", Set.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer")));
        assertEquals(7, codes(plan, "task_type").size());
        assertTrue(!codes(plan, "task_type").contains("dev") && !codes(plan, "task_type").contains("docs"));
        assertEquals(List.of("product-analyst"), codes(plan, "agent_profile"), "на проде нет только product-analyst");
    }

    @Test
    void у_каждой_статьи_подписи_и_цвет_профили_расширяемые() {
        UiDictSeed.SEEDS.forEach((dict, entries) -> entries.forEach(e -> {
            assertTrue(e.labelRu() != null && !e.labelRu().isBlank(), dict + "." + e.code() + ": label_ru");
            assertTrue(e.labelEn() != null && !e.labelEn().isBlank(), dict + "." + e.code() + ": label_en");
            assertTrue(e.color() != null && !e.color().isBlank(), dict + "." + e.code() + ": color");
        }));
        for (StatusDictCoreSeed.Insert i : UiDictSeed.plan(Map.of()))
            assertEquals("agent_profile".equals(i.dictType()), UiDictSeed.params(i).get("is_extensible"), i.dictType());
    }
}
