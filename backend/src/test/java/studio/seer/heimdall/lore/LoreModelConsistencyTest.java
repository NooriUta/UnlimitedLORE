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

    /**
     * D-2026-MIG-REPOSITORY-ORGANIZATION: рёбра репозитория живут в схеме, собранной из модели (MIG-01); в старой
     * схеме шагов V их нет. Сохранение модели на старой базе не должно из-за них отказывать (полный прогон 19.11:
     * LoreModelStoreLiveDbTest — 422 MODEL_INCONSISTENT на любой правке), а прочие пропавшие рёбра — называются.
     */
    @Test
    void edgesOfSchemaFromModelAreNotRefusedOnOldSchema() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon());
        Set<String> schema = new java.util.HashSet<>(edgesOf(c));
        schema.removeAll(Set.of("HAS_REPOSITORY", "COMPONENT_REPOSITORY", "MIRRORED_TO", "USES_REPOSITORY"));
        assertEquals(List.of(), LoreModelConsistency.problems(c, schema, null, SLICES));
        schema.remove("REFERENCES");
        assertFalse(LoreModelConsistency.problems(c, schema, null, SLICES).isEmpty(), "положительный контроль: прочее ребро называется");
    }

    /**
     * Правило, а не перечень (MDL-13: CI #1668 — LoreModelStoreLiveDbTest 422 на любой правке модели из-за ON_TRACK,
     * тот же класс, что у репозиториев 19.11): ребро паспорта, которого нет среди CREATE EDGE TYPE старой схемы
     * (LorePassportLinksContractTest.UNDECLARED_EDGES — схема из модели 1.18), обязано быть и в MODEL_SCHEMA_EDGES —
     * иначе сохранение модели на старой базе отказывает 422.
     */
    @Test
    void everyEdgeOutsideOldSchemaIsDeclaredAsModelSchemaEdge() throws Exception {
        Set<String> undeclared = LorePassportLinksContractTest.UNDECLARED_EDGES.keySet();
        assertTrue(undeclared.contains("HAS_REPOSITORY"), "положительный контроль: перечень прочитан");
        Set<String> missing = new java.util.TreeSet<>(undeclared);
        missing.removeAll(LoreModelConsistency.MODEL_SCHEMA_EDGES.keySet());
        assertEquals(Set.of(), missing, "ребро схемы из модели без пометки MODEL_SCHEMA_EDGES");
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon());
        Set<String> oldSchema = new java.util.HashSet<>(edgesOf(c));
        oldSchema.removeAll(undeclared);
        assertEquals(List.of(), LoreModelConsistency.problems(c, oldSchema, null, SLICES), "правка модели на старой базе не отказывает");
    }

    @Test
    void passportSlotWithoutSectionIsNamed() throws Exception {
        LoreModelFile.Content c = parse(LoreModelLiveReplaceTest.canon().replaceFirst(
            // Первый тип раздела passport — любой (MD-04: в каноне первым стал actor, а не adr).
            "\"passport\" : \\{\\s*\"(\\w+)\" : \\[ \\{", "\"passport\" : { \"$1\" : [ { \"key\" : \"призрак\", \"slot\" : \"own\" }, {"));
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
