package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Статус по умолчанию при создании — первый статус справочника типа.
 *
 * <p>Слова владелицы 16.11.2026: «для спринтов и задач верно, для остальных по аналогии выбирать первый
 * статус и делать статусом по умолчанию». До правки: ADR без статуса рождался «предложен» (не первый —
 * первый «черновик»), решение и спека — вовсе без статуса, гейт качества — «задуман» своей строкой,
 * фаза — «запланирована» (первый — «бэклог»).
 */
class CreateDefaultStatusTest {

    /** Первые значения справочников по sort_order — прод, срез KnowDictEntry 16.11.2026. */
    static final Map<String, String> FIRST_ON_PROD = Map.of(
        "adr", "DRAFT", "decision", "proposed", "spec", "proposed",
        "quality_gate", "draft", "phase", "backlog");

    @Test
    void defaultIsTheFirstStatusOfTheTypeDictionary() {
        assertEquals(FIRST_ON_PROD, CreateDefaultStatus.FIRST);
    }

    @Test
    void givenStatusWinsMissingBecomesFirst() {
        for (String missing : new String[] {null, "", "  "}) {
            assertEquals("DRAFT", CreateDefaultStatus.forNew("adr", missing));
            assertEquals("proposed", CreateDefaultStatus.forNew("decision", missing));
            assertEquals("backlog", CreateDefaultStatus.forNew("phase", missing));
        }
        assertEquals("ACCEPTED", CreateDefaultStatus.forNew("adr", "ACCEPTED"));
        assertThrows(IllegalArgumentException.class, () -> CreateDefaultStatus.forNew("нет-такого", null));
    }

    @Test
    void phaseRawIsTheBacklogRawForm() {
        assertEquals("🟣 BACKLOG", CreateDefaultStatus.phaseRaw());
    }

    /** Сторож: каждый путь создания берёт статус по умолчанию отсюда, а не своей строкой. */
    @Test
    void everyCreatePathUsesIt() throws Exception {
        Path src = Path.of("src/main/java/studio/seer/heimdall/lore");
        for (String f : new String[] {"LoreAdrResource.java", "LoreDecisionResource.java", "LoreSpecResource.java",
                "QgGateLifecycle.java", "LoreSprintTaskResource.java"}) {
            String s = Files.readString(src.resolve(f));
            assertTrue(s.contains("CreateDefaultStatus."), f + ": статус по умолчанию — из CreateDefaultStatus");
        }
        String adr = Files.readString(src.resolve("LoreAdrResource.java"));
        assertFalse(adr.contains("(isNewAdr ? \"PROPOSED\" : null)"), "ADR больше не рождается «предложен» по умолчанию");
        String phase = Files.readString(src.resolve("LoreSprintTaskResource.java"));
        assertFalse(phase.contains("INSERT INTO KnowPhaseHist SET state_uid = :nsid, status_raw = '📋 PLANNED'"), "фаза — с первого статуса");
    }
}
