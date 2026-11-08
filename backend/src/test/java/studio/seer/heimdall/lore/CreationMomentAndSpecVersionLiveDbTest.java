package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 (остаток после S2-12/S2-13):
 * <ol>
 *   <li>у создания ADR и решений и у релиза — полный ISO-момент, а не только дата
 *       (news-proof 01–07.11: у них была одна дата, §7.3 TTD не считалось);</li>
 *   <li>номер версии спеки живёт в истории: смена version открывает новую версию
 *       KnowSpecHist, прежний номер остаётся в закрытой строке (раньше правился
 *       на месте — разбивка по semver была невозможна).</li>
 * </ol>
 * Каждый «момент» сопровождён положительным контролем честности: дата в прошлом
 * момента НЕ получает.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class CreationMomentAndSpecVersionLiveDbTest {

    @Inject
    LoreIngestService ingest;

    private static io.restassured.specification.RequestSpecification admin() {
        return given().header("X-Seer-Role", "admin").contentType("application/json");
    }

    private Map<String, Object> one(String sql, Map<String, Object> p) {
        List<Map<String, Object>> rows = ingest.queryPublic(sql, p);
        assertEquals(1, rows.size(), sql + " → " + rows);
        return rows.get(0);
    }

    private static void assertMomentOfToday(Object moment, Object date, Instant before, String what) {
        assertNotNull(moment, what + ": момент создания не записан");
        Instant m = Instant.parse(String.valueOf(moment));
        assertTrue(!m.isBefore(before.minusSeconds(1)) && !m.isAfter(Instant.now().plusSeconds(1)),
            what + ": момент " + m + " вне окна записи");
        assertEquals(m.atZone(ZoneOffset.UTC).toLocalDate().toString(), String.valueOf(date),
            what + ": дата и момент обязаны совпадать по UTC-дню");
    }

    @Test
    void newAdrCarriesCreationMoment_pastDateDoesNot() {
        Instant before = Instant.now();
        admin().body(Map.of("adr_id", "ADR-S210-MOMENT", "name", "s210"))
            .when().post("/lore/adr").then().statusCode(200);
        Map<String, Object> r = one("SELECT date_created, created_at FROM KnowADR WHERE adr_id='ADR-S210-MOMENT'", Map.of());
        assertMomentOfToday(r.get("created_at"), r.get("date_created"), before, "ADR");

        // Правка существующего ADR момент создания не переписывает.
        Object first = r.get("created_at");
        admin().body(Map.of("adr_id", "ADR-S210-MOMENT", "name", "s210 renamed"))
            .when().post("/lore/adr").then().statusCode(200);
        assertEquals(first, one("SELECT created_at FROM KnowADR WHERE adr_id='ADR-S210-MOMENT'", Map.of()).get("created_at"));

        // Положительный контроль: ADR с датой в прошлом — время неизвестно, не «сейчас».
        admin().body(Map.of("adr_id", "ADR-S210-PAST", "name", "s210", "date_created", "2026-07-02"))
            .when().post("/lore/adr").then().statusCode(200);
        Map<String, Object> p = one("SELECT date_created, created_at FROM KnowADR WHERE adr_id='ADR-S210-PAST'", Map.of());
        assertEquals("2026-07-02", p.get("date_created"));
        assertNull(p.get("created_at"), "дата в прошлом — момент не выдумывается: " + p);
    }

    @Test
    void newDecisionCarriesCreationMoment_pastDateDoesNot() {
        Instant before = Instant.now();
        admin().body(Map.of("decision_id", "D-2026-S210-MOMENT", "title", "s210"))
            .when().post("/lore/decision").then().statusCode(200);
        Map<String, Object> r = one("SELECT date_created, created_at FROM KnowDecision WHERE decision_id='D-2026-S210-MOMENT'", Map.of());
        assertMomentOfToday(r.get("created_at"), r.get("date_created"), before, "решение");

        Object first = r.get("created_at");
        admin().body(Map.of("decision_id", "D-2026-S210-MOMENT", "title", "s210 правка"))
            .when().post("/lore/decision").then().statusCode(200);
        assertEquals(first, one("SELECT created_at FROM KnowDecision WHERE decision_id='D-2026-S210-MOMENT'", Map.of()).get("created_at"),
            "правка решения момент создания не трогает");

        admin().body(Map.of("decision_id", "D-2026-S210-PAST", "title", "s210", "date_created", "2026-07-02"))
            .when().post("/lore/decision").then().statusCode(200);
        Map<String, Object> p = one("SELECT date_created, created_at FROM KnowDecision WHERE decision_id='D-2026-S210-PAST'", Map.of());
        assertEquals("2026-07-02", p.get("date_created"));
        assertNull(p.get("created_at"), "дата в прошлом — момент не выдумывается: " + p);
    }

    @Test
    void newReleaseCarriesReleaseMoment_pastDateDoesNot() {
        String gp = "test/s210-moment";
        given().header("X-Seer-Role", "superadmin").contentType("application/json")
            .body("{\"slug\":\"" + gp + "\"}").when().post("/lore/project").then().statusCode(200);
        Instant before = Instant.now();
        admin().body(Map.of("release_id", "v0.0.1-s210", "git_project", gp, "git_tag", "v0.0.1-s210"))
            .when().post("/lore/release").then().statusCode(200);
        Map<String, Object> r = one("SELECT release_date, released_at FROM KnowRelease WHERE release_uid=:k",
            Map.of("k", gp + "#v0.0.1-s210"));
        assertMomentOfToday(r.get("released_at"), r.get("release_date"), before, "релиз");

        admin().body(Map.of("release_id", "v0.0.0-s210", "git_project", gp, "release_date", "2026-07-02"))
            .when().post("/lore/release").then().statusCode(200);
        Map<String, Object> p = one("SELECT release_date, released_at FROM KnowRelease WHERE release_uid=:k",
            Map.of("k", gp + "#v0.0.0-s210"));
        assertEquals("2026-07-02", p.get("release_date"));
        assertNull(p.get("released_at"), "дата в прошлом — момент не выдумывается: " + p);
    }

    @Test
    void specVersionChangeOpensAHistVersion_bodyEditStaysInPlace() {
        String id = "SPEC-S210-SEMVER";
        admin().body(Map.of("spec_id", id, "title", "s210", "version", "1.0.0", "content_md", "тело 1"))
            .when().post("/lore/spec").then().statusCode(200);
        // Положительный контроль: правка тела без checkpoint по-прежнему на месте.
        admin().body(Map.of("spec_id", id, "content_md", "тело 1, опечатка"))
            .when().post("/lore/spec").then().statusCode(200);
        List<Map<String, Object>> h1 = ingest.queryPublic(
            "SELECT version, content_md, valid_to FROM KnowSpecHist WHERE in('HAS_STATE').spec_id CONTAINS :id", Map.of("id", id));
        assertEquals(1, h1.size(), "правка тела без checkpoint версию не открывает: " + h1);

        // Новый номер версии — новая версия истории, даже без checkpoint.
        admin().body(Map.of("spec_id", id, "version", "1.1.0"))
            .when().post("/lore/spec").then().statusCode(200);
        List<Map<String, Object>> h2 = ingest.queryPublic(
            "SELECT version, content_md, valid_to FROM KnowSpecHist WHERE in('HAS_STATE').spec_id CONTAINS :id ORDER BY valid_from",
            Map.of("id", id));
        assertEquals(2, h2.size(), "смена номера версии — новая строка истории: " + h2);
        Map<String, Object> closed = h2.stream().filter(r -> r.get("valid_to") != null).findFirst().orElseThrow();
        Map<String, Object> open = h2.stream().filter(r -> r.get("valid_to") == null).findFirst().orElseThrow();
        assertEquals("1.0.0", closed.get("version"), "прежний номер сохранён в закрытой версии");
        assertEquals("1.1.0", open.get("version"));
        assertEquals("тело 1, опечатка", open.get("content_md"), "тело перенесено в новую версию");

        // Тот же номер повторно версию не открывает.
        admin().body(Map.of("spec_id", id, "version", "1.1.0"))
            .when().post("/lore/spec").then().statusCode(200);
        assertEquals(2, ingest.queryPublic(
            "SELECT FROM KnowSpecHist WHERE in('HAS_STATE').spec_id CONTAINS :id", Map.of("id", id)).size());
    }
}
