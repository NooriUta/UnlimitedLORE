package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-05 — супертеги, энд-ту-энд: геоид {@code tag:<slug>}
 * при создании и сторож переименования {@code POST /lore/tag/rename}.
 *
 * <p>Сценарий: заводим ADR и тег «sec-review» через {@code /lore/tag/apply}; вершина
 * обязана родиться с геоид-ключом {@code tag:sec-review}. Документ несёт токен
 * {@code [[ADR#sec-review]]}, битый геоид и голое упоминание. Переименование
 * переписывает ТОЛЬКО сопоставленный токен, отчёт называет несопоставленные,
 * бывшее имя попадает в {@code synonyms}, срез «сущности по тегу» находит ADR
 * уже по новому имени.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class TagRenameLiveDbTest {

    private static final String ADR = "ADR-SKILL05-1";
    private static final String DOC = "skill05_rename_probe";
    private static final String BODY =
        "Разбор: [[" + ADR + "#sec-review]]; битый [[GHOST-1#sec-review]]; голый #sec-review хештег.\n";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void tagApplyCreatesVertexWithGeoid() {
        // тело ADR (открытая версия истории) тоже несёт токен — перепись идёт по всем телам (062 §8)
        admin().body(Map.of("adr_id", ADR, "name", "проба SKILL-05", "context_md", "Контекст: [[" + ADR + "#sec-review]]."))
            .when().post("/lore/adr")
            .then().statusCode(200).body("ok", equalTo(true));
        admin().body(Map.of("type", "adr", "id", ADR, "tag_id", "sec-review")).when().post("/lore/tag/apply")
            .then().statusCode(200).body("ok", equalTo(true));
        // подсказка редактора: tag_id — человекочитаемое имя, geoid — tag:<slug>
        admin().when().get("/lore/tag/suggest?q=sec").then().statusCode(200)
            .body("tags", hasSize(1))
            .body("tags[0].tag_id", equalTo("sec-review"))
            .body("tags[0].geoid", equalTo("tag:sec-review"));
    }

    @Test
    @Order(2)
    void renameRewritesBodyAndReportsUnmatched() {
        admin().body(Map.of("doc_id", DOC, "title", "проба rename", "kind", "page",
                "content_md_ru", BODY)).when().post("/lore/doc")
            .then().statusCode(200).body("ok", equalTo(true));

        admin().body(Map.of("from", "sec-review", "to", "security-review")).when().post("/lore/tag/rename")
            .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("from", equalTo("sec-review"))
            .body("to", equalTo("security-review"))
            .body("tag_id", equalTo("tag:security-review"))
            // 062 §7: несопоставленные есть — outcome partial_failure, ok остаётся true (вызов дошёл)
            .body("outcome", equalTo("partial_failure"))
            .body("rewritten.findAll { it.field == 'content_md_ru' }", hasSize(1))
            .body("rewritten.find { it.field == 'content_md_ru' }.doc_id", equalTo(DOC))
            .body("rewritten.find { it.field == 'content_md_ru' }.places", equalTo(1))
            // перепись — не только доки: токен в теле ADR (открытая версия) переписан
            .body("rewritten.findAll { it.type == 'adr' && it.field == 'context_md' }", hasSize(1))
            .body("unmatched.findAll { it.field == 'content_md_ru' }", hasSize(2))
            .body("unmatched.fragment", hasItem(containsString("GHOST-1")))
            .body("unmatched.fragment", hasItem(containsString("#sec-review")))
            .body("synonyms", hasItem("sec-review"));

        // тело переписано ровно в одном месте; история KnowDocHist не трогалась
        admin().when().get("/lore/slice/doc_by_id?id=" + DOC).then().statusCode(200)
            .body("rows[0].content_md_ru", containsString("[[" + ADR + "#security-review]]"))
            .body("rows[0].content_md_ru", not(containsString("[[" + ADR + "#sec-review]]")))
            .body("rows[0].content_md_ru", containsString("[[GHOST-1#sec-review]]"))
            .body("rows[0].content_md_ru", containsString("голый #sec-review"));

        // срез «сущности по тегу» находит ADR по новому имени
        admin().when().get("/lore/tag/entities?tag=security-review").then().statusCode(200)
            .body("state", equalTo("ok"))
            .body("total", equalTo(1))
            .body("rows[0].id", equalTo(ADR));
    }

    /** 061 §5: занятое имя — 409 IDENTITY_CONFLICT, прежний код — в legacy_code. */
    @Test
    @Order(3)
    void takenNameIsIdentityConflict() {
        admin().body(Map.of("type", "adr", "id", ADR, "tag_id", "taken-name")).when().post("/lore/tag/apply")
            .then().statusCode(200).body("ok", equalTo(true));
        admin().body(Map.of("from", "security-review", "to", "taken-name")).when().post("/lore/tag/rename")
            .then().statusCode(409)
            .body("error", equalTo("IDENTITY_CONFLICT"))
            .body("legacy_code", equalTo("TAG_TAKEN"));
    }

    @Test
    @Order(4)
    void unknownTagRenamesTo404() {
        admin().body(Map.of("from", "no-such-tag", "to", "never")).when().post("/lore/tag/rename")
            .then().statusCode(404).body("error", equalTo("NOT_FOUND"));
    }
}
