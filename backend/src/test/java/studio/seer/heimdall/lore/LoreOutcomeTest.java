package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Словарь исходов записи (ADR-LORE-043). */
class LoreOutcomeTest {

    private static final Map<String, Object> BASE = Map.of("ok", true, "adr_id", "ADR-LORE-043");

    @Test
    void createdIsCreated() {
        assertEquals("created", LoreOutcome.link(BASE, true, false, "спринт").get("outcome"));
    }

    /**
     * Главное различие ADR-LORE-043. Оба случая сегодня выглядят как
     * {@code linked:false} с подсказкой «проверьте, что такие-то существуют»:
     * законную идемпотентность объявляют возможной ошибкой, а настоящую ошибку
     * — возможной нормой.
     */
    @Test
    void alreadyLinkedIsUnchangedNotAFailure() {
        Map<String, Object> r = LoreOutcome.link(BASE, false, true, "спринт");
        assertEquals("unchanged", r.get("outcome"));
        assertFalse(r.containsKey("reason"), "у законного исхода не бывает причины отказа");
    }

    @Test
    void missingEndpointIsNoopWithReason() {
        Map<String, Object> r = LoreOutcome.link(BASE, false, false, "спринт");
        assertEquals("noop", r.get("outcome"));
        assertTrue(String.valueOf(r.get("reason")).contains("спринт"),
            "причина обязана называть, ЧЕГО не нашли: " + r.get("reason"));
    }

    /** Снимать нечего — законно. Отказом это было бы только мешать повтору. */
    @Test
    void unlinkingWhatWasNotThereIsUnchanged() {
        assertEquals("unchanged", LoreOutcome.unlink(BASE, false).get("outcome"));
        assertEquals("deleted", LoreOutcome.unlink(BASE, true).get("outcome"));
    }

    /** Старые ключи остаются: outcome добавляется рядом, а не вместо. */
    @Test
    void existingKeysSurvive() {
        Map<String, Object> r = LoreOutcome.link(BASE, true, false, "спринт");
        assertEquals(true, r.get("ok"));
        assertEquals("ADR-LORE-043", r.get("adr_id"));
    }
}
