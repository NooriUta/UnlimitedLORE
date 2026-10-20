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

    // Спеки, доки и ранбуки — три типа, названные владелицей отдельно
    // («не показывать specs docs runbooks тем, у кого нет роли»). До этого
    // они числились в PROJECT_SCOPED, но ни одним тестом не проверялись.
    private static final String SPEC_ALPHA = "SPEC-AL95-ALPHA";
    private static final String SPEC_HIDDEN = "SPEC-AL95-HIDDEN";
    private static final String DOC_ALPHA = "al95_doc_alpha";
    private static final String DOC_HIDDEN = "al95_doc_hidden";
    private static final String RB_ALPHA = "RUNBOOK-AL95-ALPHA";
    private static final String RB_HIDDEN = "RUNBOOK-AL95-HIDDEN";

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

        // Спека, док и ранбук — по паре на каждый тип: свой проект и чужой.
        // Три типа заведены ЯВНО, а не «по аналогии со спринтом»: у каждого
        // свой путь привязки проекта (spec/link rel=project, doc/project,
        // runbook/project), и ошибка в любом из них даёт ту же картину, что
        // верная работа, — записи просто не видно.
        createSpec(SPEC_ALPHA, P_ALPHA);
        createSpec(SPEC_HIDDEN, P_HIDDEN);
        createDoc(DOC_ALPHA, P_ALPHA);
        createDoc(DOC_HIDDEN, P_HIDDEN);
        createRunbook(RB_ALPHA, P_ALPHA);
        createRunbook(RB_HIDDEN, P_HIDDEN);
    }

    private void createSpec(String id, String project) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"spec_id\":\"" + id + "\",\"title\":\"AL-95 " + id + "\"}")
        .when().post("/lore/spec").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"spec_id\":\"" + id + "\",\"rel\":\"project\",\"target_id\":\"" + project
                + "\",\"mode\":\"add\"}")
        .when().post("/lore/spec/link").then().statusCode(200);
    }

    private void createDoc(String id, String project) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"doc_id\":\"" + id + "\",\"title\":\"AL-95 " + id + "\",\"kind\":\"reference\"}")
        .when().post("/lore/doc").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"doc_id\":\"" + id + "\",\"project\":\"" + project + "\",\"action\":\"add\"}")
        .when().post("/lore/doc/project").then().statusCode(200);
    }

    private void createRunbook(String id, String project) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"runbook_id\":\"" + id + "\",\"name\":\"AL-95 " + id + "\"}")
        .when().post("/lore/runbook").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"runbook_id\":\"" + id + "\",\"project\":\"" + project + "\",\"action\":\"add\"}")
        .when().post("/lore/runbook/project").then().statusCode(200);
    }

    /** Идентификаторы в выдаче произвольного слайса — одной формой на три типа. */
    private List<String> idsOf(String slice, String idField) {
        return given().contentType("application/json")
            .when().get("/lore/slice/" + slice)
            .then().statusCode(200)
            .extract().jsonPath().getList("rows." + idField, String.class);
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

    // ── Требование владелицы 19.10.2026: спеки, доки и ранбуки ──────────────
    //
    // «make reader for people with right role on project if they didnt have
    // don't show them specs docs runbooks».
    //
    // Эти три слайса лежали в PROJECT_SCOPED с самого начала и НЕ были покрыты
    // ни одним тестом: проверялся только `sprints`. Непокрытый слайс под
    // включённым флагом — это не «пока не сделали», это гарантия с видом
    // исполненной. У каждого из трёх свой путь привязки проекта, и ошибка в
    // любом даёт ровно ту же картину, что верная работа: записи не видно.

    @Test
    @Order(7)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void readerWithRoleSeesSpecsDocsRunbooksOfOwnProjectOnly() {
        var specs = idsOf("specs", "spec_id");
        assertTrue(specs.contains(SPEC_ALPHA), "спека своего проекта обязана быть видна");
        assertFalse(specs.contains(SPEC_HIDDEN),
            "спека проекта без роли видна — скоуп к слайсу specs не применён");

        var docs = idsOf("docs", "doc_id");
        assertTrue(docs.contains(DOC_ALPHA), "док своего проекта обязан быть виден");
        assertFalse(docs.contains(DOC_HIDDEN),
            "док проекта без роли виден — скоуп к слайсу docs не применён");

        var runbooks = idsOf("runbooks", "runbook_id");
        assertTrue(runbooks.contains(RB_ALPHA), "ранбук своего проекта обязан быть виден");
        assertFalse(runbooks.contains(RB_HIDDEN),
            "ранбук проекта без роли виден — скоуп к слайсу runbooks не применён");
    }

    @Test
    @Order(8)
    @TestSecurity(user = "al95-nobody", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "al95-nobody-sub"))
    void userWithoutAnyRoleSeesNoSpecsDocsRunbooks() {
        // Прямая формулировка требования: роли нет — трёх типов не видно
        // ВООБЩЕ. Положительная половина (роль есть → видно) закреплена
        // соседним тестом; без неё «не видно» ничего не значило бы — пустая
        // выдача могла бы означать, что записей просто нет.
        assertFalse(idsOf("specs", "spec_id").contains(SPEC_ALPHA));
        assertFalse(idsOf("specs", "spec_id").contains(SPEC_HIDDEN));
        assertFalse(idsOf("docs", "doc_id").contains(DOC_ALPHA));
        assertFalse(idsOf("docs", "doc_id").contains(DOC_HIDDEN));
        assertFalse(idsOf("runbooks", "runbook_id").contains(RB_ALPHA));
        assertFalse(idsOf("runbooks", "runbook_id").contains(RB_HIDDEN));
    }

    // ── AL-120: косвенная связь — проект через РОДИТЕЛЯ ─────────────────────
    //
    // Слова владелицы 2026-08-17: «проверять надо как прямую связь, так и
    // косвенную через родительские объекты». Замер того дня: у решений СВОЕГО
    // ребра проекта не было ни у одного из 300 — проект выводится только через
    // родительский ADR (DECIDED_IN); у вопросов — через место, где подняты
    // (RAISED_IN). PROJECT_SCOPED для них несёт два пути через «|», но при
    // включённом скоупе это ни разу не проверялось: тест compose() видел SQL,
    // а не выдачу. Здесь — выдача, под учёткой с ролью в одном проекте.
    //
    // У решений и вопросов ниже НЕТ своего ребра проекта — намеренно. С ним
    // тест прошёл бы и на компоновке «только прямая связь», то есть проверял бы
    // не то, ради чего написан.

    private static final String ADR_ALPHA = "ADR-AL120-ALPHA";
    private static final String ADR_HIDDEN = "ADR-AL120-HIDDEN";
    private static final String DEC_ALPHA = "D-AL120-ALPHA";
    private static final String DEC_HIDDEN = "D-AL120-HIDDEN";
    private static final String Q_ALPHA = "Q-AL120-ALPHA";
    private static final String Q_HIDDEN = "Q-AL120-HIDDEN";

    private void createAdrInProject(String adrId, String project) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"adr_id\":\"" + adrId + "\",\"name\":\"AL-120 " + adrId + "\"}")
        .when().post("/lore/adr").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"adr_id\":\"" + adrId + "\",\"project\":\"" + project + "\",\"action\":\"add\"}")
        .when().post("/lore/adr/project").then().statusCode(200);
    }

    /** Решение-ребёнок ADR: проекта не передаём — он обязан вывестись через DECIDED_IN. */
    private void createDecisionUnder(String decisionId, String adrId) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"decision_id\":\"" + decisionId + "\",\"title\":\"AL-120 " + decisionId + "\","
                + "\"body_md\":\"Проект только через родительский ADR.\",\"adr_id\":\"" + adrId + "\"}")
        .when().post("/lore/decision").then().statusCode(200);
    }

    /** Вопрос, поднятый в ADR: проекта не передаём — он обязан вывестись через RAISED_IN. */
    private void createQuestionRaisedIn(String questionId, String adrId) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"question_id\":\"" + questionId + "\",\"title\":\"AL-120 " + questionId + "\","
                + "\"status\":\"open\"}")
        .when().post("/lore/question").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"question_id\":\"" + questionId + "\",\"target_type\":\"adr\",\"target_id\":\""
                + adrId + "\",\"action\":\"add\"}")
        .when().post("/lore/question/raised_in").then().statusCode(200);
    }

    @Test
    @Order(20)
    void setUpIndirectLinks() {
        createAdrInProject(ADR_ALPHA, P_ALPHA);
        createAdrInProject(ADR_HIDDEN, P_HIDDEN);
        createDecisionUnder(DEC_ALPHA, ADR_ALPHA);
        createDecisionUnder(DEC_HIDDEN, ADR_HIDDEN);
        createQuestionRaisedIn(Q_ALPHA, ADR_ALPHA);
        createQuestionRaisedIn(Q_HIDDEN, ADR_HIDDEN);
    }

    @Test
    @Order(21)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void decisionIsVisibleThroughItsParentAdrProjectOnly() {
        var ids = idsOf("decisions", "decision_id");
        assertTrue(ids.contains(DEC_ALPHA),
            "решение без своего ребра, но под ADR своего проекта, обязано быть видно — "
            + "иначе скоуп отрезает автора от его же решения (AL-120)");
        assertFalse(ids.contains(DEC_HIDDEN),
            "решение под ADR чужого проекта видно — косвенный путь пропускает лишнее");
    }

    @Test
    @Order(22)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void decisionsOfAdrFollowTheSameRule() {
        // Второй слайс про те же решения — со своей строкой в PROJECT_SCOPED.
        // Две строки об одном правиле расходятся молча (RM-P8), поэтому
        // проверяются обе, а не «по аналогии».
        List<String> own = given().contentType("application/json")
            .when().get("/lore/slice/decisions_of_adr?id=" + ADR_ALPHA)
            .then().statusCode(200).extract().jsonPath().getList("rows.decision_id", String.class);
        List<String> foreign = given().contentType("application/json")
            .when().get("/lore/slice/decisions_of_adr?id=" + ADR_HIDDEN)
            .then().statusCode(200).extract().jsonPath().getList("rows.decision_id", String.class);
        assertTrue(own.contains(DEC_ALPHA), "решения своего ADR обязаны быть видны");
        assertFalse(foreign.contains(DEC_HIDDEN), "решения ADR чужого проекта видны");
    }

    @Test
    @Order(23)
    @TestSecurity(user = "al95-viewer", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = VIEWER_SUB))
    void questionIsVisibleThroughWhereItWasRaisedOnly() {
        var ids = idsOf("open_questions", "question_id");
        assertTrue(ids.contains(Q_ALPHA),
            "вопрос, поднятый в ADR своего проекта, обязан быть виден (AL-120)");
        assertFalse(ids.contains(Q_HIDDEN),
            "вопрос, поднятый в ADR чужого проекта, виден — косвенный путь пропускает лишнее");
    }

    @Test
    @Order(24)
    @TestSecurity(user = "al95-root", roles = {"super-admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "al95-root-sub-without-any-role"))
    void superadminSeesBothIndirectlyLinkedSides() {
        // Положительный контроль к 21–23: обе стороны в базе ЕСТЬ. Без него
        // «чужого не видно» неотличимо от «чужое не завелось».
        assertTrue(idsOf("decisions", "decision_id").containsAll(List.of(DEC_ALPHA, DEC_HIDDEN)));
        assertTrue(idsOf("open_questions", "question_id").containsAll(List.of(Q_ALPHA, Q_HIDDEN)));
    }
}
