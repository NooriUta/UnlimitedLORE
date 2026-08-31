package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Какая ФОРМА обхода ребра с фильтром действительно доходит до вершины на том
 * конце (TR-05).
 *
 * <p><b>Зачем отдельный тест.</b> Срез ролей отдавал пусто всегда: запрос
 * синтаксически верен, ошибки нет, а значения нет. По ответу это неотличимо от
 * «связи не заведены» — тот самый тихий отказ, который мы весь спринт
 * вылавливаем в чужом коде. Гадать форму дорого: каждая догадка — полная
 * сборка, а различающихся написаний в грамматике полдюжины.
 *
 * <p><b>Почему нельзя было посмотреть на работающий пример.</b> В корпусе
 * срезов фильтр по свойству ребра встречается ({@code inE('HAS_ACTOR')[role =
 * 'primary'].size()}), но НИ ОДИН рабочий срез не продолжает его через
 * {@code .in.<поле>}. То есть непроверенным остаётся ровно тот кусок, который
 * я и написала, — сравнивать не с чем.
 *
 * <p>Тест спрашивает базу напрямую шестью написаниями сразу и падает с полной
 * таблицей ответов. Он остаётся в наборе навсегда: если грамматика однажды
 * поменяется, это будет видно как красный тест, а не как опустевший экран.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class RoleEdgeHopFormLiveDbTest {

    private static final String PROJECT = "hop-form";
    private static final String SPRINT  = "SPRINT_HOP_FORM";
    private static final String TASK    = SPRINT + "/HF-1";
    private static final String AGENT   = "hop-agent";

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @BeforeAll
    static void resourceIsUp() {
        assertNotNull(LoreArcadeDbTestResource.BASE_URL, "живая БД обязана подняться раньше теста");
    }

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    /**
     * Сырой запрос мимо REST: у приложения нет и не должно быть ручки «отдай
     * строки как есть», а спрашиваем мы именно про язык запросов, не про API.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> query(String sql) {
        try {
            String auth = "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8));
            Map<String, Object> body = Map.of("language", "sql", "command", sql, "params", Map.of());
            HttpRequest req = HttpRequest.newBuilder(URI.create(
                    LoreArcadeDbTestResource.BASE_URL + "/api/v1/query/" + LoreArcadeDbTestResource.TEST_DB))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body)))
                .build();
            HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) return List.of(Map.of("__error", resp.body()));
            Map<String, Object> parsed = MAPPER.readValue(resp.body(), Map.class);
            Object result = parsed.get("result");
            return result instanceof List ? (List<Map<String, Object>>) result : List.of();
        } catch (Exception e) {
            return List.of(Map.of("__error", String.valueOf(e.getMessage())));
        }
    }

    /** Первое значение первой строки — сжато до «что увидел бы срез». */
    private String firstValue(String sql) {
        List<Map<String, Object>> rows = query(sql);
        if (rows.isEmpty()) return "<нет строк>";
        Map<String, Object> row = rows.get(0);
        if (row.containsKey("__error")) return "ОШИБКА: " + row.get("__error");
        // Намеренно НЕ stream().findFirst(): Optional запрещает null, а null —
        // это ровно тот ответ, ради которого проба и написана. Первая редакция
        // падала с NullPointerException на самом интересном случае, то есть
        // отказывалась сообщить именно то, что искали.
        for (Object v : row.values()) return v == null ? "null" : String.valueOf(v);
        return "<строка без полей>";
    }

    @Test
    void whichHopFormReachesTheVertexOnTheOtherEnd() {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + PROJECT + "\"}")
        .when().post("/lore/project").then().statusCode(200);

        admin().body("{\"actor_id\":\"" + AGENT + "\",\"name\":\"Проба формы\",\"kind\":\"agent\"}")
            .when().post("/lore/actor").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"Проба формы\","
                + "\"git_project\":\"" + PROJECT + "\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"task_id\":\"HF-1\",\"title\":\"Проба\"}")
            .when().post("/lore/task").then().statusCode(200);
        admin().body("{\"task_uid\":\"" + TASK + "\",\"role\":\"executor\",\"identity\":\"" + AGENT + "\"}")
            .when().post("/lore/task/role").then().statusCode(200);

        // Контроль: ребро действительно есть. Без него вся таблица ниже
        // показывала бы «пусто» по совсем другой причине, и вывод был бы ложным.
        String where = " FROM KnowTask WHERE task_uid = '" + TASK + "'";
        assertEquals("1", firstValue("SELECT outE('ROLE_HELD_BY').size() AS v" + where),
            "ребро роли не создано — дальше мерить нечего");

        Map<String, String> seen = new LinkedHashMap<>();
        seen.put("1. фильтр с AND, потом .in.поле[0]  (текущий срез)",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].in.actor_id[0] AS v" + where));
        seen.put("2. фильтр с AND, потом .in.поле",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].in.actor_id AS v" + where));
        seen.put("3. фильтр только по роли, потом .in.поле",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor'].in.actor_id AS v" + where));
        seen.put("4. два фильтра подряд",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor'][valid_to IS NULL].in.actor_id AS v" + where));
        seen.put("5. без фильтра вовсе",
            firstValue("SELECT out('ROLE_HELD_BY').actor_id AS v" + where));
        seen.put("6. expand по отфильтрованному ребру",
            firstValue("SELECT expand(outE('ROLE_HELD_BY')[role='executor'].in)" + where));
        seen.put("7. подзапрос от самого ребра",
            firstValue("SELECT @in.actor_id AS v FROM ROLE_HELD_BY WHERE @out.task_uid = '" + TASK + "'"));

        // ── Второй заход ─────────────────────────────────────────────────────
        //
        // ОШИБКА ПЕРВОГО ЗАХОДА, поймана владельцем: «это не дефект СУБД, а
        // дефект твоего запроса, перепроверяй». Права.
        //
        // Я сравнила `outE(...)[фильтр].in.поле` (пусто) с `out(...).поле`
        // (работает) и объявила виноватым фильтр. Но эти две формы отличаются
        // СРАЗУ В ДВУХ местах: не только наличием фильтра, но и функцией.
        // `out()` отдаёт ВЕРШИНУ, `outE()` — РЕБРО, а у ребра конец
        // адресуется как `@in`, не как обычное свойство `in`. Списка из одного
        // null достаточно, чтобы это увидеть: ребро нашлось, свойства с таким
        // именем у него нет.
        //
        // Опыт с двумя различиями сразу не отвечает ни на один вопрос. Формы
        // 14-17 разводят переменные: `@in` против `in`, с фильтром и без.
        // Форма 16 — недостающий контроль: если `in` пусто и БЕЗ фильтра,
        // фильтр невиновен окончательно.
        seen.put("14. фильтр + @in.поле",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].@in.actor_id AS v" + where));
        seen.put("15. фильтр + @in.поле[0]",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].@in.actor_id[0] AS v" + where));
        seen.put("16. БЕЗ фильтра + in.поле (контроль: виноват ли фильтр)",
            firstValue("SELECT outE('ROLE_HELD_BY').in.actor_id AS v" + where));
        seen.put("17. БЕЗ фильтра + @in.поле",
            firstValue("SELECT outE('ROLE_HELD_BY').@in.actor_id AS v" + where));

        // Формы 8-10 оставлены: они очерчивают, что у отфильтрованного ребра
        // читается собственное свойство. Это по-прежнему полезно знать.
        seen.put("8. фильтр + СВОЙСТВО САМОГО РЕБРА",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].role AS v" + where));
        seen.put("9. фильтр + сырая ссылка .in, без поля",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].in AS v" + where));
        seen.put("10. фильтр + .in.@rid",
            firstValue("SELECT outE('ROLE_HELD_BY')[role='executor' AND valid_to IS NULL].in.@rid AS v" + where));

        // Формы 11–13: подзапрос от ребра работает (форма 7), но в срезе он
        // обязан быть СВЯЗАН с текущей задачей, а не с зашитым кодом. Какая из
        // записей корреляции понимается — вопрос к базе, не к рассуждению.
        seen.put("11. подзапрос, связь через $parent.$current",
            firstValue("SELECT (SELECT @in.actor_id FROM ROLE_HELD_BY "
                + "WHERE @out = $parent.$current AND role='executor' AND valid_to IS NULL) AS v" + where));
        seen.put("12. подзапрос, связь по полю через $parent.$current",
            firstValue("SELECT (SELECT @in.actor_id FROM ROLE_HELD_BY "
                + "WHERE @out.task_uid = $parent.$current.task_uid AND role='executor' AND valid_to IS NULL) AS v" + where));
        seen.put("13. подзапрос в LET",
            firstValue("SELECT $r AS v FROM KnowTask LET $r = (SELECT @in.actor_id FROM ROLE_HELD_BY "
                + "WHERE @out.task_uid = $parent.$current.task_uid AND role='executor' AND valid_to IS NULL) "
                + "WHERE task_uid = '" + TASK + "'"));

        StringBuilder table = new StringBuilder("\nчто вернула база по каждой форме:\n");
        seen.forEach((k, v) -> table.append("  ").append(k).append(" → ").append(v).append('\n'));

        // Утверждение про ту форму, которая СТОИТ В СРЕЗЕ после правки:
        // фильтр по свойству ребра, затем @in — конец ребра.
        //
        // Про `.in` (форма 16 без фильтра) утверждения намеренно НЕТ. Она
        // отдаёт null, и это записано в таблице, но закреплять тестом чужое
        // поведение мы не будем: если версия базы однажды начнёт понимать и
        // такое написание, красный тест сообщит не об ошибке, а о подарке.
        // Сторожим своё, наблюдаем чужое.
        assertEquals(AGENT, seen.get("15. фильтр + @in.поле[0]"),
            "форма, которую использует срез ролей, не доходит до вершины." + table);
    }
}
