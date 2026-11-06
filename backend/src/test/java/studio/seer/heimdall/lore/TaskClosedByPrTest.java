package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Q-MINILORE-TASK-PR-EDGE → решение D-2026-MINILORE-OWNER-ANSWERS-06-11, п.3
 * (владелица «ок», 06.11.2026): связь задачи с PR — РЕБРОМ KnowTask → KnowPR
 * (CLOSED_BY) в task_link, а не текстовыми ссылками. Тогда релиз находит свои
 * задачи через PR → SHIPPED_IN, а не разбором note_md.
 */
class TaskClosedByPrTest {

    @Test
    void schemaStepCreatesTheEdgeType() {
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("task_closed_by")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы task_closed_by не зарегистрирован"));
        assertEquals(61, step.version());
        assertEquals(17, step.compatMajor());
        assertEquals(List.of("CREATE EDGE TYPE CLOSED_BY IF NOT EXISTS EXTENDS E"), step.sql());
    }

    @Test
    void prReferenceIsParsedInTheFormsAgentsWrite() {
        assertEquals(new LoreSprintTaskResource.PrRef("NooriUta/UnlimitedLORE", 801),
            LoreSprintTaskResource.parsePrRef("NooriUta/UnlimitedLORE#801", null));
        assertEquals(new LoreSprintTaskResource.PrRef("NooriUta/UnlimitedLORE", 801),
            LoreSprintTaskResource.parsePrRef("#801", "NooriUta/UnlimitedLORE"));
        assertEquals(new LoreSprintTaskResource.PrRef("AIDA/volva", 38),
            LoreSprintTaskResource.parsePrRef("38", "AIDA/volva"));
    }

    @Test
    void bareNumberWithoutProjectIsRefusedNotGuessed() {
        // Номер PR без проекта неоднозначен: #38 есть и в LORE, и в Völva.
        assertNull(LoreSprintTaskResource.parsePrRef("#38", null));
        assertNull(LoreSprintTaskResource.parsePrRef("not-a-pr", "AIDA/volva"));
        assertNull(LoreSprintTaskResource.parsePrRef("NooriUta/UnlimitedLORE#0", null));
    }

    @Test
    void releaseFindsItsTasksThroughPrs() {
        String sql = LoreSlices.compose("release_tasks_by_tag", Map.of("tag", "v1.16.0")).sql();
        assertTrue(sql.contains("out('CLOSED_BY').out('SHIPPED_IN').release_id CONTAINS :tag"), sql);
        assertEquals("out('PART_OF').out('BELONGS_TO_PROJECT').slug",
            LoreSlices.PROJECT_SCOPED.get("release_tasks_by_tag"), "задача видна через проект своего спринта");
    }

    @Test
    void taskCarriesItsPrs() {
        String sql = LoreSlices.compose("tasks_by_uids", Map.of("task_uids", "S/T")).sql();
        assertTrue(sql.contains("out('CLOSED_BY').pr_uid AS closed_by_prs"), sql);
    }
}
