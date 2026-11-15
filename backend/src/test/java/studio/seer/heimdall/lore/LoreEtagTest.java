package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сверка If-None-Match с тегом ответа.
 *
 * <p>Повод (приложение miniLORE, 15.11.2026): /lore/model отвечал 200 вместо 304. Сжатие ответа
 * у nginx делает тег слабым — {@code W/"<версия>"}; клиент честно возвращает его в If-None-Match,
 * а сервер сравнивал строку целиком, сняв только кавычки. Условный запрос — «слабое» сравнение
 * (RFC 9110 §13.1.2): признак W/ не учитывается, в заголовке может быть несколько тегов и «*».
 */
class LoreEtagTest {

    @Test
    void sameStrongTagMatches() {
        assertTrue(LoreEtag.matches("\"v42\"", "v42"));
        assertTrue(LoreEtag.matches("v42", "v42"), "тег без кавычек — как присылали прежние клиенты");
    }

    @Test
    void weakTagFromCompressingProxyMatches() {
        assertTrue(LoreEtag.matches("W/\"v42\"", "v42"));
        assertTrue(LoreEtag.matches("w/\"v42\"", "v42"));
    }

    @Test
    void ourTagMayItselfBeQuotedOrWeak() {
        assertTrue(LoreEtag.matches("W/\"abc\"", "\"abc\""));
        assertTrue(LoreEtag.matches("\"abc\"", "W/\"abc\""));
    }

    @Test
    void listOfTagsAndStar() {
        assertTrue(LoreEtag.matches("\"old\", W/\"v42\" , \"other\"", "v42"));
        assertTrue(LoreEtag.matches("*", "v42"));
    }

    @Test
    void differentOrMissingTagDoesNotMatch() {
        assertFalse(LoreEtag.matches("W/\"v41\"", "v42"));
        assertFalse(LoreEtag.matches("\"v4\"", "v42"), "часть тега — не совпадение");
        assertFalse(LoreEtag.matches(null, "v42"));
        assertFalse(LoreEtag.matches("  ", "v42"));
        assertFalse(LoreEtag.matches("\"v42\"", null), "тега у ответа нет — сравнивать не с чем");
        assertFalse(LoreEtag.matches("\"\"", ""), "пустой тег ничему не равен");
    }
}
