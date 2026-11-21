package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · ревизия 19.11.2026: инжест ранбуков из md клал тело только на запись
 * KnowRunbook — в новой схеме тело живёт в версии, и runbook_by_id отдавал пустое тело.
 * На базе из модели запись — без тела, тело — в открытую версию (как дверь runbook_new).
 */
class RunbookIngestBodyTest {

    @Test
    void на_базе_из_модели_тело_ранбука_не_пишется_на_запись() {
        ModelSchemaAdapter.enable(true);
        try {
            assertFalse(LoreIngestService.runbookVertexSql().contains("content_md"), LoreIngestService.runbookVertexSql());
        } finally { ModelSchemaAdapter.enable(false); }
        assertTrue(LoreIngestService.runbookVertexSql().contains("content_md=:content_md"), "старая схема — как раньше");
    }
}
