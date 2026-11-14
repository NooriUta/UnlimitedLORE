package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_AGENT_OBSERVABILITY/AO-02 — след источников «к сущности»: при создании записи агент
 * шлёт, что читал перед этим, бэкенд пишет рёбра SOURCED_FROM (за флагом, по умолчанию ВЫКЛ).
 * Без живой базы: ребро в V87, отбор следа (шум), SQL ребра, флаг.
 */
class AgentSourceTrailTest {

    private static final Set<String> KNOWN = Set.of("adr", "decision", "spec", "task");
    private static AgentSourceTrail.Ref r(String type, String id) { return new AgentSourceTrail.Ref(type, id, "adr"); }

    @Test
    void edgeTypeIsCreatedInV87WithItsProperties() {
        LoreSchemaMigrations.Step v87 = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.version() == 87).findFirst().orElseThrow();
        assertEquals(AgentSourceTrail.DDL, v87.sql(), "ребро — своим шагом: V86 влит, его SQL не меняется");
        assertEquals(17, v87.compatMajor());
        assertTrue(AgentSourceTrail.DDL.contains("CREATE EDGE TYPE SOURCED_FROM IF NOT EXISTS"));
        assertTrue(AgentSourceTrail.DDL.stream().anyMatch(s -> s.startsWith("CREATE PROPERTY SOURCED_FROM.at IF NOT EXISTS")));
        assertTrue(AgentSourceTrail.DDL.stream().anyMatch(s -> s.startsWith("CREATE PROPERTY SOURCED_FROM.via IF NOT EXISTS")));
    }

    @Test
    void flagIsOffByDefault() {
        assertEquals("lore.agent.sources.enabled", AgentSourceTrail.FLAG);
        assertFalse(AgentSourceTrail.DEFAULT_ENABLED, "включение в проде — решение владелицы");
    }

    @Test
    void trailKeepsTheLastDistinctReadsOnly() {
        List<AgentSourceTrail.Ref> reads = List.of(r("adr", "A1"), r("spec", "S1"), r("adr", "A1"),
            r("decision", "D1"), r("task", "T1"));
        List<AgentSourceTrail.Ref> plan = AgentSourceTrail.plan(r("adr", "NEW"), reads, KNOWN, 3);
        assertEquals(List.of("T1", "D1", "A1"), plan.stream().map(AgentSourceTrail.Ref::id).toList(),
            "свежие первыми, без повторов, не больше порога");
    }

    @Test
    void trailDropsTheEntityItselfUnknownTypesAndBlanks() {
        List<AgentSourceTrail.Ref> reads = List.of(r("adr", "NEW"), r("bragi_rubric", "R1"), r("spec", " "),
            r(null, "X"), r("spec", "S1"));
        List<AgentSourceTrail.Ref> plan = AgentSourceTrail.plan(r("adr", "NEW"), reads, KNOWN, 10);
        assertEquals(List.of("S1"), plan.stream().map(AgentSourceTrail.Ref::id).toList());
    }

    @Test
    void noReadsIsNoTrailAndNotAnError() {
        assertEquals(List.of(), AgentSourceTrail.plan(r("adr", "NEW"), List.of(), KNOWN, 10));
        assertEquals(List.of(), AgentSourceTrail.plan(r("adr", "NEW"), null, KNOWN, 10));
    }

    @Test
    void edgeSqlBindsIdsAndIsIdempotent() {
        String sql = AgentSourceTrail.edgeSql(new LoreModelTypes.Graph("KnowADR", "KnowADRHist", "adr_id"),
            new LoreModelTypes.Graph("KnowSpec", "KnowSpecHist", "spec_id"));
        assertEquals("CREATE EDGE SOURCED_FROM FROM (SELECT FROM KnowADR WHERE adr_id = :tid) "
            + "TO (SELECT FROM KnowSpec WHERE spec_id = :sid) IF NOT EXISTS SET at = :at, via = :via", sql);
    }

    @Test
    void ceilingIsBoundedEvenIfConfiguredHuge() {
        assertEquals(AgentSourceTrail.HARD_MAX, AgentSourceTrail.ceiling(10_000));
        assertEquals(1, AgentSourceTrail.ceiling(0));
        assertEquals(7, AgentSourceTrail.ceiling(7));
    }
}
