package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * D-2026-MIG-PLAN-BOARD-INSTALLER-OPTION · установщик по умолчанию не переносит старую доску плана (Plan*).
 * Срезы доски на такой базе отвечали 502 «Type with name 'PlanConfig' was not found» — теперь явное «раздел снят».
 * Доску оставили при установке (MIG_PLAN_BOARD=keep) или база старой схемы — срезы работают как раньше.
 */
class PlanBoardRemovedSliceTest {

    @Test
    void срезы_доски_узнаются_по_типам_plan() {
        for (String id : new String[]{"plan_config", "plan_tracks", "track_options", "plan_sections", "plan_checkpoints", "plan_versions"})
            assertTrue(LoreSlices.usesPlanBoard(id), id);
        assertFalse(LoreSlices.usesPlanBoard("sprints"));
        assertFalse(LoreSlices.usesPlanBoard("нет_такого"));
    }

    @Test
    void раздел_снят_только_на_базе_из_модели_без_доски() {
        assertFalse(ModelSchemaAdapter.planSectionRemoved("plan_config"), "старая схема");
        ModelSchemaAdapter.enable(true);
        try {
            ModelSchemaAdapter.planBoard(true);
            assertFalse(ModelSchemaAdapter.planSectionRemoved("plan_config"), "доску оставили");
            ModelSchemaAdapter.planBoard(false);
            assertTrue(ModelSchemaAdapter.planSectionRemoved("plan_config"));
            assertFalse(ModelSchemaAdapter.planSectionRemoved("sprints"));
        } finally { ModelSchemaAdapter.enable(false); ModelSchemaAdapter.planBoard(true); }
    }
}
