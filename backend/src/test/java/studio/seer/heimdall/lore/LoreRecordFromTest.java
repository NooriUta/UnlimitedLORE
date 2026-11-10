package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-RECORD — общий сборщик {@link LoreRecordFrom#assemble}:
 * по описаниям «откуда» он обязан собрать ровно то же, что замороженный снимок ручных функций
 * ({@link LoreRecordSnapshotTest.Legacy}), для всех 11 типов и строк частей.
 */
class LoreRecordFromTest {

    @Test
    void everyTypeHasValueDescriptions() {
        for (String type : LoreRecordRegistry.TYPES)
            assertNotNull(LoreRecordFrom.VALUES.get(type), "у типа " + type + " нет описаний from");
    }

    @Test
    void assembleReproducesSnapshotValuesForAllElevenTypes() {
        for (String type : LoreRecordSnapshotTest.ROWS.keySet())
            for (Map<String, Object> row : LoreRecordSnapshotTest.variants(LoreRecordSnapshotTest.ROWS.get(type)))
                LoreRecordSnapshotTest.assertSnapshot(LoreRecordSnapshotTest.Legacy.values(type, row),
                    LoreRecordFrom.assemble(LoreRecordFrom.VALUES.get(type), row), type + " assemble " + row);
    }

    @Test
    void assembleReproducesSnapshotItemValues() {
        for (String child : LoreRecordSnapshotTest.ITEM_ROWS.keySet())
            for (Map<String, Object> row : LoreRecordSnapshotTest.variants(LoreRecordSnapshotTest.ITEM_ROWS.get(child)))
                LoreRecordSnapshotTest.assertSnapshot(LoreRecordSnapshotTest.Legacy.partItem(child, row).get("values"),
                    LoreRecordFrom.assemble(LoreRecordFrom.ITEMS.get(child).values(), row), child + " item " + row);
    }
}
