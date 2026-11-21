package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_MINILORE_POLISH/LINKS-VIEW-HOLDER — читатель «сессии у записи» на стороне LORE
 * (формат версии 1, SPEC-LORE-SESSION-AT-RECORD). Здесь — разбор ответа сервера miniLORE и
 * состояния: «не настроено», «нет доступа» и «сбой» не выглядят как «никто не ведёт».
 */
class MiniloreHolderReaderTest {

    static final String ONE = "{\"v\":1,\"sessionId\":\"s-1\",\"machineId\":\"lorcetus\",\"since\":\"2026-11-16T09:00:00Z\","
        + "\"source\":\"minilore\",\"derived\":true,\"dialogueName\":\"Модель\",\"x\":{\"probe\":1},\"future_key\":\"как есть\"}";

    /**
     * SPRINT_LORE_PRODUCT_BACKLOG/SELF-PROVISION-STANDALONE: адрес токена Keycloak — настройка, без
     * умолчания на наш Keycloak. Не задан — честное «не настроено» (старт не падает, в сеть не ходим).
     */
    @Test
    void tokenUrlWithoutSettingIsNotConfiguredNotOurKeycloak() {
        MiniloreHolderReader r = new MiniloreHolderReader();
        r.url = java.util.Optional.of("http://minilore.example:8080");
        r.tokenUrl = java.util.Optional.empty();
        MiniloreHolderReader.Result res = r.read("SPRINT_X/T-1");
        assertEquals("not_configured", res.state());
        assertTrue(res.reason().contains("lore.minilore.token-url"), res.reason());
    }

    @Test
    void validObjectsOfVersionOneAreKeptWithUnknownKeys() {
        MiniloreHolderReader.Result r = MiniloreHolderReader.fromResponse(200, "[" + ONE + "]");
        assertEquals("ok", r.state());
        assertEquals(1, r.items().size());
        Map<String, Object> s = r.items().get(0);
        assertEquals("s-1", s.get("sessionId"));
        assertEquals("как есть", s.get("future_key"), "неизвестные ключи сохраняются — формат растёт добавлением");
        assertNull(r.reason());
    }

    @Test
    void emptyArrayIsAnHonestNobody() {
        MiniloreHolderReader.Result r = MiniloreHolderReader.fromResponse(200, "[]");
        assertEquals("ok", r.state());
        assertEquals(List.of(), r.items());
    }

    @Test
    void objectWithoutRequiredKeysIsDroppedAndCounted() {
        String broken = "{\"v\":1,\"sessionId\":\"s-2\",\"since\":\"2026-11-16T09:00:00Z\",\"source\":\"minilore\"}"; // нет machineId
        MiniloreHolderReader.Result r = MiniloreHolderReader.fromResponse(200, "[" + ONE + "," + broken + "]");
        assertEquals("ok", r.state());
        assertEquals(1, r.items().size());
        assertTrue(r.reason().contains("1"), "отброшенное названо: " + r.reason());
    }

    @Test
    void unknownFormatVersionIsNotGuessed() {
        String v9 = ONE.replace("\"v\":1", "\"v\":9");
        MiniloreHolderReader.Result r = MiniloreHolderReader.fromResponse(200, "[" + v9 + "]");
        assertEquals(0, r.items().size());
        assertTrue(r.reason().contains("верси"), r.reason());
    }

    @Test
    void refusalAndFailureAreNotAnEmptyList() {
        assertEquals("denied", MiniloreHolderReader.fromResponse(401, "").state());
        assertEquals("denied", MiniloreHolderReader.fromResponse(403, "{\"error\":\"azp\"}").state());
        assertEquals("error", MiniloreHolderReader.fromResponse(502, "").state());
        assertEquals("error", MiniloreHolderReader.fromResponse(200, "не json").state());
        assertEquals("error", MiniloreHolderReader.fromResponse(200, "{\"не\":\"массив\"}").state());
        for (int code : new int[] {401, 403, 502})
            assertTrue(MiniloreHolderReader.fromResponse(code, "").reason().contains(String.valueOf(code)), "код ответа назван");
    }

    @Test
    void notFoundMeansTheDoorIsMissingNotThatNobodyWorked() {
        // Дверь miniLORE на пустое отвечает 200 и []; 404 она не отдаёт. Значит 404 — старый сервер без двери
        // или неверный адрес: принять его за «никто не работал» значило бы спрятать поломку.
        MiniloreHolderReader.Result r = MiniloreHolderReader.fromResponse(404, "");
        assertEquals("error", r.state());
        assertTrue(r.reason().contains("404"), r.reason());
    }

    @Test
    void recordCodeWithSlashKeepsItsParts() {
        assertEquals("/links/record/SPRINT_X/CO-11?view=holder", MiniloreHolderReader.path("SPRINT_X/CO-11"));
        assertEquals("/links/record/ADR-LORE-050?view=holder", MiniloreHolderReader.path("ADR-LORE-050"));
        assertEquals("/links/record/%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C?view=holder", MiniloreHolderReader.path("запись"));
    }

    @Test
    void resultAsJsonNamesStateAndNeverCarriesSecrets() {
        Map<String, Object> j = MiniloreHolderReader.Result.notConfigured("не задан адрес miniLORE").toJson();
        assertEquals("not_configured", j.get("state"));
        assertEquals(List.of(), j.get("items"));
        assertEquals("не задан адрес miniLORE", j.get("reason"));
    }
}
