package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Роль release-manager (слово владелицы 27.11.2026: «пусть заводит роль release manager»): служебная
 * учётка CI других проектов (клиент lore-ci-release) регистрирует выпуски, не получая admin.
 *
 * <p>Право ровно одно — POST /lore/release (lore-release.sh miniLORE делает только этот вызов; снятие
 * флага current с прежнего выпуска — часть того же пути). Всё остальное — как у viewer: update / link /
 * unlink выпуска и любая админская запись отвечают 403.
 *
 * <p>Тесты идут с выключенным OIDC (заголовок X-Seer-Role принимается как прислан), поэтому роль из
 * токена проверяется отдельно на правиле {@link Whoami#seerRole}, которым пользуется и фильтр: при
 * проверенном токене фильтр перезаписывает заголовок ролью из токена, и присланное «admin» не проходит.
 */
@QuarkusTest
class ReleaseManagerRoleTest {

    @Test
    void рольИзТокена_releaseManagerНеПоднимаетсяДоAdmin() {
        assertEquals("release-manager", Whoami.seerRole(Set.of("release-manager")));
        assertEquals("release-manager", Whoami.seerRole(Set.of("release-manager", "offline_access")));
        assertEquals("admin", Whoami.seerRole(Set.of("admin", "release-manager")));
        assertEquals("superadmin", Whoami.seerRole(Set.of("super-admin", "release-manager")));
        assertEquals("viewer", Whoami.seerRole(Set.of("offline_access")));
    }

    @Test
    void releaseManagerПроходитЗамокЗаписиВыпуска() {
        // Пустой release_id отбивается ПОСЛЕ замка роли (400, а не 403): роль пропущена, базы не нужно.
        given()
            .header("X-Seer-Role", "release-manager")
            .contentType("application/json")
            .body("{\"release_id\":\"\"}")
        .when()
            .post("/lore/release")
        .then()
            .statusCode(400);
    }

    @Test
    void releaseManagerНеПравитИНеСвязываетВыпуски() {
        for (String path : new String[] {"/lore/release/update", "/lore/release/link", "/lore/release/unlink"}) {
            given()
                .header("X-Seer-Role", "release-manager")
                .contentType("application/json")
                .body("{\"release_id\":\"v1.0.0\"}")
            .when()
                .post(path)
            .then()
                .statusCode(403)
                .body("error", equalTo("FORBIDDEN"));
        }
    }

    @Test
    void releaseManagerНеПишетАдминскиеЗаписи() {
        given()
            .header("X-Seer-Role", "release-manager")
            .contentType("application/json")
            .body("{\"sprint_id\":\"SPRINT_X\"}")
        .when()
            .post("/lore/sprint/create")
        .then()
            .statusCode(403)
            .body("error", equalTo("FORBIDDEN"));
    }
}
