package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-01 (D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE): у статьи словаря product
 * есть вид — tech (технологический) или service (сервисно-организационный). Правило общее: у словаря
 * может быть свой набор допустимых видов; у словаря без набора вид не принимается — иначе опечатка
 * в dict_type молча записала бы чужое поле.
 */
class LoreDictKindTest {

    static LoreDictResource.DictEntryRequest req(String dt, String kind) {
        return new LoreDictResource.DictEntryRequest(dt, "X", null, null, null, null, null, null, null, kind);
    }

    @Test
    void productKindIsTechOrService() {
        assertNull(LoreDictResource.kindRefusal("product", "tech"));
        assertNull(LoreDictResource.kindRefusal("product", "service"));
        assertNull(LoreDictResource.kindRefusal("product", null), "вид не прислан — не трогаем");
        String bad = LoreDictResource.kindRefusal("product", "IT");
        assertNotNull(bad);
        assertTrue(bad.contains("tech") && bad.contains("service"), "отказ называет допустимые: " + bad);
    }

    @Test
    void kindIsRefusedForDictionaryWithoutKinds() {
        String r = LoreDictResource.kindRefusal("priority", "tech");
        assertNotNull(r, "у priority видов нет");
        assertTrue(r.contains("priority"), r);
    }

    @Test
    void sameKindIsUnchangedAndDifferentKindIsAnUpdate() {
        assertTrue(LoreDictResource.sameAsStored(req("product", "tech"), Map.of("kind", "tech")));
        assertFalse(LoreDictResource.sameAsStored(req("product", "service"), Map.of("kind", "tech")),
            "смена вида — правка, а не «ничего не изменилось»");
    }

    /** WK-01, админка: экран «Словари» читает срез dictionary — без kind вид продукта не показать. */
    @Test
    void dictionarySliceReturnsKind() {
        String sql = LoreSlices.compose("dictionary", Map.of()).sql();
        assertTrue(sql.contains(", kind"), sql);
    }
}
