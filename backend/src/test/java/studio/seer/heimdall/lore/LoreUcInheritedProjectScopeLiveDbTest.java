package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.security.TestSecurity;
import io.quarkus.test.security.jwt.Claim;
import io.quarkus.test.security.jwt.JwtSecurity;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.util.List;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S1_HONEST_API/S1-08: срез {@code use_cases_of_feature} отдавал 0
 * сценариев у FEAT-VP-FIT при {@code uc_total = 5} у того же корня в {@code features}.
 *
 * <p>Причина (замер на проде 07.11.2026): дочерние сценарии своего ребра
 * BELONGS_TO_PROJECT не несут — проект у них НАСЛЕДУЕТСЯ от корня (так задумано,
 * см. {@code inherited_projects} в самом срезе). А read-скоуп
 * {@link LoreSlices#PROJECT_SCOPED} проверял только собственное ребро — и
 * при включённом скоупе отсекал всех детей. {@code features} режется по корню,
 * у которого ребро есть, поэтому счётчик показывал 5, а список — пусто.
 *
 * <p>У сценариев ниже НЕТ своего ребра проекта — намеренно: с ним тест прошёл бы
 * и на скоупе «только прямая связь».
 */
@QuarkusTest
@TestProfile(ScopeEnforcedProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreUcInheritedProjectScopeLiveDbTest {

    private static final String P_ALPHA = "LORE_TEST_ORG/s108-uc-alpha";
    private static final String P_HIDDEN = "LORE_TEST_ORG/s108-uc-hidden";
    private static final String VIEWER_SUB = "s108-uc-viewer-sub";

    private static final String COMP = "S108-COMP";
    private static final String FEAT_ALPHA = "FEAT-S108-ALPHA";
    private static final String FEAT_HIDDEN = "FEAT-S108-HIDDEN";
    /** Ребёнок корня — проект только через родителя. */
    private static final String UC_ALPHA = "UC-S108-ALPHA-1";
    private static final String UC_ALPHA_2 = "UC-S108-ALPHA-2";
    /** Внук корня (subfunction под sea-level) — проект через два уровня. */
    private static final String UC_ALPHA_SUB = "UC-S108-ALPHA-1-SUB";
    private static final String UC_HIDDEN = "UC-S108-HIDDEN-1";

    private static void admin(String path, String body) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json").body(body)
            .when().post(path).then().statusCode(200);
    }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_ALPHA, P_HIDDEN)) {
            admin("/lore/project", "{\"slug\":\"" + slug + "\"}");
        }
        admin("/lore/user", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"display_name\":\"S1-08 Viewer\"}");
        admin("/lore/user/role", "{\"kc_sub\":\"" + VIEWER_SUB + "\",\"project\":\"" + P_ALPHA
            + "\",\"role\":\"reader\"}");
        admin("/lore/component/create", "{\"component_id\":\"" + COMP + "\",\"full_name\":\"S1-08\",\"area\":\"core\"}");

        admin("/lore/feature", "{\"feature_id\":\"" + FEAT_ALPHA + "\",\"title\":\"корень alpha\",\"goal_level\":\"kite\"}");
        admin("/lore/uc/link", "{\"uc_id\":\"" + FEAT_ALPHA + "\",\"rel\":\"project\",\"target_id\":\"" + P_ALPHA + "\"}");
        admin("/lore/feature", "{\"feature_id\":\"" + FEAT_HIDDEN + "\",\"title\":\"корень hidden\",\"goal_level\":\"kite\"}");
        admin("/lore/uc/link", "{\"uc_id\":\"" + FEAT_HIDDEN + "\",\"rel\":\"project\",\"target_id\":\"" + P_HIDDEN + "\"}");

        admin("/lore/uc", "{\"uc_id\":\"" + UC_ALPHA + "\",\"title\":\"ребёнок alpha\",\"parent_uc_id\":\""
            + FEAT_ALPHA + "\",\"goal_level\":\"sea-level\"}");
        admin("/lore/uc", "{\"uc_id\":\"" + UC_ALPHA_2 + "\",\"title\":\"ребёнок alpha 2\",\"parent_uc_id\":\""
            + FEAT_ALPHA + "\",\"goal_level\":\"sea-level\"}");
        admin("/lore/uc", "{\"uc_id\":\"" + UC_ALPHA_SUB + "\",\"title\":\"внук alpha\",\"parent_uc_id\":\""
            + UC_ALPHA + "\",\"goal_level\":\"subfunction\"}");
        admin("/lore/uc", "{\"uc_id\":\"" + UC_HIDDEN + "\",\"title\":\"ребёнок hidden\",\"parent_uc_id\":\""
            + FEAT_HIDDEN + "\",\"goal_level\":\"sea-level\"}");
        // Компонент — своим ребром у ребёнка: срез компонента режется тем же скоупом.
        admin("/lore/uc/link", "{\"uc_id\":\"" + UC_ALPHA + "\",\"rel\":\"component\",\"target_id\":\"" + COMP + "\"}");
        admin("/lore/uc/link", "{\"uc_id\":\"" + UC_HIDDEN + "\",\"rel\":\"component\",\"target_id\":\"" + COMP + "\"}");
    }

    private static List<String> ucIds(String sliceAndQuery) {
        return given().contentType("application/json")
            .when().get("/lore/slice/" + sliceAndQuery)
            .then().statusCode(200)
            .extract().jsonPath().getList("rows.uc_id", String.class);
    }

    /** Ядро бага: счётчик корня и список его сценариев обязаны сходиться. */
    @Test
    @Order(2)
    @TestSecurity(user = "s108-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void childrenOfOwnRootAreListedAndMatchUcTotal() {
        var rows = given().contentType("application/json")
            .when().get("/lore/slice/features")
            .then().statusCode(200)
            .extract().jsonPath();
        Integer total = rows.getInt("rows.find { it.uc_id == '" + FEAT_ALPHA + "' }.uc_total");
        assertEquals(2, total, "положительный контроль: корень виден и считает двух детей");

        var children = ucIds("use_cases_of_feature?id=" + FEAT_ALPHA);
        assertEquals(List.of(UC_ALPHA, UC_ALPHA_2), children,
            "сценарии без своего ребра проекта отсечены скоупом — проект наследуется от корня (S1-08)");
    }

    @Test
    @Order(3)
    @TestSecurity(user = "s108-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void childrenOfForeignRootStayHidden() {
        assertTrue(ucIds("use_cases_of_feature?id=" + FEAT_HIDDEN).isEmpty(),
            "сценарии корня чужого проекта видны — наследование пропускает лишнее");
    }

    /** То же правило в соседних срезах по сценариям: паспорт и компонент. */
    @Test
    @Order(4)
    @TestSecurity(user = "s108-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void ucPassportAndComponentFollowTheSameRule() {
        assertEquals(List.of(UC_ALPHA), ucIds("uc_by_id?id=" + UC_ALPHA), "паспорт ребёнка своего корня");
        assertEquals(List.of(UC_ALPHA_SUB), ucIds("uc_by_id?id=" + UC_ALPHA_SUB),
            "паспорт внука: проект наследуется через два уровня");
        assertTrue(ucIds("uc_by_id?id=" + UC_HIDDEN).isEmpty(), "паспорт ребёнка чужого корня раскрыт");

        var comp = ucIds("use_cases_of_component?component=" + COMP);
        assertTrue(comp.contains(UC_ALPHA), "сценарий своего корня пропал из среза компонента");
        assertFalse(comp.contains(UC_HIDDEN), "сценарий чужого корня виден в срезе компонента");
    }

    /** Положительный контроль: обе стороны в базе есть — «не видно» не значит «не завелось». */
    @Test
    @Order(5)
    @TestSecurity(user = "s108-root", roles = {"super-admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "s108-root-sub"))
    void superadminSeesBothSides() {
        assertEquals(List.of(UC_HIDDEN), ucIds("use_cases_of_feature?id=" + FEAT_HIDDEN));
        assertEquals(List.of(UC_ALPHA, UC_ALPHA_2), ucIds("use_cases_of_feature?id=" + FEAT_ALPHA));
    }
}
