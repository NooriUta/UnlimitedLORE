package studio.seer.heimdall.lore;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MEASURE_TRUTH/MT-MCP-TRUTH п.1 — строгий режим «только создать»: POST создания
 * adr/spec/decision/task с {@code ?mode=create} на занятый id — 409 ID_TAKEN, запись не трогается.
 * Без флага — прежний upsert. Чистый юнит: база — заглушка, клиента записи нет вовсе, так что 409
 * доказывает и то, что до записи дело не дошло.
 */
class LoreCreateOnlyTest {

    /** Запись с заданными полями, остальные — null (форма запроса меняется — тест не ломается). */
    static <T extends Record> T req(Class<T> c, Map<String, Object> vals) {
        try {
            RecordComponent[] rc = c.getRecordComponents();
            Class<?>[] types = new Class<?>[rc.length];
            Object[] args = new Object[rc.length];
            for (int i = 0; i < rc.length; i++) {
                types[i] = rc[i].getType();
                args[i] = vals.get(rc[i].getName());
            }
            return c.getDeclaredConstructor(types).newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    static LoreReadIdUnicodeTest.StubIngest exists(boolean yes) {
        return new LoreReadIdUnicodeTest.StubIngest((sql, p) -> yes ? List.of(Map.of("x", 1)) : List.of());
    }

    static <R extends LoreResourceBase> R wire(R r, LoreIngestService db) {
        r.enabled = true;
        r.ingestService = db;
        return r;
    }

    static void assertTaken(Response r, String id) {
        assertEquals(409, r.getStatus(), "занятый id при mode=create — 409");
        @SuppressWarnings("unchecked") Map<String, Object> body = (Map<String, Object>) r.getEntity();
        assertEquals("ID_TAKEN", body.get("error"));
        assertEquals(id, body.get("id"));
        assertTrue(String.valueOf(body.get("detail")).contains("mode=create"), "отказ объясняет флаг: " + body);
    }

    @Test
    void adrCreateOnlyOnTakenIdIsConflict() {
        Response r = wire(new LoreAdrResource(), exists(true)).createAdr(
            req(LoreAdrResource.AdrCreateRequest.class, Map.of("adr_id", "ADR-X-001", "name", "x")), "admin", "create");
        assertTaken(r, "ADR-X-001");
    }

    @Test
    void specCreateOnlyOnTakenIdIsConflict() {
        Response r = wire(new LoreSpecResource(), exists(true)).upsertSpec(
            req(LoreSpecResource.SpecUpsertRequest.class, Map.of("spec_id", "SPEC-X", "title", "x")), "admin", "create");
        assertTaken(r, "SPEC-X");
    }

    @Test
    void decisionCreateOnlyOnTakenIdIsConflict() {
        Response r = wire(new LoreDecisionResource(), exists(true)).createDecision(
            req(LoreDecisionResource.DecisionCreateRequest.class, Map.of("decision_id", "D-2026-X", "title", "x")), "admin", "create");
        assertTaken(r, "D-2026-X");
    }

    @Test
    void createOnlyHelperRules() {
        LoreAdrResource free = wire(new LoreAdrResource(), exists(false));
        assertNull(free.createOnly("adr", "ADR-NEW", "create"), "id свободен — создание идёт дальше");
        LoreAdrResource taken = wire(new LoreAdrResource(), exists(true));
        assertNull(taken.createOnly("adr", "ADR-X", null), "без флага — прежний upsert, проверки нет");
        assertNull(taken.createOnly("adr", "ADR-X", "upsert"), "явный upsert — тоже прежнее поведение");
        assertEquals(400, taken.createOnly("adr", "ADR-X", "replace").getStatus(), "неизвестный режим — 400, не молча upsert");
        LoreAdrResource broken = wire(new LoreAdrResource(), new LoreReadIdUnicodeTest.StubIngest((sql, p) -> {
            throw new RuntimeException("db down");
        }));
        assertEquals(502, broken.createOnly("adr", "ADR-X", "create").getStatus(),
            "не смогли проверить занятость — отказ, а не запись наугад");
        for (String t : List.of("adr", "spec", "decision", "task"))
            assertEquals(409, taken.createOnly(t, "ID-1", "create").getStatus(), t);
    }
}
