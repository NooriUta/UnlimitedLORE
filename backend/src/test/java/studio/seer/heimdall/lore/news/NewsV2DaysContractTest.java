package studio.seer.heimdall.lore.news;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S7A_NEWS/S7A-09 — свёртки по дню считает сервер. Чистый юнит: без БД, без Quarkus.
 *
 * <p><b>Зачем.</b> Цифры в заголовке дня (итог, разбивка по видам и типам, «закрыто против
 * заведено») и счёт группы внутри дня веб считал сам — по строкам ленты, которые пришли.
 * miniLORE считает своё. Два вычислителя одной метрики расходятся, а при {@code limit}
 * клиент к тому же считал по обрезанному списку. Теперь ответ несёт {@code days[]} —
 * готовые свёртки по всему периоду, клиенты только рисуют.
 *
 * <p><b>Контракт аддитивный:</b> прежние ключи ответа не тронуты, добавлен только {@code days}.
 * Счёт {@code rows} — число строк ленты (дедуп «элемент : вид : день», §5), то есть ровно то,
 * что клиент раньше насчитывал сам; {@code events}/{@code elements} — двойной счёт §2.
 *
 * <p><b>Снимок для клиентов.</b> Полный ответ на фикстуре §10.4 лежит в
 * {@code src/test/resources/news-v2/contract-v2-fixture.json}; тест веба
 * ({@code web-next/src/news/feed/newsDays.contract.test.tsx}) рисует ленту из этого же
 * файла, miniLORE сверяет по нему свой разбор. Пересобрать снимок после намеренной правки
 * ответа: переменная окружения {@code NEWS_SNAPSHOT_UPDATE=true} при прогоне этого класса.
 */
class NewsV2DaysContractTest {

    static final Path SNAPSHOT = Path.of("src/test/resources/news-v2/contract-v2-fixture.json");

    static NewsV2.Query query(String groupBy, Integer matrixN, Integer limit) {
        return new NewsV2.Query(null, null, null, null, null, null, null, null, groupBy, null, matrixN, limit, null, null);
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> days(Map<String, Object> out) {
        Object d = out.get("days");
        assertNotNull(d, "в ответе нет days — свёртки по дню считает клиент");
        return (List<Map<String, Object>>) d;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> m(Object o, String k) { return (Map<String, Object>) ((Map<String, Object>) o).get(k); }
    static int n(Object o, String k) { return ((Number) ((Map<?, ?>) o).get(k)).intValue(); }

    static Map<String, Object> day(List<Map<String, Object>> days, String d) {
        return days.stream().filter(x -> d.equals(String.valueOf(x.get("day")))).findFirst()
            .orElseThrow(() -> new AssertionError("нет дня " + d));
    }

    @Test
    void dayOfAgentSeriesCountsRowsEventsAndElements() {
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(query("project", null, null));
        Map<String, Object> d = day(days(out), "2026-11-04");
        // 04.11 (Москва): C «изменено» ×3 (серия агента — одна строка), K переоткрыта, релиз P1#v2.
        assertEquals(5, n(d.get("total"), "events"));
        assertEquals(3, n(d.get("total"), "elements"));
        assertEquals(3, n(d, "rows"));
        Map<String, Object> changed = m(m(d, "by_kind"), "changed");
        assertEquals(List.of(3, 1, 1), List.of(n(changed, "events"), n(changed, "elements"), n(changed, "rows")));
        Map<String, Object> task = m(m(d, "by_type"), "task");
        assertEquals(List.of(4, 2, 2), List.of(n(task, "events"), n(task, "elements"), n(task, "rows")));
        assertEquals(1, n(m(m(task, "by_kind"), "changed"), "rows"), "вид внутри типа — для «заведено задач»");
        assertEquals(1, n(m(m(d, "by_type"), "release"), "rows"));
    }

    @Test
    void daysAddUpToThePeriodAndAgreeWithMatrix() {
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(query("project", 6, null));
        List<Map<String, Object>> days = days(out);
        // Ведра разные: день — последний статус дня, период — последний статус периода. Сходятся
        // они через ленту: счёт + отброшенное как промежуточное = все события ленты (meta.total).
        Map<String, Object> total = m(m(out, "metrics"), "counts");
        int feedEvents = n(m(out, "meta").get("total"), "events");
        assertEquals(feedEvents, days.stream().mapToInt(d -> n(d.get("total"), "events") + n(d.get("intermediate"), "events")).sum(),
            "события дней + промежуточные = события ленты");
        assertEquals(feedEvents, n(total.get("total"), "events") + n(total.get("intermediate"), "events"),
            "события периода + промежуточные = события ленты");
        // строки дня + промежуточные строки — те же, что строки ленты (без limit лента целиком)
        assertEquals(((List<?>) out.get("events")).size(),
            days.stream().mapToInt(d -> n(d, "rows") + n(d.get("intermediate"), "rows")).sum());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> mrows = (List<Map<String, Object>>) m(out, "matrix").get("rows");
        for (Map<String, Object> r : mrows) {
            Map<String, Object> d = day(days, String.valueOf(r.get("day")));
            assertEquals(r.get("total"), d.get("total"), "итог дня = строка матрицы " + r.get("day"));
        }
        for (Map<String, Object> d : days) {
            int byKind = m(d, "by_kind").values().stream().mapToInt(x -> n(x, "rows")).sum();
            int byType = m(d, "by_type").values().stream().mapToInt(x -> n(x, "rows")).sum();
            assertEquals(n(d, "rows"), byKind, "строки дня по видам " + d.get("day"));
            assertEquals(n(d, "rows"), byType, "строки дня по типам " + d.get("day"));
        }
        // дни — в порядке ленты: новые сверху
        List<String> order = days.stream().map(d -> String.valueOf(d.get("day"))).toList();
        List<String> desc = new ArrayList<>(order); desc.sort(Comparator.reverseOrder());
        assertEquals(desc, order);
    }

    @Test
    void groupsInsideTheDayFollowTheRequestAxis() {
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(query("project", null, null));
        Map<String, Object> d = day(days(out), "2026-11-04");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> g = (List<Map<String, Object>>) d.get("groups");
        assertEquals("project", d.get("axis"));
        // 04.11 все три строки — проект P1 (C, K — спринт S1; релиз P1#v2)
        assertEquals(1, g.size());
        assertEquals("P1", g.get(0).get("key"));
        assertEquals(List.of(5, 3, 3), List.of(n(g.get(0), "events"), n(g.get(0), "elements"), n(g.get(0), "rows")));
        // общий спринт S2 (P1+P2): у 02.11 группа P2 тоже есть, Σ строк групп ≥ строк дня
        Map<String, Object> d2 = day(days(out), "2026-11-02");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> g2 = (List<Map<String, Object>>) d2.get("groups");
        assertTrue(g2.stream().anyMatch(x -> "P2".equals(x.get("key"))));
        assertTrue(g2.stream().mapToInt(x -> n(x, "rows")).sum() >= n(d2, "rows"));
    }

    @Test
    void limitCutsTheListButNotTheDayNumbers() {
        NewsV2Engine e = NewsV2EngineFixtureTest.engine();
        Map<String, Object> full = e.compute(query("project", null, null));
        Map<String, Object> cut = e.compute(query("project", null, 2));
        assertEquals(2, ((List<?>) cut.get("events")).size(), "лента обрезана");
        assertEquals(full.get("days"), cut.get("days"), "свёртки дня считаются по всему периоду, а не по обрезанной ленте");
    }

    @Test
    void additiveContractKeepsEveryPreviousTopLevelKey() {
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(query("project", 6, null));
        assertTrue(out.keySet().containsAll(List.of("events", "groups", "metrics", "matrix", "meta")), out.keySet().toString());
        assertTrue(out.containsKey("days"));
    }

    @Test
    void snapshotForClientsMatchesTheEngine() throws Exception {
        ObjectMapper om = new ObjectMapper().findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).enable(SerializationFeature.INDENT_OUTPUT);
        Map<String, Object> out = NewsV2EngineFixtureTest.engine().compute(query("project", 6, null));
        String json = om.writeValueAsString(out) + "\n";
        if ("true".equals(System.getenv("NEWS_SNAPSHOT_UPDATE"))) Files.writeString(SNAPSHOT, json, StandardCharsets.UTF_8);
        assertTrue(Files.exists(SNAPSHOT), "нет снимка " + SNAPSHOT + " — собрать: NEWS_SNAPSHOT_UPDATE=true");
        JsonNode want = om.readTree(Files.readString(SNAPSHOT, StandardCharsets.UTF_8));
        assertEquals(want, om.readTree(json), "ответ движка разошёлся со снимком клиентов — пересобрать снимок намеренно: NEWS_SNAPSHOT_UPDATE=true");
        assertTrue(want.has("days") && want.get("days").size() > 0, "в снимке есть свёртки дня");
    }
}
