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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Решение владелицы 19.10.2026: «достаточно обнулять текст самого документа
 * при выдаче по MCP или же в web».
 *
 * <p>Мера принципиально иная, чем построчный скоуп: строка остаётся с
 * опознавательными полями, скрывается только содержимое. Выбрана потому, что
 * построчное скрытие режет по ребру {@code BELONGS_TO_PROJECT} и отрезает
 * всё, у чего ребра нет — замер 19.10.2026 по проду: 218 спек из 415, 239
 * доков из 292, 42 ранбука из 47. Это 499 записей, исчезающих у ВСЕХ,
 * включая владельца. Обнуление тела не прячет ни одной строки.
 *
 * <p>Проверяются ТРИ вещи, и ни одна не выводится из остальных:
 * <ol>
 *   <li>роль есть → тело на месте (без этого «нет тела» не значило бы ничего);
 *   <li>роли нет → тело пусто, И стоит признак, И опознавательные поля целы;
 *   <li>у записи нет проекта → тело на месте даже без роли: обнулять её
 *       значило бы наказывать за недостачу данных, а не за отсутствие прав.
 * </ol>
 *
 * <p>Признак {@code body_redacted} проверяется отдельным утверждением
 * намеренно. Пустое тело без признака читается как «документ не написан» —
 * подмена «нет доступа» на «нечего показывать». Это тот самый класс, против
 * которого написана половина проверок корпуса, и здесь он возник бы в самой
 * мере защиты.
 */
@QuarkusTest
@TestProfile(BodyRedactProfile.class)
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class LoreBodyRedactLiveDbTest {

    private static final String P_MINE = "LORE_TEST_ORG/redact-mine";
    private static final String P_THEIRS = "LORE_TEST_ORG/redact-theirs";

    private static final String READER_SUB = "redact-reader-sub";

    private static final String SPEC_MINE = "SPEC-REDACT-MINE";
    private static final String SPEC_THEIRS = "SPEC-REDACT-THEIRS";
    /** Без единого проектного ребра — случай 499 сирот с прода. */
    private static final String SPEC_ORPHAN = "SPEC-REDACT-ORPHAN";

    private static final String DOC_THEIRS = "redact_doc_theirs";
    /** Без проекта — случай доков правил CLAUDE и инфраструктурных ранбуков. */
    private static final String DOC_ORPHAN = "redact_doc_orphan";
    private static final String RB_THEIRS = "RUNBOOK-REDACT-THEIRS";

    private static final String BODY = "тело документа, которое не должно утечь";

    @Test
    @Order(1)
    void setUp() {
        for (String slug : List.of(P_MINE, P_THEIRS)) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"slug\":\"" + slug + "\"}")
            .when().post("/lore/project").then().statusCode(200);
        }
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + READER_SUB + "\",\"display_name\":\"Redact Reader\"}")
        .when().post("/lore/user").then().statusCode(200);
        // Роль ТОЛЬКО в одном из двух проектов — в этом и смысл проверки.
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"kc_sub\":\"" + READER_SUB + "\",\"project\":\"" + P_MINE + "\",\"role\":\"reader\"}")
        .when().post("/lore/user/role").then().statusCode(200);

        spec(SPEC_MINE, P_MINE);
        spec(SPEC_THEIRS, P_THEIRS);
        spec(SPEC_ORPHAN, null);

        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"doc_id\":\"" + DOC_THEIRS + "\",\"title\":\"Redact doc\",\"kind\":\"reference\","
                + "\"content_md_ru\":\"" + BODY + "\"}")
        .when().post("/lore/doc").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"doc_id\":\"" + DOC_THEIRS + "\",\"project\":\"" + P_THEIRS + "\",\"action\":\"add\"}")
        .when().post("/lore/doc/project").then().statusCode(200);

        // Док БЕЗ проектного ребра — намеренно, не забытый вызов /lore/doc/project.
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"doc_id\":\"" + DOC_ORPHAN + "\",\"title\":\"Redact orphan doc\","
                + "\"kind\":\"claude-rules\",\"content_md_ru\":\"" + BODY + "\"}")
        .when().post("/lore/doc").then().statusCode(200);

        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"runbook_id\":\"" + RB_THEIRS + "\",\"name\":\"Redact runbook\","
                + "\"content_md\":\"" + BODY + "\"}")
        .when().post("/lore/runbook").then().statusCode(200);
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"runbook_id\":\"" + RB_THEIRS + "\",\"project\":\"" + P_THEIRS + "\",\"action\":\"add\"}")
        .when().post("/lore/runbook/project").then().statusCode(200);
    }

    private void spec(String id, String project) {
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"spec_id\":\"" + id + "\",\"title\":\"Redact " + id + "\","
                + "\"content_md\":\"" + BODY + "\"}")
        .when().post("/lore/spec").then().statusCode(200);
        if (project != null) {
            given().header("X-Seer-Role", "superadmin").contentType("application/json")
                .body("{\"spec_id\":\"" + id + "\",\"rel\":\"project\",\"target_id\":\"" + project
                    + "\",\"mode\":\"add\"}")
            .when().post("/lore/spec/link").then().statusCode(200);
        }
    }

    private io.restassured.path.json.JsonPath row(String slice, String id) {
        return given().contentType("application/json")
            .when().get("/lore/slice/" + slice + "?id=" + id)
            .then().statusCode(200)
            .extract().jsonPath();
    }

    // ── 1. Роль есть → тело на месте ────────────────────────────────────────

    @Test
    @Order(2)
    @TestSecurity(user = "redact-reader", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = READER_SUB))
    void bodyStaysWhenReaderHasRoleInTheProject() {
        var r = row("spec_by_id", SPEC_MINE);
        assertEquals(BODY, r.getString("rows[0].content_md"),
            "у читателя есть роль в проекте спеки — тело обязано дойти целым");
        assertNull(r.get("rows[0].body_redacted"),
            "признак обнуления не должен появляться там, где ничего не обнулено");
    }

    // ── 2. Роли нет → тело пусто, признак стоит, опознание цело ─────────────

    @Test
    @Order(3)
    @TestSecurity(user = "redact-reader", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = READER_SUB))
    void bodyIsBlankedWithAnExplicitMarkerWhenRoleIsMissing() {
        var r = row("spec_by_id", SPEC_THEIRS);
        assertNull(r.getString("rows[0].content_md"), "тело чужого проекта обязано быть обнулено");
        assertEquals(true, r.get("rows[0].body_redacted"),
            "без признака пустое тело неотличимо от «документ не написан»");
        assertNotNull(r.getString("rows[0].body_redacted_reason"), "причина обязана быть названа");
        // Опознавательные поля целы: строка НЕ исчезает, иначе мы вернулись бы
        // к построчному скрытию с его 499 потерянными записями.
        assertEquals(SPEC_THEIRS, r.getString("rows[0].spec_id"));
        assertNotNull(r.getString("rows[0].title"), "заголовок обязан остаться виден");
    }

    @Test
    @Order(4)
    @TestSecurity(user = "redact-reader", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = READER_SUB))
    void docAndRunbookBodiesAreBlankedToo() {
        // Три типа проверяются по отдельности: у каждого свои поля тела, и
        // пропущенное поле в реестре BODY_SCOPED выглядит ровно как работающая
        // защита — тело просто утекло бы молча.
        var d = row("doc_by_id", DOC_THEIRS);
        assertNull(d.getString("rows[0].content_md_ru"), "тело дока обязано быть обнулено");
        assertEquals(true, d.get("rows[0].body_redacted"));

        var b = row("runbook_by_id", RB_THEIRS);
        assertNull(b.getString("rows[0].content_md"), "тело ранбука обязано быть обнулено");
        assertEquals(true, b.get("rows[0].body_redacted"));
    }

    // ── 3. Нет проекта → тело на месте даже без роли ────────────────────────

    @Test
    @Order(5)
    @TestSecurity(user = "redact-reader", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = READER_SUB))
    void recordWithoutAnyProjectKeepsItsBody() {
        // Осознанное послабление, а не забытый случай: у записи без проекта нет
        // проекта, на котором можно иметь роль. Обнулять её значило бы
        // наказывать за недостачу данных — так на проде пропали бы 499 записей.
        // Такие записи перечисляет срез scope_orphans: видимая работа, не дыра.
        var r = row("spec_by_id", SPEC_ORPHAN);
        assertEquals(BODY, r.getString("rows[0].content_md"),
            "у записи без проекта тело остаётся: прав на неё никто не имеет по построению");
        assertNull(r.get("rows[0].body_redacted"));
    }

    // ── Обход: superadmin видит всё ─────────────────────────────────────────

    @Test
    @Order(6)
    @TestSecurity(user = "redact-root", roles = {"super-admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "redact-root-sub-without-roles"))
    void superadminSeesBodiesEverywhere() {
        // У этого sub нет ни одной проектной роли — обход идёт по роли реалма.
        assertEquals(BODY, row("spec_by_id", SPEC_THEIRS).getString("rows[0].content_md"),
            "superadmin обязан видеть тело в проекте, где у него нет роли");
    }

    @Test
    @Order(7)
    @TestSecurity(user = "redact-admin", roles = {"admin"})
    @JwtSecurity(claims = @Claim(key = "sub", value = "redact-admin-sub-without-roles"))
    void adminSeesBodiesEverywhereToo() {
        // Проверяется по требованию владелицы 19.10.2026: «посмотри, чтобы admin
        // superadmin имели к ним доступ». Отдельным тестом, а не выводом из
        // предыдущего: обход даёт ОДНО выражение на две роли
        // (bypassesScope: superadmin || admin), и зелёный superadmin ничего не
        // говорит про admin — достаточно опечатки в одном из двух сравнений.
        //
        // Путь роли тоже неочевиден и тоже проверяется здесь, а не читается:
        // в заголовке X-Seer-Role тест ничего не посылает, роль ставит
        // SeerRoleFromTokenFilter из realm-роли токена (admin → "admin").
        // Сломайся это отображение — тест покраснеет, а не промолчит.
        assertEquals(BODY, row("spec_by_id", SPEC_THEIRS).getString("rows[0].content_md"),
            "admin администрирует весь корпус — тело обязано дойти целым и там, "
            + "где у него нет проектной роли");
        assertNull(row("spec_by_id", SPEC_THEIRS).get("rows[0].body_redacted"));
    }

    @Test
    @Order(8)
    @TestSecurity(user = "redact-claude-rules-reader", roles = {"viewer"})
    @JwtSecurity(claims = @Claim(key = "sub", value = READER_SUB))
    void docWithoutProjectKeepsBodyForPlainReaderToo() {
        // Решение владелицы 19.10.2026: «Claude rules infra пока ни к чему не
        // привязывай и посмотри, чтобы admin superadmin имели к ним доступ».
        //
        // Доки правил CLAUDE и инфраструктурные ранбуки остаются без проекта
        // НАМЕРЕННО — они про машину, а не про продукт (шаг V47 исключает
        // kind='claude-rules' и area='infra' условием запроса). Здесь
        // закрепляется следствие, на которое это решение опирается: запись без
        // проекта читается целиком даже тем, у кого нет вообще никаких прав —
        // то есть admin и superadmin тем более. Поломайся правило «нет проекта →
        // не обнуляем», и общие знания о стенде пропали бы у всех сразу.
        var r = row("doc_by_id", DOC_ORPHAN);
        assertEquals(BODY, r.getString("rows[0].content_md_ru"),
            "док без проекта обязан читаться целиком: прав на него нет ни у кого по построению");
        assertNull(r.get("rows[0].body_redacted"));
    }

    // ── Страховка: выключенный auth не обнуляет ─────────────────────────────

    @Test
    @Order(9)
    void authOffKeepsBodies() {
        // Ни @TestSecurity, ни JWT — то, что видит бэкенд в dev без OIDC.
        // Решение владельца «auth off = superadmin» распространяется и сюда:
        // иначе разработчик локально увидел бы документы без текста и решил,
        // что база пустая.
        assertEquals(BODY, row("spec_by_id", SPEC_THEIRS).getString("rows[0].content_md"));
        assertTrue(true);
    }
}
