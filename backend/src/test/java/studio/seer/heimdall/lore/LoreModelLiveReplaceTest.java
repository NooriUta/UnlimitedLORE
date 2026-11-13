package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-05 (SPEC-LORE-MODEL-CONFIG-STORE §3): правка модели применяется без
 * рестарта — реестр паспорта, типы модели и поверхность паспорта читают ТЕКУЩЕЕ содержимое, а не
 * снимок, сделанный при загрузке класса.
 */
class LoreModelLiveReplaceTest {

    static String canon() throws Exception {
        return Files.readString(LoreModelFileTest.CANON, StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    @AfterEach
    void restore() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(canon()));
    }

    @Test
    void replacedContentIsSeenByRegistryWithoutRestart() throws Exception {
        assertEquals("Спринт", LoreRecordRegistry.get("sprint").label(), "положительный контроль: подпись из файла");
        String edited = canon().replaceFirst("\"label\" : \"Спринт\"", "\"label\" : \"Спринт-правка\"");
        LoreModelFile.replace(LoreModelFile.parse(edited));
        assertEquals("Спринт-правка", LoreRecordRegistry.get("sprint").label(), "реестр видит правку без перезагрузки класса");
        assertEquals("Спринт-правка", LoreRecordRegistry.schemaJson("sprint").get("label"));
    }

    @Test
    void staticViewsFollowTheCurrentContent() throws Exception {
        String edited = canon().replaceFirst("\"read_only\" : \\[ ", "\"read_only\" : [ \"sprint\", ");
        LoreModelFile.replace(LoreModelFile.parse(edited));
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("sprint"), "READ_ONLY — представление текущей модели, не снимок");
        assertTrue(Set.copyOf(LoreRecordRegistry.TYPES).contains("sprint"));
    }

    /** Вкладка без строки и без среза читается по ребру — список выводится из модели, а не ведётся руками. */
    @Test
    void readByEdgeIsDerivedFromTheModel() {
        assertEquals(Set.of("refsOut", "refsIn"), LoreRecordValues.readByEdge("spec"));
        assertTrue(LoreRecordValues.readByEdge("task").containsAll(Set.of("qgRecs", "insights", "publications")));
        assertTrue(LoreRecordValues.readByEdge("milestone").isEmpty(), "у вехи всё читается строкой — по ребру нечего");
    }
}
