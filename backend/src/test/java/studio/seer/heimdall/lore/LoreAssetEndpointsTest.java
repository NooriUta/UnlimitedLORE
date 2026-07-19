package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

/**
 * PL-21 (ADR-LORE-031): контракт generic-ассетов, проверяемый БЕЗ S3 —
 * все отказы валидации происходят ДО записи файла (файл-сирота невозможен
 * даже при кривом вызове), и до S3 дело не доходит.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
class LoreAssetEndpointsTest {

    private static final byte[] PNG = new byte[]{(byte) 0x89, 'P', 'N', 'G', 0, 0, 0, 0};

    @Test
    void uploadRequiresAdmin() {
        given().header("X-Seer-Role", "viewer")
            .multiPart("file", "x.png", PNG, "image/png")
            .multiPart("entity_type", "adr").multiPart("entity_id", "ADR-LORE-031")
        .when().post("/lore/asset/upload")
        .then().statusCode(403);
    }

    @Test
    void uploadWithoutEntityIsRejected() {
        // Ядро ADR-031: ассет без привязки не принимается — ни ключа, ни файла.
        given().header("X-Seer-Role", "admin")
            .multiPart("file", "x.png", PNG, "image/png")
        .when().post("/lore/asset/upload")
        .then().statusCode(400).body("detail", containsString("без привязки"));
    }

    @Test
    void unknownEntityTypeIsRejected() {
        given().header("X-Seer-Role", "admin")
            .multiPart("file", "x.png", PNG, "image/png")
            .multiPart("entity_type", "banana").multiPart("entity_id", "B-1")
        .when().post("/lore/asset/upload")
        .then().statusCode(400).body("detail", containsString("unknown entity_type"));
    }

    @Test
    void mimeOutsideWhitelistIsRejected() {
        given().header("X-Seer-Role", "admin")
            .multiPart("file", "x.exe", PNG, "application/x-msdownload")
            .multiPart("entity_type", "adr").multiPart("entity_id", "ADR-LORE-031")
        .when().post("/lore/asset/upload")
        .then().statusCode(400).body("detail", containsString("whitelist"));
    }

    @Test
    void missingEntityIs404BeforeAnyWrite() {
        given().header("X-Seer-Role", "admin")
            .multiPart("file", "x.png", PNG, "image/png")
            .multiPart("entity_type", "adr").multiPart("entity_id", "ADR-NO-SUCH-999")
        .when().post("/lore/asset/upload")
        .then().log().ifValidationFails().statusCode(404).body("error", equalTo("ENTITY_NOT_FOUND"));
    }

    @Test
    void serveRejectsPathTricks() {
        given().when().get("/lore/asset/file/adr/..%2F..%2Fetc/passwd")
        .then().statusCode(400);
    }
}
