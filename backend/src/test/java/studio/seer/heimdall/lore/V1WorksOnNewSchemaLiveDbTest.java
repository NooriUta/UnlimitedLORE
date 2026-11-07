package studio.seer.heimdall.lore;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.DisabledIfEnvironmentVariable;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-07: «v1 работает на новой схеме» — ФАКТОМ, а не ledger.
 *
 * <p>Тест-ресурс накатывает ВСЕ шаги реестра, включая шаги S2. После этого
 * проверяется то, что видит v1:
 * <ol>
 *   <li>каждый тип и каждое объявленное свойство схемы v1 на месте и того же
 *       типа. Эталон — снимок {@code v1-schema-baseline.txt}, снятый с живой
 *       базы на схеме V{@value V1SchemaSafetyChecklist#V1_BASELINE_VERSION}
 *       (до первой миграции S2). Снимок, а не вывод из шагов: часть типов
 *       создаёт бутстрап мимо реестра, часть свойств снимают Java-шаги, — по
 *       SQL шагов настоящую схему не восстановить;</li>
 *   <li>ключевые чтения v1 отвечают 200;</li>
 *   <li>запись v1 (тело ADR, SCD2) проходит и читается обратно.</li>
 * </ol>
 * Контракты S0 (MCP, miniLORE, Völva) гоняются своими тестами в том же прогоне
 * на той же накатанной схеме; e2e v1 — в Frontend CI.
 *
 * <p>Перезаписать эталон (только осознанно, когда базис v1 сдвигается
 * решением): {@code LORE_V1_SCHEMA_WRITE=<путь к файлу>}.
 */
@QuarkusTest
@QuarkusTestResource(value = LoreArcadeDbTestResource.class, restrictToAnnotatedClass = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisabledIfEnvironmentVariable(named = "LORE_SKIP_LIVE_DB_TESTS", matches = "true")
class V1WorksOnNewSchemaLiveDbTest {

    static final String BASELINE_RESOURCE = "/v1-schema-baseline.txt";

    @Inject
    LoreIngestService ingest;

    /** Фактическая схема: "Type" и "Type.prop:TYPE", отсортировано. */
    private TreeMap<String, String> actualSchema() {
        TreeMap<String, String> out = new TreeMap<>();
        for (Map<String, Object> t : ingest.queryPublic("SELECT name, properties FROM schema:types", Map.of())) {
            String type = String.valueOf(t.get("name"));
            out.put(type, "");
            if (t.get("properties") instanceof Collection<?> props) {
                for (Object p : props) {
                    if (p instanceof Map<?, ?> m) {
                        out.put(type + "." + m.get("name"), String.valueOf(m.get("type")).toUpperCase());
                    }
                }
            }
        }
        return out;
    }

    private static List<String> render(TreeMap<String, String> schema) {
        List<String> lines = new ArrayList<>();
        schema.forEach((k, v) -> lines.add(v.isEmpty() ? k : k + ":" + v));
        return lines;
    }

    /** Положительный контроль чтения схемы: иначе «всё на месте» = «ничего не прочитали». */
    @Test
    @Order(1)
    void schemaProbeSeesKnownAndMissesUnknown() {
        TreeMap<String, String> s = actualSchema();
        assertTrue(s.size() > 100, "прочитано элементов схемы: " + s.size());
        assertEquals("DOUBLE", s.get("KnowTask.actual_days"), "заведомое свойство v1 (V58)");
        assertFalse(s.containsKey("KnowTask.заведомо_нет_такого_поля_42"), "проба отвечает «есть» на несуществующее");
    }

    @Test
    @Order(2)
    void everyV1TypeAndPropertySurvivesTheNewMigrations() throws IOException {
        TreeMap<String, String> actual = actualSchema();

        String write = System.getenv("LORE_V1_SCHEMA_WRITE");
        if (write != null && !write.isBlank()) {
            Files.write(Path.of(write), render(actual), StandardCharsets.UTF_8);
        }

        List<String> baseline;
        try (InputStream in = getClass().getResourceAsStream(BASELINE_RESOURCE)) {
            // Эталона нет → падаем и печатаем фактическую схему целиком: лог
            // CI — единственное место, где её можно снять (live-DB только там).
            assertNotNull(in, "нет эталона схемы v1 " + BASELINE_RESOURCE + "; фактическая схема этого прогона:\n"
                + "=== V1-SCHEMA BEGIN ===\n" + String.join("\n", render(actual)) + "\n=== V1-SCHEMA END ===");
            baseline = new String(in.readAllBytes(), StandardCharsets.UTF_8).lines()
                .map(String::strip).filter(l -> !l.isEmpty() && !l.startsWith("#")).toList();
        }
        assertTrue(baseline.size() > 100, "эталон подозрительно мал: " + baseline.size());

        List<String> broken = new ArrayList<>();
        for (String line : baseline) {
            int colon = line.indexOf(':');
            String key = colon < 0 ? line : line.substring(0, colon);
            String type = colon < 0 ? "" : line.substring(colon + 1);
            String now = actual.get(key);
            if (now == null) broken.add("пропало: " + line);
            else if (!now.equals(type)) broken.add("сменился тип: " + line + " → " + now);
        }
        assertTrue(broken.isEmpty(),
            "миграции после v1 сломали схему, на которой работает v1 (" + broken.size() + "):\n  "
            + String.join("\n  ", broken));
    }

    @Test
    @Order(3)
    void v1ReadSlicesAnswer() {
        for (String slice : List.of("sprints", "adrs", "decisions", "specs", "open_tasks")) {
            given().header("X-Seer-Role", "admin")
            .when().get("/lore/slice/" + slice)
            .then().statusCode(200);
        }
    }

    @Test
    @Order(4)
    void v1WritePathStillWorks() {
        given().header("X-Seer-Role", "admin").contentType("application/json")
            .body("{\"adr_id\":\"ADR-S207-V1\",\"name\":\"s2-07 v1\",\"status\":\"PROPOSED\","
                + "\"context_md\":\"v1 пишет на новой схеме\"}")
        .when().post("/lore/adr")
        .then().statusCode(200).body("ok", equalTo(true));

        given().header("X-Seer-Role", "admin")
        .when().get("/lore/slice/adr_history?id=ADR-S207-V1")
        .then().statusCode(200).body("rows.context_md", hasItem("v1 пишет на новой схеме"));
    }
}
