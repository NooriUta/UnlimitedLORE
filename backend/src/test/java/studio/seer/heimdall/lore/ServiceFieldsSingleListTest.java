package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-10, п.2 (решение владельца 25.11.2026: «2а, отдельно shared tech columns»).
 *
 * <p>Служебные колонки жили в трёх местах: service_fields модели, жёсткий список в LoreModelTypes.isInternal и
 * LoreRecordUnmodeled.SERVICE. Списки разошлись: created_at/updated_at были «служебными» для блока «не описано в
 * модели» паспорта, но не для админки «Модель», и она показывала их у 19 типов как неописанные (диагностика 24.11).
 *
 * <p>Правило: служебная колонка объявлена в одном месте — service_fields модели, с причиной; код читает только его.
 */
class ServiceFieldsSingleListTest {

    /** Всё, что код раньше считал служебным своими списками, плюс version (ADR-LORE-047 A3) — из диагностики 24.11. */
    static final List<String> FORMER_CODE_LISTS = List.of(
        // LoreModelTypes.isInternal
        "bookkeeping", "kc_sub", "pr_id", "changed_by", "changed_by_kind", "changed_by_session", "changed_by_harness",
        "changed_by_harness_note", "changed_by_machine", "change_reason", "status_backfilled", "status_known_from",
        "status_category", "valid_from", "source_commit", "row_version",
        // LoreRecordUnmodeled.SERVICE
        "valid_to", "state_uid", "content_hash", "hist_for", "created_at", "updated_at", "origin",
        // диагностика KREG-10
        "version");

    @Test
    void everyServiceColumnIsDeclaredInTheModelWithReason() {
        Map<String, String> sf = LoreModelFile.content().serviceFields();
        List<String> missing = new ArrayList<>();
        for (String p : FORMER_CODE_LISTS)
            if (sf.get(p) == null || sf.get(p).isBlank()) missing.add(p);
        assertEquals(List.of(), missing, "служебная колонка без объявления (с причиной) в service_fields модели");
    }

    @Test
    void adminModelTreatsTimestampsAsServiceNotUnclassified() {
        // Именно то, на что ругалась админка: created_at/updated_at/version — «неописанные» у 19 типов.
        for (String p : List.of("created_at", "updated_at", "version"))
            assertTrue(LoreModelTypes.isInternal(p, "sprint_id"), p + " — служебная колонка, а не unclassified");
    }

    @Test
    void codeHasNoSecondListOfItsOwn() {
        // Положительный контроль единого источника: свойство, которого нет в service_fields и которое не *_uid,
        // код служебным не считает — значит, своего списка у него больше нет.
        assertFalse(LoreModelTypes.isInternal("goal", "sprint_id"));
        assertFalse(LoreRecordUnmodeled.SERVICE.contains("goal"));
        assertTrue(LoreModelTypes.isInternal("state_uid", "sprint_id"), "*_uid — правило по имени, не список");
        for (String p : LoreRecordUnmodeled.SERVICE)
            assertTrue(LoreModelFile.content().serviceFields().containsKey(p), p + ": SERVICE в коде шире модели");
    }

    @Test
    void ownKeyIsNeverService() {
        assertFalse(LoreModelTypes.isInternal("created_at", "created_at"), "ключ записи не прячется, даже если совпал по имени");
    }
}
