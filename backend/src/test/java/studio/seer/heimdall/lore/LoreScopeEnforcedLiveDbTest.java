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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-95, кейсы 1/2/3/5: проектный read-скоуп при ВКЛЮЧЁННОМ
 * {@code lore.scope.enforce} — через реальный HTTP-запрос к слайсу.
 *
 * <p>{@code LoreSliceProjectScopeTest} проверяет компоновку SQL, а
 * {@code AgentFleetLiveDbTest} — резолвер по агентам. Здесь проверяется то,
 * что между ними: доходит ли множество разрешённых проектов от токена до
 * фактической выдачи. Ошибка ровно в этом месте — «фильтр посчитан, но не
 * применён» — не видна ни одним из соседних тестов.
 *
 * <p>Профиль {@link ScopeEnforcedProfile} включает флаг: на проде он снят по
 * умолчанию, и без него тест проверял бы поведение, которого в целевой
 * конфигурации не будет.
 */
@QuarkusTest
@TestProfile(ScopeEnforcedProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreScopeEnforcedLiveDbTest {

    /** Три проекта: два видны viewer'у, третий — нет. Это и есть «N из M». */
    private static final String P_ALPHA = "LORE_TEST_ORG/al95-scope-alpha";
    private static final String P_BETA = "LORE_TEST_ORG/al95-scope-beta";
    private static final String P_HIDDEN = "LORE_TEST_ORG/al95-scope-hidden";

    private static final String VIEWER_SUB = "al95-scope-viewer-sub";

    private static final String S_ALPHA = "SPRINT_AL95_ALPHA";
    private static final String S_HIDDEN = "SPRINT_AL95_HIDDEN";
    /** Спринт на ПЕРЕСЕЧЕНИИ: рёбра и в alpha, и в hidden. */
    private static final String S_BOTH = "SPRINT_AL95_BOTH";

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_ALPHA, P_BETA, P_HIDDEN)) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }

        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + VIEWER_SUB + "\",\"display_name\":\"AL-95 Viewer\"}")
        .when().post("/lore/user").then().statusCode(200);
        // Роль в ДВУХ проектах из трёх. Роль намеренно узкая (reader): для
        // видимости роль не важна — важен сам факт ребра (решение AL-93).
        for (String slug : List.of(P_ALPHA, P_BETA)) {
            given().header("X-Seer-Role", "admin").contentType("application/json")
                .body("{\"kc_sub\":\"" + VIEWER_SUB + "\",\"project\":\"" + slug + "\",\"role\":\"reader\"}")
            .when().post("/lore/user/role").then().statusCode(200);
        }

        createSprint(S_ALPHA, "AL-95 alpha", List.of(P_ALPHA));
        createSprint(S_HIDDEN, "AL-95 hidden", List.of(P_HIDDEN));
        createSprint(S_BOTH, "AL-95 both", List.of(P_ALPHA, P_HIDDEN));
    }

    private void createSprint(String id, String name, List<String> projects) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"sprint_id\":\"" + id + "\",\"name\":\"" + name + "\"}")
        .when().post("/lore/sprint/create").then().statusCode(200);
        // Привязка отдельным вызовом на каждый проект: у одного спринта их
        // может быть несколько, и именно мультипривязка проверяется кейсом 3.
        for (String slug : projects) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"sprint_id\":\"" + id + "\",\"git_project\":\"" + slug + "\",\"action\":\"add\"}")
            .when().post("/lore/sprint/project").then().statusCode(200);
        }
    }

    /** Идентификаторы спринтов в выдаче слайса {@code sprints} без параметров. */
    private List<String> sprintIds() {
        return given().contentType("application/json")
            .when().get("/lore/slice/sprints")
            .then().statusCode(200)
            .extract().jsonPath().getList("rows.sprint_id", String.class);
    }

    // ── Кейс 1: viewer видит N из M ─────────────────────────────────────────

    @Test
    @Order(2)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void viewerSeesOnlyProjectsWithARole() {
        var ids = sprintIds();
        assertTrue(ids.contains(S_ALPHA), "спринт своего проекта обязан быть виден");
        assertFalse(ids.contains(S_HIDDEN),
            "спринт проекта без роли виден при включённом скоупе — фильтр не применён");
    }

    // ── Кейс 3: пересечение — достаточно ОДНОГО разрешённого проекта ────────

    @Test
    @Order(3)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void entityInTwoProjectsIsVisibleWhenAnyOneIsAllowed() {
        // S_BOTH висит и в alpha (разрешён), и в hidden (запрещён). Правило —
        // «виден при любом разрешённом», а не «при всех разрешённых»: иначе
        // общая сущность пропадала бы у всех, кто не состоит во всех её
        // проектах сразу, — то есть почти у всех.
        assertTrue(sprintIds().contains(S_BOTH),
            "сущность на пересечении должна быть видна по ЛЮБОМУ разрешённому проекту");
    }

    // ── Кейс 2: superadmin обходит скоуп ────────────────────────────────────

    @Test
    @Order(4)
    // Роль реалма называется "super-admin" через дефис — именно её ищет
    // SeerRoleFromTokenFilter, чтобы выставить X-Seer-Role: superadmin.
    // Первая редакция теста написала "superadmin", фильтр не узнал роль и
    // выдал viewer: superadmin увидел ровно ничего. Тест поймал не дефект
    // кода, а собственную опечатку — но ровно ту, которая в конфигурации
    // реалма стоила бы владельцу доступа ко всему корпусу.
    @TestSecurity(user = "al95-root", roles = {"super-admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "al95-root-sub-without-any-role"))
    void superadminSeesEverythingIncludingProjectsWithoutARole() {
        // Важно, что у этого sub НЕТ ни одной проектной роли: обход идёт по
        // роли реалма, а не потому, что ролей случайно оказалось много.
        var ids = sprintIds();
        assertTrue(ids.contains(S_ALPHA));
        assertTrue(ids.contains(S_HIDDEN), "superadmin обязан видеть проекты, где у него нет роли");
    }

    // ── Кейс 5: auth выключен — поведение superadmin ────────────────────────

    @Test
    @Order(5)
    void authOffBehavesAsSuperadmin() {
        // Ни @TestSecurity, ни JWT: SecurityIdentity без JsonWebToken —
        // ровно то, что видит бэкенд в dev-режиме с выключенным OIDC.
        // Решение владельца: «auth off = superadmin» — иначе разработчик,
        // подняв стенд локально, увидел бы пустой LORE и решил, что данных нет.
        var ids = sprintIds();
        assertTrue(ids.contains(S_ALPHA));
        assertTrue(ids.contains(S_HIDDEN), "при выключенном auth скоуп не применяется");
    }

    // ── Регресс: человек без единой роли видит пусто, а не всё ──────────────

    @Test
    @Order(6)
    @TestSecurity(user = "al95-nobody", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "al95-nobody-sub"))
    void userWithoutAnyRoleSeesNothing() {
        // Fail-closed: пустое множество разрешённых проектов даёт заведомо
        // ложное условие, а не отсутствие фильтра (LoreSliceProjectScopeTest
        // проверяет это на уровне SQL — здесь на уровне выдачи).
        var ids = sprintIds();
        assertFalse(ids.contains(S_ALPHA));
        assertFalse(ids.contains(S_HIDDEN));
        assertFalse(ids.contains(S_BOTH));
    }
}
