package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-08 — флаги LORE в админке: белый список булевых флагов
 * с умолчанием, текущим значением и пометкой «переопределён». Секреты не попадают.
 */
class LoreAdminFlagsTest {

    @Test
    void knownFlagsAreListedWithDefaultsAndMeaning() {
        List<String> keys = LoreAdminFlags.FLAGS.stream().map(LoreAdminFlags.Flag::key).toList();
        assertTrue(keys.containsAll(List.of("lore.scope.enforce", "lore.scope.redact-bodies", "lore.stats.enabled")), keys.toString());
        for (LoreAdminFlags.Flag f : LoreAdminFlags.FLAGS) {
            assertTrue(f.key().startsWith("lore."), f.key());
            assertFalse(f.meaning().isBlank(), "у флага " + f.key() + " есть пояснение");
            assertFalse(f.key().contains("secret") || f.key().contains("password") || f.key().contains("token"),
                "в списке только флаги, не секреты: " + f.key());
        }
    }

    @Test
    void overriddenIsMarked() {
        Map<String, Object> row = LoreAdminFlags.row(new LoreAdminFlags.Flag("lore.x", false, "смысл"), true);
        assertEquals(true, row.get("value"));
        assertEquals(false, row.get("default"));
        assertEquals(true, row.get("overridden"));
        assertEquals(false, LoreAdminFlags.row(new LoreAdminFlags.Flag("lore.x", false, "смысл"), false).get("overridden"));
    }
}
