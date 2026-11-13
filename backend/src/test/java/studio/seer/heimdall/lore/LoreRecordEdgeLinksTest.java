package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** MC-04 (PU-02): вкладка по ребру из модели — запрос из описаний реестра, концы разнородны, скоуп соблюдён. */
class LoreRecordEdgeLinksTest {

    static LoreRecordRegistry.Relation rel(String type, String key) {
        return LoreRecordRegistry.get(type).relations().stream().filter(r -> r.key().equals(key)).findFirst().orElseThrow();
    }

    @Test
    void sqlIsBuiltFromModelVertexKeyEdgeAndDirection() {
        String sql = LoreRecordEdgeLinks.sql("task", rel("task", "refsIn"));
        assertTrue(sql.contains("FROM (SELECT expand(in('REFERENCES')) FROM KnowTask WHERE task_uid = :id)"), sql);
        assertTrue(sql.contains("LIMIT " + (LoreRecordEdgeLinks.LIMIT + 1)), "лишняя строка — признак обрезки");
        String pub = LoreRecordEdgeLinks.sql("sprint", rel("sprint", "publications"));
        assertTrue(pub.contains("expand(in('PRODUCED_BY')) FROM KnowSprint WHERE sprint_id = :id"), pub);
    }

    @Test
    void everyEdgeTabOfEveryTypeHasAQuery() {
        LoreRecordValues.READ_BY_EDGE.forEach((type, keys) -> {
            for (String k : keys) assertDoesNotThrow(() -> LoreRecordEdgeLinks.sql(type, rel(type, k)), type + "." + k);
        });
    }

    @Test
    void rowsBecomeLinksWithKindOfTheEndAndScopeIsApplied() {
        List<Map<String, Object>> rows = List.of(
            Map.of("end_vertex", "KnowADR", "end_id", "ADR-1", "end_title", "решение", "end_status", "ACCEPTED",
                "end_projects", List.of("AIDA/UnlimitedLORE")),
            Map.of("end_vertex", "KnowSpec", "end_id", "SPEC-TECH-CMP-X", "end_title", "технология",
                "end_projects", List.of("other/repo")),
            Map.of("end_vertex", "KnowTask", "end_title", "без ключа"));
        LoreRecordRegistry.Relation r = rel("task", "refsIn");
        List<Map<String, Object>> all = LoreRecordEdgeLinks.links(r, rows, null);
        assertEquals(List.of("ADR-1", "SPEC-TECH-CMP-X"), all.stream().map(l -> l.get("id")).toList(),
            "строка без ключа не становится связью");
        assertEquals("adr", all.get(0).get("type"));
        assertEquals("accepted", all.get(0).get("status"));
        assertEquals("tech", all.get(1).get("type"), "спека SPEC-TECH-* — паспорт технологии");
        assertEquals("REFERENCES", all.get(0).get("rel"));
        assertEquals("in", all.get(0).get("dir"));
        List<Map<String, Object>> scoped = LoreRecordEdgeLinks.links(r, rows, Set.of("AIDA/UnlimitedLORE"));
        assertEquals(List.of("ADR-1"), scoped.stream().map(l -> l.get("id")).toList(), "конец вне скоупа не показан");
    }

    @Test
    void unknownVertexKeepsItsClassNameNotAGuess() {
        assertEquals("BragiCampaign", LoreRecordEdgeLinks.kindOf("BragiCampaign", "C-1"));
        assertEquals("publication", LoreRecordEdgeLinks.kindOf("BragiPublication", "P-1"));
    }
}
