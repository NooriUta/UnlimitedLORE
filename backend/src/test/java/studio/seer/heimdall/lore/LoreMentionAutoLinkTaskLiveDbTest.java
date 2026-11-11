package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-AUTOLINK — задачи (слова владелицы 11.11: «компоненты
 * привязываются и к задаче»). Упоминание {@code [[component:X]]} в заметке задачи ставит
 * TAGGED_WITH задача → компонент: при task_new, task_set (note_md / note_append, одиночно и
 * пакетом); дописка разбирает только добавленный текст; бэкфилл учитывает задачи.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreMentionAutoLinkTaskLiveDbTest {

    private static final String SPRINT = "SPRINT_MA_TASK";
    private static final String UID = SPRINT + "/MA-T1";

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    @Test
    @Order(1)
    void setUp() {
        for (String c : new String[] {"COMP-MAT-A", "COMP-MAT-B", "COMP-MAT-C"})
            admin().body("{\"component_id\":\"" + c + "\",\"full_name\":\"автосвязь задачи\"}")
                .when().post("/lore/component/create").then().statusCode(200);
        admin().body("{\"sprint_id\":\"" + SPRINT + "\",\"name\":\"автосвязь задачи\"}")
            .when().post("/lore/sprint/create").then().statusCode(200);
    }

    @Test
    @Order(2)
    void taskNewMentioningComponentGetsTaggedWith() {
        admin().body(JsonObject.of("sprint_id", SPRINT, "task_id", "MA-T1", "title", "автосвязь",
                "note_md", "Про [[component:COMP-MAT-A]] и битая [[component:COMP-MAT-NONE]]").encode())
        .when().post("/lore/task")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("task_uid", equalTo(UID))
            .body("mentions.added", hasSize(1))
            .body("mentions.added[0].edge_type", equalTo("TAGGED_WITH"))
            .body("mentions.added[0].from_id", equalTo(UID))
            .body("mentions.added[0].to_id", equalTo("COMP-MAT-A"))
            .body("mentions.added[0].origin", equalTo("mention-auto"))
            .body("mentions.skipped.reason", hasItem("not_found"));
    }

    @Test
    @Order(3)
    void noteAppendParsesOnlyAppendedText() {
        admin().body(JsonObject.of("task_uid", UID, "title", "автосвязь",
                "note_append", "дописка про [[component:COMP-MAT-B]]").encode())
        .when().post("/lore/task/edit")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("note_mode", equalTo("appended"))
            .body("mentions.added", hasSize(1))
            .body("mentions.added[0].to_id", equalTo("COMP-MAT-B"))
            // COMP-MAT-A из прежней части заметки заново не разбирается
            .body("mentions.unchanged", hasSize(0));
    }

    @Test
    @Order(4)
    void batchNoteMdLinksAndRepeatIsUnchanged() {
        JsonArray batch = JsonArray.of(JsonObject.of("task_uid", UID, "title", "автосвязь",
            "note_md", "[[component:COMP-MAT-A]] и [[component:COMP-MAT-C]]"));
        admin().body(batch.encode())
        .when().post("/lore/task/edit/batch")
        .then().statusCode(200)
            .body("ok", equalTo(true))
            .body("updated", equalTo(1))
            .body("mentions.'" + UID + "'.added.to_id", hasItem("COMP-MAT-C"))
            .body("mentions.'" + UID + "'.unchanged.to_id", hasItem("COMP-MAT-A"));
    }

    @Test
    @Order(5)
    void backfillCoversTasks() {
        given().header("X-Seer-Role", "admin")
        .when().get("/lore/link/mentions/backfill?dry_run=true&types=task")
        .then().statusCode(200)
            .body("dry_run", equalTo(true))
            .body("by_type.task", notNullValue())
            .body("totals.unchanged", org.hamcrest.Matchers.greaterThanOrEqualTo(1));
    }
}
