package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_WORK_ANY_KIND/WK-01 (D-2026-LORE-PRODUCT-KINDS-TECH-SERVICE): у статьи словаря product
 * есть вид — tech (технологический) или service (сервисно-организационный). Правило общее: у словаря
 * может быть свой набор допустимых видов; у словаря без набора вид не принимается — иначе опечатка
 * в dict_type молча записала бы чужое поле.
 */
class LoreDictKindTest {

    static LoreDictResource.DictEntryRequest req(String dt, Object kind) {
        return req(dt, kind, null);
    }

    static LoreDictResource.DictEntryRequest req(String dt, Object kind, String reason) {
        return new LoreDictResource.DictEntryRequest(dt, "X", null, null, null, null, null, null, null, kind, reason, null);
    }

    // ── WK-01, правка вида (слово владелицы 20.11.2026): вид продукта — НАБОР (ADR-LORE-044,
    // решение 19.11: tech, service или оба). Пустой набор — отказ; правка вида — новая версия с причиной.

    @Test
    void productKindIsASetInCanonicalOrder() {
        assertEquals(List.of("tech", "service"), LoreDictResource.normalizeKind("product", List.of("service", "tech", "tech")),
            "повтор — один раз, порядок как в наборе словаря");
        assertEquals(List.of("service"), LoreDictResource.normalizeKind("product", List.of("service")));
        assertEquals(List.of("tech"), LoreDictResource.normalizeKind("product", "tech"), "строка — набор из одного (прежний клиент)");
        assertNull(LoreDictResource.normalizeKind("product", null), "не прислан — не трогаем");
    }

    @Test
    void emptyOrForeignProductKindIsRefused() {
        String empty = LoreDictResource.kindRefusal("product", List.of());
        assertNotNull(empty, "пустой набор — отказ, а не «снять вид»");
        assertTrue(empty.contains("пуст"), empty);
        String bad = LoreDictResource.kindRefusal("product", List.of("tech", "IT"));
        assertNotNull(bad);
        assertTrue(bad.contains("IT") && bad.contains("tech") && bad.contains("service"), bad);
        assertNotNull(LoreDictResource.kindRefusal("product", List.of(42)), "не строка — отказ");
    }

    @Test
    void singleKindDictionaryRefusesASet() {
        assertEquals("universal", LoreDictResource.normalizeKind("qg_type", "universal"));
        assertNotNull(LoreDictResource.kindRefusal("qg_type", List.of("universal", "project")),
            "у гейта вид один — набор не принимается");
    }

    @Test
    void storedStringKindEqualsTheSameSet() {
        assertTrue(LoreDictResource.sameAsStored(req("product", List.of("tech")), Map.of("kind", "tech")),
            "в базе прежняя строка — тот же вид, правки нет");
        assertTrue(LoreDictResource.sameAsStored(req("product", List.of("service", "tech")), Map.of("kind", List.of("tech", "service"))));
        assertFalse(LoreDictResource.sameAsStored(req("product", List.of("tech", "service")), Map.of("kind", List.of("tech"))),
            "добавить второй вид — правка");
    }

    @Test
    void changingKindOfExistingEntryNeedsReason() {
        Map<String, Object> stored = Map.of("kind", List.of("tech"));
        String r = LoreDictResource.reasonRefusal(req("product", List.of("tech", "service")), stored);
        assertNotNull(r, "смена вида без причины — отказ");
        assertTrue(r.contains("reason"), r);
        assertNull(LoreDictResource.reasonRefusal(req("product", List.of("tech", "service"), "HARPA продаёт услуги"), stored));
        assertNotNull(LoreDictResource.reasonRefusal(req("product", List.of("service"), "   "), stored), "пробелы — не причина");
        assertNull(LoreDictResource.reasonRefusal(req("product", List.of("tech")), stored), "вид тот же — причина не нужна");
        assertNull(LoreDictResource.reasonRefusal(req("product", List.of("tech")), null), "новая статья — не правка вида");
        assertNull(LoreDictResource.reasonRefusal(req("product", null), stored), "вид не прислан — не правка вида");
        Map<String, Object> none = new HashMap<>();
        none.put("kind", null);
        assertNull(LoreDictResource.reasonRefusal(req("product", List.of("tech")), none), "вид впервые — разметка, а не смена");
        assertNotNull(LoreDictResource.reasonRefusal(req("product", List.of("tech"), "x".repeat(501)), Map.of("kind", "service")),
            "причина длиннее 500 — отказ");
    }

    @Test
    void historyVersionCarriesTheReason() {
        assertTrue(LoreDictResource.HIST_INSERT.contains("change_reason=:reason"), LoreDictResource.HIST_INSERT);
    }

    /** Паспорт продукта показывает вид: фасад отдаёт kind списком (строка прежней записи — список из одного). */
    @Test
    void productPassportShowsKind() {
        Map<String, Object> row = new HashMap<>(Map.of("code", "HARPA", "label_ru", "HARPA", "kind", List.of("tech", "service")));
        assertEquals(List.of("tech", "service"), LoreRecordValues.values("product", row).get("kind"));
        row.put("kind", "service");
        assertEquals(List.of("service"), LoreRecordValues.values("product", row).get("kind"));
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

    /** SPRINT_QG_REBUILD/QG-04 (ADR-LORE-053-D3, слово владелицы 16.11.2026): тип гейта — универсальный или проектный. */
    @Test
    void qgTypeKindIsUniversalOrProject() {
        assertNull(LoreDictResource.kindRefusal("qg_type", "universal"));
        assertNull(LoreDictResource.kindRefusal("qg_type", "project"));
        String bad = LoreDictResource.kindRefusal("qg_type", "tech");
        assertNotNull(bad);
        assertTrue(bad.contains("universal") && bad.contains("project"), bad);
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
