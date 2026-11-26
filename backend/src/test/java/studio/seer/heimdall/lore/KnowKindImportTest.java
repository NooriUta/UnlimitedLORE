package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-09 (OQ-064-KNOWKIND-IMPORT) — план build-time импорта KnowKind: идемпотентен
 * по kind, двойник — отказ, снятые виды не удаляются молча; выдача генератора в ресурсах читается импортом.
 */
class KnowKindImportTest {

    static final Set<String> MANAGED = KnowRegistrySync.MANAGED;

    static List<Map<String, Object>> desired() {
        return KnowRegistryGeneratorTest.run().kinds();
    }

    @Test
    void firstImportInsertsEverything() {
        KnowKindImport.Plan p = KnowKindImport.plan(Map.of(), desired(), MANAGED);
        assertEquals(desired().size(), p.inserts().size());
        assertTrue(p.updates().isEmpty() && p.unchanged().isEmpty() && p.stale().isEmpty());
    }

    /** Повторный прогон с тем же входом — ноль записей (идемпотентность по kind + content_hash). */
    @Test
    void secondImportIsANoop() {
        Map<String, String> db = new HashMap<>();
        for (Map<String, Object> k : desired()) db.put((String) k.get("kind"), (String) k.get("content_hash"));
        KnowKindImport.Plan p = KnowKindImport.plan(db, desired(), MANAGED);
        assertTrue(p.isNoop(), "повтор импорта писал бы: " + p.inserts().size() + "/" + p.updates().size());
        assertEquals(desired().size(), p.unchanged().size());
    }

    @Test
    void changedKindGetsANewVersionAndRemovedKindIsOnlyReported() {
        Map<String, String> db = new HashMap<>();
        for (Map<String, Object> k : desired()) db.put((String) k.get("kind"), (String) k.get("content_hash"));
        db.put("entity:sprint", "sha256:old");
        db.put("slice:zz_retired", "sha256:x");
        db.put("custom:list_issues", "sha256:y");
        KnowKindImport.Plan p = KnowKindImport.plan(db, desired(), MANAGED);
        assertEquals(List.of("entity:sprint"), p.updates().stream().map(k -> k.get("kind")).toList());
        assertEquals(List.of("slice:zz_retired"), p.stale(), "чужие виды (вне MANAGED; forgejo:* с FJ-01 — свои) импорт не считает своими");
    }

    @Test
    void duplicateKindInInputFailsTheRun() {
        List<Map<String, Object>> twice = new java.util.ArrayList<>(desired());
        twice.add(desired().get(0));
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> KnowKindImport.plan(Map.of(), twice, MANAGED));
        assertTrue(e.getMessage().contains(String.valueOf(desired().get(0).get("kind"))));
    }

    /** Импорт берёт выдачу генератора из classpath — тот же текст, что в репозитории. */
    @Test
    void artifactOnClasspathIsTheCommittedOne() throws Exception {
        String committed = Files.readString(KnowRegistryInputs.ARTIFACT, StandardCharsets.UTF_8).replace("\r\n", "\n");
        assertEquals(committed, KnowRegistrySync.artifactText().replace("\r\n", "\n"));
        assertEquals(desired().size(), KnowRegistrySync.artifactKinds().size());
    }

    /** Колонки вершины — ровно DDL V94: импорт не пишет в KnowKind свойств вне схемы. */
    @Test
    void vertexColumnsAreTheV94Ddl() {
        Map<String, String> v94 = KnowRegistryInputs.ddlTyped().get("KnowKind");
        assertNotNull(v94);
        assertEquals(new java.util.TreeSet<>(v94.keySet()), new java.util.TreeSet<>(KnowKindImport.COLUMNS));
        Map<String, Object> row = KnowRegistrySync.vertexRow(desired().get(0));
        assertTrue(KnowKindImport.COLUMNS.containsAll(row.keySet()), row.keySet().toString());
    }
}
