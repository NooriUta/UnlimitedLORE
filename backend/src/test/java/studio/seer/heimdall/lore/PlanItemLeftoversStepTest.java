package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_PLANITEM_RETIRE/T-14, хвост V54 (решение владельца 05.11.2026: «удаляй
 * из спек из базы и закрывай задачу, это уже архивная история»).
 *
 * <p>V54 сняла четыре типа пласта PlanItem из ответа №15. На проде 05.11 остались
 * два пустых: вершина StatusPlanItem и ребро REPRESENTS (0 строк, код их не
 * создаёт и не читает). V57 снимает их тем же механизмом «только при нуле».
 */
class PlanItemLeftoversStepTest {

    @Test
    void v57IsRegisteredAsAdditiveJavaStep() {
        LoreSchemaMigrations.Step v57 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 57).findFirst().orElseThrow();
        assertEquals("java__drop_planitem_leftovers_if_unused", v57.name());
        assertEquals(List.of(), v57.sql(), "SQL пуст — работа в раннере, только при нулевом счёте");
        assertEquals(17, v57.compatMajor(), "шаг аддитивный — major не растёт");
    }

    @Test
    void leftoversAreExactlyTheTwoMeasuredTypes() {
        // Рёбра раньше вершин. Ровно два — расширять список молча нельзя:
        // каждый снимаемый тип — отдельное решение владельца.
        assertEquals(List.of("REPRESENTS", "StatusPlanItem"), LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES);
    }

    @Test
    void leftoversDoNotOverlapWithV54() {
        for (String t : LoreSchemaMigrations.PLANITEM_LEFTOVER_TYPES)
            assertFalse(LoreSchemaMigrations.PLANITEM_TYPES.contains(t), t + " уже снимает V54");
    }
}
