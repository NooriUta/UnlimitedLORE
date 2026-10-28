package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** DBR-17: «прислали то же самое» для справочника — без базы. */
class LoreDictSameAsStoredTest {

    private static LoreDictResource.DictEntryRequest req(String label, Integer sort, Boolean active) {
        return new LoreDictResource.DictEntryRequest("area", "x", label, null, null, null, sort, active, null);
    }

    private static Map<String, Object> stored(String label, Object sort, Object active) {
        Map<String, Object> m = new HashMap<>();
        m.put("label_ru", label);
        m.put("sort_order", sort);
        m.put("is_active", active);
        return m;
    }

    @Test
    void sameValuesAreUnchanged() {
        assertTrue(LoreDictResource.sameAsStored(req("Ядро", 3, true), stored("Ядро", 3, true)));
    }

    @Test
    void numbersCompareByValueAcrossIntegerAndLong() {
        assertTrue(LoreDictResource.sameAsStored(req("Ядро", 3, null), stored("Ядро", 3L, true)));
    }

    @Test
    void omittedFieldsAreNotCompared() {
        assertTrue(LoreDictResource.sameAsStored(req(null, null, null), stored("Ядро", 3, false)));
    }

    @Test
    void anyDifferentSentFieldIsAChange() {
        assertFalse(LoreDictResource.sameAsStored(req("Ядро 2", 3, true), stored("Ядро", 3, true)));
        assertFalse(LoreDictResource.sameAsStored(req("Ядро", 4, true), stored("Ядро", 3, true)));
        assertFalse(LoreDictResource.sameAsStored(req("Ядро", 3, false), stored("Ядро", 3, true)));
    }

    @Test
    void fieldAbsentInStoreIsAChange() {
        assertFalse(LoreDictResource.sameAsStored(req("Ядро", null, null), stored(null, null, null)));
    }
}
