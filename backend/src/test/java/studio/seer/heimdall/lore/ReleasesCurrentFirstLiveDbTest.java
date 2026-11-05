package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * 05.11.2026 (сессия Völva): {@code releases} с {@code limit=1} отдал v0.1.6
 * (is_current=false), хотя текущий — v0.1.7. Порядок был только
 * {@code release_date DESC}, а у релизов одной даты он произволен: «какой релиз
 * текущий» получал неверный ответ, который выглядит правильным.
 *
 * <p>Инвариант на НАСТОЯЩЕЙ базе (сортировка null/boolean в ArcadeDB — факт, а не
 * предположение): все is_current=true идут раньше всех прочих, в том числе
 * is_current=null; при равной дате порядок детерминирован.</p>
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class ReleasesCurrentFirstLiveDbTest {

    private static void sql(String command) throws Exception {
        String body = io.vertx.core.json.JsonObject.of("language", "sql", "command", command).encode();
        HttpResponse<String> r = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                URI.create(LoreArcadeDbTestResource.BASE_URL + "/api/v1/command/" + LoreArcadeDbTestResource.TEST_DB))
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString(
                ("root:" + LoreArcadeDbTestResource.ROOT_PASSWORD).getBytes(StandardCharsets.UTF_8)))
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        assertEquals(200, r.statusCode(), command + " → " + r.body());
    }

    @Test
    void currentReleaseComesFirstEvenAmongSameDate() throws Exception {
        // Три релиза одной даты, текущий вставлен НЕ первым и НЕ последним; у одного is_current = null.
        sql("INSERT INTO KnowRelease SET release_id='vORD-1', release_uid='test/ord#vORD-1', release_date='2099-01-01', is_current=false");
        sql("INSERT INTO KnowRelease SET release_id='vORD-2', release_uid='test/ord#vORD-2', release_date='2099-01-01', is_current=true");
        sql("INSERT INTO KnowRelease SET release_id='vORD-3', release_uid='test/ord#vORD-3', release_date='2099-01-01'");

        List<Map<String, Object>> rows = given().when()
            .get("/lore/slice/releases?fields=release_id,is_current,release_date")
            .then().statusCode(200).extract().jsonPath().getList("rows");
        assertFalse(rows.isEmpty(), "положительный контроль: срез вернул строки");

        int lastCurrent = -1, firstOther = Integer.MAX_VALUE;
        for (int i = 0; i < rows.size(); i++) {
            boolean cur = Boolean.TRUE.equals(rows.get(i).get("is_current"));
            if (cur) lastCurrent = i; else firstOther = Math.min(firstOther, i);
        }
        assertTrue(lastCurrent >= 0, "текущий релиз есть в выдаче: " + rows);
        assertTrue(lastCurrent < firstOther, "все is_current=true раньше прочих (и null тоже): " + rows);

        // limit=1 — ровно «какой релиз текущий»
        List<Map<String, Object>> one = given().when()
            .get("/lore/slice/releases?limit=1&fields=release_id,is_current")
            .then().statusCode(200).extract().jsonPath().getList("rows");
        assertEquals(Boolean.TRUE, one.get(0).get("is_current"), "limit=1 отдаёт текущий: " + one);

        // при равной дате порядок детерминирован: два прогона совпадают
        List<Object> a = given().when().get("/lore/slice/releases?fields=release_id").then().statusCode(200)
            .extract().jsonPath().getList("rows.release_id");
        List<Object> b = given().when().get("/lore/slice/releases?fields=release_id").then().statusCode(200)
            .extract().jsonPath().getList("rows.release_id");
        assertEquals(a, b);
        int i1 = a.indexOf("vORD-1"), i3 = a.indexOf("vORD-3");
        assertTrue(i1 >= 0 && i3 >= 0, "оба нетекущих в выдаче: " + a);
    }
}
