package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * RM-P13: выдача времени — ISO-8601 UTC с {@code Z}. Чистая функция, без БД.
 *
 * <p>Зачем: DATETIME ArcadeDB печатает {@code "2026-04-13 00:00:00"}, а
 * {@code new Date()} в браузере читает это как МЕСТНОЕ время — дата у
 * читателя в UTC+3 уезжает на три часа. {@code "…T…Z"} однозначен.
 */
class LoreTimeFormatTest {

    @Test
    void renderedDatetimeBecomesIsoZWithMillis() {
        assertEquals("2026-04-13T00:00:00.000Z", LoreTimeFormat.isoUtc("2026-04-13 00:00:00"));
        assertEquals("2026-11-04T19:56:10.171Z", LoreTimeFormat.isoUtc("2026-11-04 19:56:10.171"));
        // доля секунды дополняется до трёх знаков…
        assertEquals("2026-11-04T19:56:10.500Z", LoreTimeFormat.isoUtc("2026-11-04 19:56:10.5"));
        // …и обрезается до трёх: DATETIME всё равно миллисекундный
        assertEquals("2026-06-30T06:24:46.590Z", LoreTimeFormat.isoUtc("2026-06-30 06:24:46.590910794"));
    }

    @Test
    void otherShapesAreLeftAlone() {
        assertEquals("2026-08-31T12:34:56.789Z", LoreTimeFormat.isoUtc("2026-08-31T12:34:56.789Z"));
        assertEquals("2026-08-31T12:34:56Z", LoreTimeFormat.isoUtc("2026-08-31T12:34:56Z"));
        assertEquals("2026-04-13", LoreTimeFormat.isoUtc("2026-04-13"), "только дата — без времени, зону не выдумываем");
        assertEquals("сделано 2026-04-13 00:00:00", LoreTimeFormat.isoUtc("сделано 2026-04-13 00:00:00"),
            "совпадение должно быть ЦЕЛИКОМ — текст с датой внутри не трогаем");
        assertEquals("2026-04-13 00:00", LoreTimeFormat.isoUtc("2026-04-13 00:00"), "без секунд — не форма DATETIME");
        assertEquals("2026-04-13 00:00:00 ", LoreTimeFormat.isoUtc("2026-04-13 00:00:00 "));
        assertEquals("✅ DONE", LoreTimeFormat.isoUtc("✅ DONE"));
        assertEquals("", LoreTimeFormat.isoUtc(""));
        assertEquals(1781569369738L, LoreTimeFormat.isoUtc(1781569369738L));
        assertEquals(Boolean.TRUE, LoreTimeFormat.isoUtc(Boolean.TRUE));
        assertNull(LoreTimeFormat.isoUtc(null));
    }

    @Test
    void nestedListsAndMapsAreWalked() {
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("at", "2026-04-13 08:15:00");
        inner.put("label", "релиз");
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("valid_from", "2026-04-13 00:00:00");
        row.put("done_dates", List.of("2026-04-14 10:00:00.1", "2026-04-15"));
        row.put("nested", List.of(List.of("2026-04-16 23:59:59.999")));
        row.put("ev", inner);
        row.put("none", null);

        List<Map<String, Object>> out = LoreTimeFormat.isoUtcRows(List.of(row));

        Map<String, Object> r = out.get(0);
        assertEquals("2026-04-13T00:00:00.000Z", r.get("valid_from"));
        assertEquals(List.of("2026-04-14T10:00:00.100Z", "2026-04-15"), r.get("done_dates"));
        assertEquals(List.of(List.of("2026-04-16T23:59:59.999Z")), r.get("nested"));
        assertEquals(Map.of("at", "2026-04-13T08:15:00.000Z", "label", "релиз"), r.get("ev"));
        assertNull(r.get("none"));
        assertEquals(true, r.containsKey("none"), "null-поле сохраняется ключом");
        // вход не меняется — функция чистая
        assertEquals("2026-04-13 00:00:00", row.get("valid_from"));
    }

    record Passport(String id, String valid_from, List<Map<String, Object>> history) {}

    /**
     * Единая точка выдачи — фильтр ответа: тело любого вида (Map, record с
     * вложенными картами, JsonNode) сериализуется тем же ObjectMapper с
     * приведённым временем; прочие строки — без изменений.
     */
    @Test
    void responseFilterNormalizesAnyJsonBody() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("valid_from", "2026-04-13 00:00:00.123");
        body.put("date", "2026-04-13");
        body.put("word", "вчера");
        body.put("iso", "2026-08-31T12:34:56.789Z");
        body.put("rows", List.of(Map.of("valid_to", "2026-04-14 10:00:00")));
        String json = mapper.writeValueAsString(LoreTimeFormatResponseFilter.isoUtcEntity(body, mapper));
        Map<?, ?> back = mapper.readValue(json, Map.class);
        assertEquals("2026-04-13T00:00:00.123Z", back.get("valid_from"));
        assertEquals("2026-04-13", back.get("date"));
        assertEquals("вчера", back.get("word"));
        assertEquals("2026-08-31T12:34:56.789Z", back.get("iso"));
        assertEquals("2026-04-14T10:00:00.000Z", ((Map<?, ?>) ((List<?>) back.get("rows")).get(0)).get("valid_to"));

        Passport p = new Passport("ADR-1", "2026-04-13 00:00:00",
            List.of(Map.of("valid_from", "2026-04-12 09:30:00.5")));
        Map<?, ?> pj = mapper.readValue(mapper.writeValueAsString(
            LoreTimeFormatResponseFilter.isoUtcEntity(p, mapper)), Map.class);
        assertEquals("ADR-1", pj.get("id"));
        assertEquals("2026-04-13T00:00:00.000Z", pj.get("valid_from"), "record тоже приводится");
        assertEquals("2026-04-12T09:30:00.500Z", ((Map<?, ?>) ((List<?>) pj.get("history")).get(0)).get("valid_from"));
    }

    @Test
    void responseFilterLeavesForeignBodiesAndBenchAlone() {
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        String raw = "{\"ts\":\"2026-04-13 00:00:00\"}";
        assertEquals(raw, LoreTimeFormatResponseFilter.isoUtcEntity(raw, mapper), "строковое тело — уже готовый ответ");
        byte[] bytes = new byte[]{1, 2};
        assertEquals(bytes, LoreTimeFormatResponseFilter.isoUtcEntity(bytes, mapper));
        assertNull(LoreTimeFormatResponseFilter.isoUtcEntity(null, mapper));

        assertEquals(true, LoreTimeFormatResponseFilter.isBench("/bench/mart/slice/x"),
            "витрина bench пишет местные часы стенда — Z ей не дописываем");
        assertEquals(true, LoreTimeFormatResponseFilter.isBench("bench"));
        assertEquals(false, LoreTimeFormatResponseFilter.isBench("/lore/slice/sprint_starts"));
        assertEquals(false, LoreTimeFormatResponseFilter.isBench("/lore/benchmarks"));
        assertEquals(true, LoreTimeFormatResponseFilter.isJson(jakarta.ws.rs.core.MediaType.APPLICATION_JSON_TYPE));
        assertEquals(false, LoreTimeFormatResponseFilter.isJson(jakarta.ws.rs.core.MediaType.TEXT_PLAIN_TYPE));
    }

    @Test
    void rowOrderAndNullsSurvive() {
        Map<String, Object> a = new HashMap<>();
        a.put("k", "2026-01-01 00:00:00");
        List<Map<String, Object>> rows = new ArrayList<>(Arrays.asList(a, null, Map.of("k", "x")));
        List<Map<String, Object>> out = LoreTimeFormat.isoUtcRows(rows);
        assertEquals(3, out.size());
        assertEquals("2026-01-01T00:00:00.000Z", out.get(0).get("k"));
        assertNull(out.get(1));
        assertEquals("x", out.get(2).get("k"));
        assertNull(LoreTimeFormat.isoUtcRows(null));
    }
}
