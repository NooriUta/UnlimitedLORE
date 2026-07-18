package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SRCH-04: whitelist значений slice-параметров.
 *
 * Регрессия, ради которой этот тест существует: `VALUE_RE` был скомпилирован без
 * UNICODE_CHARACTER_CLASS, а java-шный `\w` без этого флага — ASCII-только. Любой
 * поисковый запрос на кириллице отбивался как BAD_PARAMS (400), и сквозной поиск
 * по русскоязычной базе знаний не работал НИКОГДА. Снаружи это выглядело как
 * «просто ничего не находит», потому что 400 у клиента неотличим от пустой выдачи,
 * если смотреть только на rows.
 *
 * Тест держит обе стороны контракта: юникод пропускаем, опасную пунктуацию — нет.
 */
class LoreSliceValueWhitelistTest {

    private static boolean ok(String v) {
        return LoreSlices.VALUE_RE.matcher(v).matches();
    }

    @Test
    void cyrillicSearchQueriesAreAccepted() {
        assertTrue(ok("токен"),            "кириллица — основной язык корпуса");
        assertTrue(ok("релиз"),            "кириллица одним словом");
        assertTrue(ok("зонтик продукт"),   "несколько слов через пробел");
        assertTrue(ok("Ёлка"),             "Ё вне базового кириллического диапазона");
        assertTrue(ok("Seiðr"),            "латиница с диакритикой (ð) — имена продуктов");
    }

    @Test
    void latinIdsAndTechnicalValuesStillPass() {
        assertTrue(ok("ADR-LORE-024"),                 "id с дефисами");
        assertTrue(ok("v1.0.54"),                      "semver");
        assertTrue(ok("2026-07-18"),                   "дата");
        assertTrue(ok("NooriUta/UnlimitedLORE#v1.0.53"), "release_uid со слэшем и #");
        assertTrue(ok("SPRINT_LORE_PRODUCT_LAYER/SRCH-04"), "task_uid");
        assertTrue(ok("%merge%"),                      "LIKE-шаблон");
        assertTrue(ok("a@b.co"),                       "почта");
    }

    @Test
    void dangerousPunctuationStaysRejected() {
        // Значения уходят в ArcadeDB связанными параметрами, но whitelist — второй
        // рубеж, и расширение до юникода не должно его ослаблять.
        assertFalse(ok("'"),              "одинарная кавычка");
        assertFalse(ok("\""),             "двойная кавычка");
        assertFalse(ok("a; DROP TYPE X"), "точка с запятой");
        assertFalse(ok("(SELECT 1)"),     "скобки");
        assertFalse(ok("a\\b"),           "обратный слэш");
        assertFalse(ok("a\nb"),           "перевод строки");
        assertFalse(ok("*"),              "звёздочка не в whitelist (префикс добавляет сам слайс)");
    }

    @Test
    void emptyAndOverlongAreRejected() {
        assertFalse(ok(""), "пустое значение");
        assertFalse(ok("я".repeat(161)), "длиннее 160 символов");
        assertTrue(ok("я".repeat(160)),  "ровно 160 — граница включительно");
    }
}
