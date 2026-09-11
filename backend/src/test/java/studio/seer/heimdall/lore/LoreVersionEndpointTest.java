package studio.seer.heimdall.lore;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.emptyOrNullString;

/**
 * SE-10: бэкенд обязан уметь сказать, из какого коммита он собран.
 *
 * <p>Зачем. MCP-сервер сессий собирается из основного чекаута руками и живёт
 * своей жизнью: 10.09.2026 он оказался на 281 коммит позади develop, и правки
 * схем инструментов до агентов не доходили — новый параметр давал честный
 * отказ «Unrecognized key», а исправленное описание не давало ничего. Чтобы
 * расхождение стало ВИДНЫМ, обе стороны должны знать свою сборку; эта ручка —
 * половина бэкенда.
 *
 * <p>Читается без admin: версия — не секрет, а спрашивает её в первую очередь
 * агент, у которого прав может не быть вовсе.
 */
@QuarkusTest
class LoreVersionEndpointTest {

    @Test
    void versionIsReadableByAnyoneAndNamesTheBuild() {
        given().header("X-Seer-Role", "viewer")
        .when().get("/lore/version")
        .then().statusCode(200)
            // Коммит непуст ВСЕГДА: без git и без аргумента сборки — «unknown»,
            // но не null и не пусто. Пустое поле неотличимо от «ручки нет».
            .body("commit", not(emptyOrNullString()))
            .body("built_at", not(emptyOrNullString()))
            // Версия схемы — из того же реестра, что ведёт миграции: две правды
            // о номере схемы разошлись бы первой же правкой.
            .body("schema_version", equalTo(LoreSchemaMigrations.codeVersion()));
    }
}
