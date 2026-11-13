package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;

/** MC-05 (SPEC-LORE-MODEL-CONFIG-STORE §4): правка модели, ломающая согласованность, называется словами. */
class LoreModelConsistencyTest {

    static final Predicate<String> SLICES = id -> LoreSlices.get(id) != null;

    static LoreModelFile.Content parse(String text) {
        return LoreModelFile.parse(text);
    }

    static Set<String> edgesOf(LoreModelFile.Content c) {
        Set<String> s = new java.util.HashSet<>();
        for (LoreRecordRegistry.TypeDef d : c.typeDefs().values())
            for (LoreRecordRegistry.Relation r : d.relations()) s.add(r.rel());
        return s;
    }

    @Test
    void canonIsConsistent() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon());
        assertEquals(List.of(), LoreModelConsistency.problems(c, edgesOf(c), null, SLICES), "положительный контроль: канон согласован");
    }

    @Test
    void unknownSliceOfAPartIsNamed() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon().replaceFirst("\"slice\" : \"phases_of_sprint\"", "\"slice\" : \"нет_такого_среза\""));
        List<String> p = LoreModelConsistency.problems(c, null, null, SLICES);
        assertEquals(1, p.size(), p.toString());
        assertTrue(p.get(0).contains("нет_такого_среза"), p.get(0));
    }

    @Test
    void edgeMissingFromSchemaIsNamed() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon());
        Set<String> schema = new java.util.HashSet<>(edgesOf(c));
        schema.remove("REFERENCES");
        List<String> p = LoreModelConsistency.problems(c, schema, null, SLICES);
        assertFalse(p.isEmpty());
        assertTrue(p.stream().allMatch(s -> s.contains("REFERENCES")), p.toString());
    }

    @Test
    void passportSlotWithoutSectionIsNamed() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon().replaceFirst(
            "\"passport\" : \\{\\s*\"adr\" : \\[ \\{", "\"passport\" : { \"adr\" : [ { \"key\" : \"призрак\", \"slot\" : \"own\" }, {"));
        List<String> p = LoreModelConsistency.problems(c, null, null, SLICES);
        assertEquals(1, p.size(), p.toString());
        assertTrue(p.get(0).contains("призрак"));
    }

    @Test
    void kindAgainstSchemaTypeIsNamedButExemptionsHold() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon());
        Map<String, Map<String, String>> declared = Map.of("KnowTask", Map.of("effort_days", "STRING"),
            "KnowSprint", Map.of("no_release_required", "BOOLEAN"));
        List<String> p = LoreModelConsistency.kindDrift(c, declared);
        assertEquals(1, p.size(), "исключение sprint.no_release соблюдено, effort ← STRING названо: " + p);
        assertTrue(p.get(0).startsWith("task.effort"), p.get(0));
    }
}
