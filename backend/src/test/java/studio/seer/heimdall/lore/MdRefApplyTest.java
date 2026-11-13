package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** SPRINT_UXR_POLISH_UAT_1113/PU-20 — план пачки и отмена, без базы. */
class MdRefApplyTest {

    static final MdRefRules.Ctx CTX = MdRefCheckTest.CTX;

    @Test
    void planTakesOnlyWritableAndNotDiverged() {
        List<MdRefApply.Edit> p = MdRefApply.plan(List.of(
            new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "см. ADR-LORE-050", false, true),
            new MdRefCheck.Field("KnowTask", "SPRINT_B/PU-15", "note_md", "см. ADR-LORE-050", true, true),
            new MdRefCheck.Field("BragiInsight", "INS-1", "statement_md", "ADR-LORE-050", false, false)),
            CTX, Map.of(), MdRefRules.defaults());
        assertEquals(1, p.size());
        assertEquals("см. [[adr:ADR-LORE-050]]", p.get(0).after());
        assertEquals("см. ADR-LORE-050", p.get(0).before());
        assertEquals(List.of("shape"), p.get(0).rules());
    }

    @Test
    void planRespectsChosenRules() {
        List<MdRefCheck.Field> f = List.of(new MdRefCheck.Field("KnowTask", "SPRINT_A/PU-15", "note_md", "PU-09 и ADR-LORE-050", false, true));
        assertEquals("[[task:SPRINT_A/PU-09]] и ADR-LORE-050",
            MdRefApply.plan(f, CTX, Map.of(), Set.of("lone_own_sprint")).get(0).after());
        assertTrue(MdRefApply.plan(f, CTX, Map.of(), Set.of("typed")).isEmpty(), "нет включённых правил — нет правок");
    }

    @Test
    void unknownRuleIsNamed() {
        assertEquals("lone_everything", MdRefApply.unknownRule(List.of("shape", "lone_everything")));
        assertNull(MdRefApply.unknownRule(List.of("shape")));
        assertEquals(MdRefRules.defaults(), MdRefApply.rulesOf(List.of()));
    }

    @Test
    void undoWindowIsFifteenMinutesAndNeedsKnownBatch() {
        Instant t = Instant.parse("2026-11-13T15:00:00Z");
        String id = MdRefApply.batchId(t);
        assertNull(MdRefApply.undoError(id, t.plus(Duration.ofMinutes(14)), true));
        assertNotNull(MdRefApply.undoError(id, t.plus(Duration.ofMinutes(16)), true), "окно закрылось");
        assertNotNull(MdRefApply.undoError(id, t.plusSeconds(5), false), "после перезапуска пачка неизвестна — сказать");
        assertNotNull(MdRefApply.undoError("rb-123", t, true), "чужой id");
    }

    @Test
    void undoOnlyWhereNobodyEditedAfter() {
        MdRefApply.Edit e = new MdRefApply.Edit("KnowTask", "S/X", "note_md", "a", "[[b]]", List.of("shape"), 1);
        assertTrue(MdRefApply.undoable(e, "[[b]]"));
        assertFalse(MdRefApply.undoable(e, "[[b]] и правка человека"));
        assertFalse(MdRefApply.undoable(e, null));
    }
}
