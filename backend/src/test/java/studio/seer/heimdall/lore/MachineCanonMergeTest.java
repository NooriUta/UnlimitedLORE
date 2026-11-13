package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_POLISH_UAT_1113/PU-18 шаг 2 (слово владелицы 13.11: «да, слить») — V82
 * сливает вершины KnowMachine, различающиеся только регистром, в каноническую
 * ({@link AgentMachine#canon}). Прод 13.11: LorCetus, LORCETUS → lorcetus.
 * Проверяется план (чистая функция); исполнение — шаг миграции, идемпотентный:
 * повтор на слитой базе — пустой план.
 */
class MachineCanonMergeTest {

    @Test
    void prodCase_twoVariants_mergeIntoLowercase() {
        Map<String, List<String>> plan = AgentMachine.caseMergePlan(List.of("LorCetus", "LORCETUS", "arharaga"));
        assertEquals(Map.of("lorcetus", List.of("LORCETUS", "LorCetus")), plan);
    }

    @Test
    void canonicalAlreadyPresent_onlyVariantsMove() {
        assertEquals(Map.of("lorcetus", List.of("LORCETUS")),
            AgentMachine.caseMergePlan(List.of("lorcetus", "LORCETUS")));
    }

    @Test
    void singleNonCanonical_isRenamedToo() {
        // одна вершина «PC-1» — тоже не канон: после выкатки агенты пишут «pc-1», и без
        // переименования появился бы второй объект той же машины
        assertEquals(Map.of("pc-1", List.of("PC-1")), AgentMachine.caseMergePlan(List.of("PC-1")));
    }

    @Test
    void alreadyCanonical_emptyPlan_idempotent() {
        assertTrue(AgentMachine.caseMergePlan(List.of("lorcetus", "arharaga")).isEmpty());
        assertTrue(AgentMachine.caseMergePlan(List.of()).isEmpty());
    }

    @Test
    void nullAndBlank_ignored() {
        java.util.List<String> ids = new java.util.ArrayList<>();
        ids.add(null); ids.add("  "); ids.add("lorcetus");
        assertTrue(AgentMachine.caseMergePlan(ids).isEmpty());
    }

    @Test
    void registeredAsStep82_java() {
        LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.stream().filter(x -> x.version() == 82).findFirst().orElseThrow();
        assertTrue(s.name().startsWith("java__"), s.name());
    }
}
