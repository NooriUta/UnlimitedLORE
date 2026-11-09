package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S11_TEST_OPT/CT-SLICES-V2 — контракт двух оставшихся источников, которые читают
 * kit, web-next и miniLORE: справочники (срез dictionary) и лента новостей v2.
 * Повод — дефект #1001: тип поля поменялся (строка → массив), а клиентская фикстура держала
 * старый, и тесты молчали. Здесь — имена и ТИПЫ полей на живом ответе.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class SliceContractsDictionaryNewsLiveDbTest {

    @Test
    void dictionaryRowShape() {
        List<Map<String, Object>> rows = given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/dictionary").then().statusCode(200)
            .extract().jsonPath().getList("rows");
        assertFalse(rows.isEmpty(), "справочники засеяны миграциями — пусто значит сломано");
        for (Map<String, Object> r : rows) {
            String w = r.get("dict_type") + "/" + r.get("code");
            assertTrue(r.keySet().containsAll(Set.of("dict_type", "code", "label_ru", "label_en", "color", "icon",
                "sort_order", "is_active", "is_extensible")), w + ": ключи " + r.keySet());
            assertInstanceOf(String.class, r.get("dict_type"), w);
            assertInstanceOf(String.class, r.get("code"), w);
            assertInstanceOf(Boolean.class, r.get("is_active"), w + ": is_active — булево (ifnull в срезе)");
            assertInstanceOf(Boolean.class, r.get("is_extensible"), w + ": is_extensible — булево");
        }
        assertTrue(rows.stream().anyMatch(r -> "harness".equals(r.get("dict_type"))),
            "справочник harness засеян V75 — экран «Агенты» берёт реестр отсюда");
    }

    @Test
    @SuppressWarnings("unchecked")
    void newsV2Shape() {
        JsonPath j = given().header("X-Seer-Role", "admin")
            .when().get("/lore/news/v2?days=7&limit=50").then().statusCode(200).extract().jsonPath();
        Map<String, Object> body = j.getMap("$");
        assertTrue(body.keySet().containsAll(Set.of("events", "groups", "metrics", "meta")), "ключи ответа: " + body.keySet());
        assertInstanceOf(List.class, body.get("events"));
        Map<String, Object> meta = (Map<String, Object>) body.get("meta");
        assertTrue(meta.keySet().containsAll(Set.of("generated_at", "scope", "period", "total", "truncated", "errors", "state")),
            "ключи meta: " + meta.keySet());
        assertInstanceOf(Boolean.class, meta.get("truncated"), "truncated — булево");
        assertInstanceOf(List.class, meta.get("errors"), "errors — массив: сбой источника называется, а не прячется");
        assertTrue(Set.of("ok", "empty", "partial").contains(meta.get("state")),
            "state из закрытого набора: «пусто» ≠ «источник не прочитан»: " + meta.get("state"));
        for (Map<String, Object> e : (List<Map<String, Object>>) body.get("events")) {
            assertTrue(e.keySet().containsAll(Set.of("type", "el", "kind")), "ключи события: " + e.keySet());
            assertInstanceOf(String.class, e.get("type"));
            assertInstanceOf(String.class, e.get("el"));
        }
    }
}
