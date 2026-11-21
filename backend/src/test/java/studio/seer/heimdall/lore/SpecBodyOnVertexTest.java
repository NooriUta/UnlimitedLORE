package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · ревизия 19.11.2026: spec_set писал content_md и на запись KnowSpec. В новой
 * схеме тело спеки живёт только в версии — на записи это «бродячее» поле (при строгом типе — отказ всей записи).
 * Старая схема читает COALESCE(версия, запись) — там запись тела на вершину остаётся.
 */
class SpecBodyOnVertexTest {

    @Test
    void на_базе_из_модели_тело_спеки_только_в_версии() {
        ModelSchemaAdapter.enable(true);
        try {
            assertFalse(LoreSpecResource.bodyOnVertex());
        } finally { ModelSchemaAdapter.enable(false); }
        assertTrue(LoreSpecResource.bodyOnVertex(), "старая схема — как раньше");
    }
}
