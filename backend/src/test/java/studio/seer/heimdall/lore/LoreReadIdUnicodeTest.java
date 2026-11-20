package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH п.2 — решение владелицы 14.11.2026 (D2 «только на чтение»):
 * на ЧТЕНИИ (паспорт {@code GET /lore/record/{type}/{id}} и {@code GET /lore/history}) id может нести
 * Unicode-буквы; несуществующая запись — 404 «записи нет», а не 400 «ключ недопустим». Пути ЗАПИСИ
 * остаются ASCII ({@code SAFE_ID}). Чистый юнит: база подменена заглушкой.
 */
class LoreReadIdUnicodeTest {

    /** Заглушка базы: отвечает функцией от (sql, params); запоминает, что спросили. */
    static final class StubIngest extends LoreIngestService {
        final BiFunction<String, Map<String, Object>, List<Map<String, Object>>> answer;
        final List<Map<String, Object>> asked = new ArrayList<>();
        StubIngest(BiFunction<String, Map<String, Object>, List<Map<String, Object>>> answer) { this.answer = answer; }
        @Override
        public List<Map<String, Object>> queryPublic(String sql, Map<String, Object> params) {
            asked.add(params);
            return answer.apply(sql, params);
        }
    }

    static LoreRecordResource record(StubIngest db) {
        LoreRecordResource r = new LoreRecordResource();
        r.enabled = true;
        r.ingestService = db;
        r.sliceResource = new AidaLoreResource();   // скоуп выключен (lore.scope.enforce=false) → null
        return r;
    }

    static LoreHistoryResource history(StubIngest db) {
        LoreHistoryResource r = new LoreHistoryResource();
        r.enabled = true;
        r.ingestService = db;
        r.slices = new AidaLoreResource();
        return r;
    }

    static String code(Response r) {
        Object e = r.getEntity();
        return e instanceof LoreResourceBase.LoreError le ? le.error() : String.valueOf(e);
    }

    @Test
    void missingCyrillicRecordIsNotFoundNot400() {
        Response r = record(new StubIngest((sql, p) -> List.of())).record("agent", "нет-такого-агента", "admin");
        assertEquals(404, r.getStatus(), "нет записи — 404, а не «ключ недопустим»: " + code(r));
        assertEquals("NOT_FOUND", code(r));
    }

    @Test
    void existingCyrillicRecordOpens() {
        String id = "агент-словаря";
        StubIngest db = new StubIngest((sql, p) -> p.containsValue(id) && sql.contains("agent")
            ? List.of(Map.of("id", id, "actor_id", id, "title", "Агент словаря")) : List.of());
        Response r = record(db).record("agent", id, "admin");
        assertEquals(200, r.getStatus(), "кириллический ключ существующей записи открывается: " + code(r));
        assertTrue(db.asked.stream().anyMatch(p -> p.containsValue(id)), "в базу ушёл тот самый id");
    }

    @Test
    void sqlMetacharactersStillRefusedOnRead() {
        for (String bad : List.of("a'b", "x;DROP", "a b", "q\"", "(x)", "a%b"))
            assertEquals(400, record(new StubIngest((sql, p) -> List.of())).record("agent", bad, "admin").getStatus(),
                "метасимволы SQL на чтении по-прежнему 400: " + bad);
    }

    @Test
    void historyAcceptsCyrillicId() {
        StubIngest db = new StubIngest((sql, p) -> List.of());
        Response r = history(db).history("task", "SPRINT_X/ЗАДАЧА-1", null, null, null, null, null, null, null, "admin");
        assertNotEquals(400, r.getStatus(), "история по кириллическому id не отбивается как недопустимый ключ: " + code(r));
        assertTrue(db.asked.stream().anyMatch(p -> "SPRINT_X/ЗАДАЧА-1".equals(p.get("id"))));
    }

    @Test
    void writePathsStayAscii() {
        assertFalse(LoreResourceBase.SAFE_ID.matcher("задача").matches(), "SAFE_ID записи — ASCII, как было");
        assertTrue(LoreResourceBase.SAFE_READ_ID.matcher("задача-1/Ё_2.x").matches());
        Response r = record(new StubIngest((sql, p) -> List.of())).relation("task", "SPRINT_X/ЗАДАЧА-1",
            new LoreRecordResource.RelationRequest("adr", null, "ADR-X", null, null, null, null), "admin");
        assertEquals(400, r.getStatus(), "запись (привязка) с кириллическим id — по-прежнему 400");
    }
}
