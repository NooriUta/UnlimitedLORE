package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_PRODUCT_BACKLOG/DBR-07 — временной ряд сторожа входов {@code AuditDbLogin} объявлен
 * в модели 1.18 (раздел {@code series}), а не шагом V: схема новой модели собирается из модели
 * (MIG-01), старая цепочка V заморожена словом владелицы 15.11.2026.
 */
class LoreModelSeriesTest {

    static final String AUDIT_DDL = "CREATE TIMESERIES TYPE AuditDbLogin IF NOT EXISTS TIMESTAMP ts "
        + "TAGS (user STRING, src_ip STRING, src_container STRING, database STRING, method STRING, path STRING) "
        + "FIELDS (status INTEGER)";

    @Test
    void modelDeclaresAuditDbLoginSeries() throws Exception {
        LoreModelFile.Content c = LoreModelFile.parse(LoreModelFileTest.read(LoreModelFileTest.CANON));
        LoreModelSeries.Series s = c.series().get("AuditDbLogin");
        assertNotNull(s, "в модели нет ряда AuditDbLogin");
        assertEquals("ts", s.timestamp());
        assertEquals(List.of("user", "src_ip", "src_container", "database", "method", "path"), List.copyOf(s.tags().keySet()));
        assertEquals(Map.of("status", "INTEGER"), s.fields());
        assertEquals("db-guard", s.writer(), "пишет сторож, а не root");
    }

    @Test
    void ddlIsBuiltFromTheModel() throws Exception {
        LoreModelFile.Content c = LoreModelFile.parse(LoreModelFileTest.read(LoreModelFileTest.CANON));
        assertEquals(AUDIT_DDL, LoreModelSeries.ddl("AuditDbLogin", c.series().get("AuditDbLogin")));
    }

    @Test
    void unknownColumnTypeIsRejected() throws Exception {
        String text = LoreModelFileTest.read(LoreModelFileTest.CANON)
            .replace("\"status\" : \"INTEGER\"", "\"status\" : \"BLOB\"");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(text));
        assertTrue(e.getMessage().contains("AuditDbLogin.status"), e.getMessage());
    }

    @Test
    void storedModelWithoutSeriesStillParses() throws Exception {
        // Модель, записанная в LORE до DBR-07, раздела series не знает: разбор не падает, раздел досевается.
        io.vertx.core.json.JsonObject doc = new io.vertx.core.json.JsonObject(LoreModelFileTest.read(LoreModelFileTest.CANON));
        doc.remove("series");
        assertTrue(LoreModelFile.parse(doc.encode()).series().isEmpty());
        LoreModelStore.Upgrade up = LoreModelStore.upgrade(doc.encode(), LoreModelFileTest.read(LoreModelFileTest.CANON));
        assertEquals(List.of("series"), up.added());
    }

    @Test
    void identifiersAreSafe() {
        LoreModelSeries.Series bad = new LoreModelSeries.Series("x", "ts", Map.of("u; DROP TYPE X", "STRING"), Map.of(), "db-guard");
        assertFalse(LoreModelSeries.problems("AuditDbLogin", bad).isEmpty());
    }
}
