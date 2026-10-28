package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Исходы оставшихся путей записи (ADR-LORE-043, DBR-17): компонент, справочник,
 * проект, пользователь и роль, продуктовая ось.
 *
 * <p>Общий дефект у всех: ответ описывал выполненные команды, а не случившееся.
 * UPDATE по несуществующему id давал {@code ok:true}, CREATE EDGE по пустой
 * выборке — тоже, повтор плодил дубль ребра или лишнюю ревизию истории, а
 * журнал ролей фиксировал выдачу, которой не было.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreRestWriteOutcomeLiveDbTest {

    private static final String PARENT_A = "DBR17_OUT_PARENT_A";
    private static final String PARENT_B = "DBR17_OUT_PARENT_B";
    private static final String CHILD    = "DBR17_OUT_CHILD";
    private static final String PROJECT  = "LORE_TEST_ORG/dbr17-outcome-repo";
    private static final String SUB      = "dbr17-outcome-sub";
    private static final String PRODUCT  = "DBR17_OUT_PRODUCT";

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification as(String role) {
        return given().header("X-Seer-Role", role).contentType("application/json");
    }

    private long count(String sql, Map<String, Object> p) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, p);
        return rows.isEmpty() ? 0 : ((Number) rows.get(0).getOrDefault("n", 0)).longValue();
    }

    private long parentEdges(String cid) {
        return count("SELECT count(*) AS n FROM PARENT_OF WHERE @out.component_id=:c", Map.of("c", cid));
    }

    // ── компонент ──────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void updateOfMissingComponentIsRefused() {
        as("admin").body(Map.of("component_id", "DBR17_НЕТ_ТАКОГО", "owner", "x"))
            .when().post("/lore/component/update")
            .then().statusCode(404).body("error", equalTo("TARGET_NOT_FOUND"));
    }

    @Test
    @Order(2)
    void createWithMissingParentIsRefusedAndNotWritten() {
        as("admin").body(Map.of("component_id", "DBR17_OUT_ORPHAN", "parent_id", "DBR17_НЕТ_РОДИТЕЛЯ"))
            .when().post("/lore/component/create")
            .then().statusCode(404).body("error", equalTo("TARGET_NOT_FOUND"));
        assertEquals(0, count("SELECT count(*) AS n FROM LoreComponent WHERE component_id=:c",
            Map.of("c", "DBR17_OUT_ORPHAN")));
    }

    @Test
    @Order(3)
    void createThenRepeatKeepsOneParentEdge() {
        for (String p : List.of(PARENT_A, PARENT_B))
            as("admin").body(Map.of("component_id", p)).when().post("/lore/component/create")
                .then().statusCode(200);
        as("admin").body(Map.of("component_id", CHILD, "parent_id", PARENT_A))
            .when().post("/lore/component/create")
            .then().statusCode(200).body("outcome", equalTo("created"));
        as("admin").body(Map.of("component_id", CHILD, "parent_id", PARENT_A))
            .when().post("/lore/component/create")
            .then().statusCode(200).body("outcome", equalTo("updated"));
        assertEquals(1, parentEdges(CHILD), "повтор create не должен плодить PARENT_OF");
    }

    @Test
    @Order(4)
    void linkParentRepeatIsUnchangedAndSwitchKeepsOneParent() {
        as("admin").body(Map.of("component_id", CHILD, "parent_id", PARENT_A))
            .when().post("/lore/component/link-parent")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
        as("admin").body(Map.of("component_id", CHILD, "parent_id", PARENT_B))
            .when().post("/lore/component/link-parent")
            .then().statusCode(200).body("outcome", equalTo("updated"));
        assertEquals(1, parentEdges(CHILD), "смена родителя оставила прежнего");
        as("admin").body(Map.of("component_id", CHILD, "parent_id", "DBR17_НЕТ_РОДИТЕЛЯ"))
            .when().post("/lore/component/link-parent")
            .then().statusCode(404);
        assertEquals(1, parentEdges(CHILD));
    }

    @Test
    @Order(5)
    void deleteThenRepeatIsUnchanged() {
        as("admin").body(Map.of("component_id", CHILD)).when().post("/lore/component/delete")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        as("admin").body(Map.of("component_id", CHILD)).when().post("/lore/component/delete")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    // ── справочник ─────────────────────────────────────────────────────────

    @Test
    @Order(10)
    void dictCreatedUnchangedUpdatedWithoutExtraHistory() {
        Map<String, Object> e = Map.of("dict_type", "product", "code", PRODUCT, "label_ru", "Проба DBR-17");
        as("admin").body(e).when().post("/lore/dict/entry")
            .then().statusCode(200).body("outcome", equalTo("created"));
        long hist = count("SELECT count(*) AS n FROM KnowDictEntryHist WHERE dict_type='product' AND code=:c",
            Map.of("c", PRODUCT));
        as("admin").body(e).when().post("/lore/dict/entry")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
        assertEquals(hist, count("SELECT count(*) AS n FROM KnowDictEntryHist WHERE dict_type='product' AND code=:c",
            Map.of("c", PRODUCT)), "повтор без изменений не должен открывать ревизию");
        as("admin").body(Map.of("dict_type", "product", "code", PRODUCT, "label_ru", "Проба DBR-17 (2)"))
            .when().post("/lore/dict/entry")
            .then().statusCode(200).body("outcome", equalTo("updated"));
    }

    // ── проект, пользователь, роль ─────────────────────────────────────────

    @Test
    @Order(20)
    void projectCreatedThenUpdated() {
        as("superadmin").body(Map.of("slug", PROJECT)).when().post("/lore/project")
            .then().statusCode(200).body("outcome", equalTo("created"));
        as("superadmin").body(Map.of("slug", PROJECT, "name", "проба")).when().post("/lore/project")
            .then().statusCode(200).body("outcome", equalTo("updated"));
    }

    @Test
    @Order(21)
    void userCreatedThenUnchanged() {
        as("admin").body(Map.of("kc_sub", SUB, "display_name", "DBR17")).when().post("/lore/user")
            .then().statusCode(200).body("outcome", equalTo("created"));
        as("admin").body(Map.of("kc_sub", SUB, "display_name", "DBR17")).when().post("/lore/user")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    @Test
    @Order(22)
    void roleOnMissingProjectIsRefusedAndNotJournaled() {
        as("admin").body(Map.of("kc_sub", SUB, "project", "LORE_TEST_ORG/dbr17-no-such", "role", "reader"))
            .when().post("/lore/user/role")
            .then().statusCode(404).body("error", equalTo("TARGET_NOT_FOUND"));
        assertEquals(0, count("SELECT count(*) AS n FROM KnowProjectRoleEvent WHERE project=:p",
            Map.of("p", "LORE_TEST_ORG/dbr17-no-such")));
    }

    @Test
    @Order(23)
    void roleGrantRepeatChangeAndRemove() {
        Map<String, Object> grant = Map.of("kc_sub", SUB, "project", PROJECT, "role", "reader");
        as("admin").body(grant).when().post("/lore/user/role")
            .then().statusCode(200).body("outcome", equalTo("created"));
        long events = count("SELECT count(*) AS n FROM KnowProjectRoleEvent WHERE project=:p AND kc_sub=:s",
            Map.of("p", PROJECT, "s", SUB));
        as("admin").body(grant).when().post("/lore/user/role")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
        assertEquals(events, count("SELECT count(*) AS n FROM KnowProjectRoleEvent WHERE project=:p AND kc_sub=:s",
            Map.of("p", PROJECT, "s", SUB)), "повтор той же роли не должен писать событие");
        as("admin").body(Map.of("kc_sub", SUB, "project", PROJECT, "role", "tester"))
            .when().post("/lore/user/role")
            .then().statusCode(200).body("outcome", equalTo("updated"));
        // Чтобы снятие не упёрлось в «последний owner»: у пробного проекта
        // владельца нет вовсе, а снимаемая роль — не owner.
        as("admin").body(Map.of("kc_sub", SUB, "project", PROJECT, "action", "remove"))
            .when().post("/lore/user/role")
            .then().statusCode(200).body("outcome", equalTo("deleted")).body("removed", equalTo(true));
        as("admin").body(Map.of("kc_sub", SUB, "project", PROJECT, "action", "remove"))
            .when().post("/lore/user/role")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }

    // ── продуктовая ось ────────────────────────────────────────────────────

    @Test
    @Order(30)
    void productComponentLinkRepeatRoleChangeAndRemove() {
        as("admin").body(Map.of("component_id", PARENT_A)).when().post("/lore/component/create")
            .then().statusCode(200);
        Map<String, Object> link = Map.of("product_code", PRODUCT, "rel", "component",
            "target_id", PARENT_A, "role", "owner");
        as("admin").body(link).when().post("/lore/product/link")
            .then().statusCode(200).body("outcome", equalTo("created"));
        as("admin").body(link).when().post("/lore/product/link")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
        // Неверная роль на add больше не снимает существующую связь.
        as("admin").body(Map.of("product_code", PRODUCT, "rel", "component",
                "target_id", PARENT_A, "role", "no-such-role"))
            .when().post("/lore/product/link").then().statusCode(400);
        long edges = count("SELECT count(*) AS n FROM IN_PRODUCT WHERE @out.component_id=:c AND @in.code=:p",
            Map.of("c", PARENT_A, "p", PRODUCT));
        assertEquals(1, edges, "отклонённый вызов снял связь");
        Map<String, Object> remove = Map.of("product_code", PRODUCT, "rel", "component",
            "target_id", PARENT_A, "action", "remove");
        as("admin").body(remove).when().post("/lore/product/link")
            .then().statusCode(200).body("outcome", equalTo("deleted"));
        as("admin").body(remove).when().post("/lore/product/link")
            .then().statusCode(200).body("outcome", equalTo("unchanged"));
    }
}
