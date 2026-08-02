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
import java.util.Set;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AL-95: парк агентов целиком — по одному агенту на каждую роль справочника
 * {@code agent_role}, на живом графе.
 *
 * <p>Повторяет то, что 2026-08-02 заведено в проде: один владелец, семь
 * агентов, по агенту на роль. {@link ProjectRbacServiceLiveDbTest} проверяет
 * механизм на двух ролях (owner и architect) — здесь проверяется, что он
 * ведёт себя одинаково для ВСЕХ семи и что обе оси расходятся именно там,
 * где решено: <b>видимость — по проектам владельца, право менять — по
 * роли</b> (решение владельца 2026-08-01).
 *
 * <p>Два владельца с разными ролями в проекте — существенная часть фикстуры.
 * Пока владелец один и он {@code owner}, матрица D4 пропускает всё, и тест
 * «все семь пишут» ничего не доказывает: он был бы зелёным и при полностью
 * снятом сужении. Второй владелец с ролью {@code developer} даёт настоящее
 * различение — из тех же семи агентов писать вправе только два.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class AgentFleetLiveDbTest {

    @Inject
    ProjectRbacService rbac;

    /** Отдельная инъекция: поле внутри {@code rbac} — на CDI-прокси, там null. */
    @Inject
    LoreIngestService ingest;

    private static final String PROJECT = "LORE_TEST_ORG/al95-fleet-repo";
    private static final String OTHER_PROJECT = "LORE_TEST_ORG/al95-foreign-repo";

    /** Роли справочника agent_role — ровно те, под которые заведены агенты. */
    private static final List<String> ROLES =
        List.of("full", "architect", "developer", "tester", "pm", "analyst", "marketer");

    /** Владелец с ролью owner в проекте: делегирует любой профиль. */
    private static final String BOSS_SUB = "al95-boss-sub";
    /** Владелец с ролью developer: делегирует только developer и tester. */
    private static final String DEV_SUB = "al95-dev-sub";

    private static String actorOf(String ownerTag, String role) { return "al95-" + ownerTag + "-" + role; }
    private static String clientOf(String ownerTag, String role) { return "lore-mcp-al95-" + ownerTag + "-" + role; }

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(PROJECT, OTHER_PROJECT)) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }

        createUserWithRole(BOSS_SUB, "AL-95 Boss", "owner");
        createUserWithRole(DEV_SUB, "AL-95 Dev", "developer");

        // Оба владельца получают полный парк: по агенту на каждую роль.
        // Именно так это выглядит в проде — один человек держит семь агентов.
        for (String role : ROLES) {
            createAgent("boss", role, BOSS_SUB);
            createAgent("dev", role, DEV_SUB);
        }
    }

    private void createUserWithRole(String kcSub, String displayName, String role) {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + kcSub + "\",\"display_name\":\"" + displayName + "\"}")
        .when().post("/lore/user").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + kcSub + "\",\"project\":\"" + PROJECT + "\",\"role\":\"" + role + "\"}")
        .when().post("/lore/user/role").then().statusCode(200);
    }

    private void createAgent(String ownerTag, String role, String ownerSub) {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + actorOf(ownerTag, role) + "\",\"name\":\"AL-95 " + ownerTag + " " + role
                + "\",\"kind\":\"agent\"}")
        .when().post("/lore/actor").then().statusCode(200);
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"actor_id\":\"" + actorOf(ownerTag, role) + "\",\"client_id\":\"" + clientOf(ownerTag, role)
                + "\",\"kc_sub\":\"" + ownerSub + "\",\"agent_role\":\"" + role + "\"}")
        .when().post("/lore/actor/owner").then().statusCode(200);
    }

    // ── Ось чтения: одинакова для всех семи ролей ────────────────────────────

    @Test
    @Order(2)
    void everyAgentSeesExactlyItsOwnersProjects() {
        Set<String> bossProjects = rbac.allowedProjectsForUser(BOSS_SUB);
        Set<String> devProjects = rbac.allowedProjectsForUser(DEV_SUB);
        assertTrue(bossProjects.contains(PROJECT), "фикстура сломана: у boss нет роли в проекте");

        for (String role : ROLES) {
            assertEquals(bossProjects, rbac.visibleProjectsForAgent(clientOf("boss", role)),
                "агент " + role + " видит не то же, что его владелец — чтение сужается только проектом");
            assertEquals(devProjects, rbac.visibleProjectsForAgent(clientOf("dev", role)),
                "агент " + role + " видит не то же, что его владелец-developer");
        }
    }

    @Test
    @Order(3)
    void narrowRoleDoesNotNarrowVisibility() {
        // Ключевое расхождение осей: у владельца-developer из семи агентов
        // писать вправе двое, а ВИДЕТЬ проект обязаны все семеро — иначе
        // участник проекта не знает артефактов собственного проекта.
        for (String role : ROLES) {
            assertTrue(rbac.visibleProjectsForAgent(clientOf("dev", role)).contains(PROJECT),
                "агент " + role + " владельца-developer не видит проект владельца");
        }
    }

    @Test
    @Order(4)
    void noAgentSeesAProjectItsOwnerHasNoRoleIn() {
        // OTHER_PROJECT существует, но ролей туда не выдавалось никому.
        for (String role : ROLES) {
            assertFalse(rbac.visibleProjectsForAgent(clientOf("boss", role)).contains(OTHER_PROJECT),
                "агент " + role + " видит чужой проект — видимость перестала упираться в рёбра владельца");
            assertFalse(rbac.visibleProjectsForAgent(clientOf("dev", role)).contains(OTHER_PROJECT));
        }
    }

    // ── Ось записи: сужается ролью владельца, по-разному для каждой ──────────

    @Test
    @Order(5)
    void ownerDelegatesEveryProfileInHisProject() {
        for (String role : ROLES) {
            assertTrue(rbac.agentAllowedInProject(clientOf("boss", role), PROJECT, role),
                "владелец-owner обязан делегировать профиль " + role);
            assertTrue(rbac.allowedProjectsForAgent(clientOf("boss", role), role).contains(PROJECT));
        }
    }

    @Test
    @Order(6)
    void developerOwnerDelegatesOnlyDeveloperAndTester() {
        Set<String> writable = Set.of("developer", "tester");
        for (String role : ROLES) {
            boolean allowed = rbac.agentAllowedInProject(clientOf("dev", role), PROJECT, role);
            assertEquals(writable.contains(role), allowed,
                "агент " + role + " у владельца-developer: право записи разошлось с матрицей D4");
            assertEquals(writable.contains(role),
                rbac.allowedProjectsForAgent(clientOf("dev", role), role).contains(PROJECT),
                "список проектов на запись для " + role + " разошёлся с поштучной проверкой");
        }
    }

    @Test
    @Order(7)
    void verdictDependsOnOwnerRoleAndPresentedProfileOnly() {
        // Поле agent_role на вершине — ОПИСАНИЕ для экрана, а не точка
        // контроля: решение принимается по роли владельца и по профилю,
        // присланному вызовом. Проверяем это прямо, чтобы никто не начал
        // считать поле в графе защитой.
        //
        // Ограничитель, ради которого так можно: профиль приходит клеймом
        // agent_scope из токена Keycloak и привязан к клиенту, а не к телу
        // запроса — подставить чужой профиль агент не может (см.
        // AgentScopeAxisSeparationTest).
        assertTrue(rbac.agentAllowedInProject(clientOf("dev", "marketer"), PROJECT, "developer"),
            "вердикт обязан зависеть от роли владельца и профиля вызова, а не от записи в вершине агента");
        assertFalse(rbac.agentAllowedInProject(clientOf("dev", "developer"), PROJECT, "marketer"),
            "тот же агент с профилем marketer — отказ: владелец-developer его не делегирует");

        // Потолок задаёт владелец: full не проходит ни у одного из семи
        // агентов владельца-developer и проходит у любого агента owner'а.
        for (String role : ROLES) {
            assertFalse(rbac.agentAllowedInProject(clientOf("dev", role), PROJECT, "full"),
                "агент " + role + " прошёл как full — сужение по владельцу не работает");
            assertTrue(rbac.agentAllowedInProject(clientOf("boss", role), PROJECT, "full"),
                "у владельца-owner любой профиль допустим — иначе потолок задаёт не роль владельца");
        }
    }

    @Test
    @Order(8)
    void agentRoleIsStoredOnTheActorAndVisibleInTheAdminSlice() {
        // V21: колонка agent_role на KnowActor. Экран администрирования читает
        // её слайсом agent_owners — без неё в UI все агенты выглядят одинаково.
        for (String role : ROLES) {
            var rows = ingest.queryPublic(
                "SELECT agent_role FROM KnowActor WHERE actor_id = :id",
                java.util.Map.of("id", actorOf("boss", role)));
            assertEquals(1, rows.size(), "агент " + role + " не заведён");
            assertEquals(role, String.valueOf(rows.get(0).get("agent_role")),
                "agent_role агента " + role + " не сохранился — экран агентов покажет «роль не задана»");
        }
    }
}
