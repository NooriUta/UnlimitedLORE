package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 — полный ISO-момент у дат создания ADR,
 * решений и у даты релиза. Правило: момент пишется, только когда он ИЗВЕСТЕН;
 * дату в прошлом без времени не «дополняем» текущими часами.
 */
class CreationMomentTest {

    private static final Instant NOW = Instant.parse("2026-11-07T21:14:05.123Z");

    @Test
    void noDateGiven_dateIsTodayAndMomentIsNow() {
        CreationMoment.Resolved r = CreationMoment.resolve(null, NOW);
        assertEquals("2026-11-07", r.date());
        assertEquals("2026-11-07T21:14:05.123Z", r.moment());
    }

    @Test
    void isoInstantGiven_dateIsItsUtcDayAndMomentIsIt() {
        CreationMoment.Resolved r = CreationMoment.resolve("2026-10-30T23:30:00+03:00", NOW);
        assertEquals("2026-10-30", r.date(), "UTC-день момента");
        assertEquals("2026-10-30T20:30:00Z", r.moment());
    }

    @Test
    void todaysDateGiven_momentIsNow() {
        CreationMoment.Resolved r = CreationMoment.resolve("2026-11-07", NOW);
        assertEquals("2026-11-07", r.date());
        assertEquals("2026-11-07T21:14:05.123Z", r.moment());
    }

    @Test
    void pastDateGiven_keepsDateAndLeavesTimeUnknown() {
        // Положительный контроль честности: дата в прошлом — время НЕ выдумывается.
        CreationMoment.Resolved r = CreationMoment.resolve("2026-07-02", NOW);
        assertEquals("2026-07-02", r.date());
        assertNull(r.moment(), "время неизвестно — момента нет");
    }

    @Test
    void freeTextDateGiven_keptAsIsTimeUnknown() {
        CreationMoment.Resolved r = CreationMoment.resolve("июль 2026", NOW);
        assertEquals("июль 2026", r.date());
        assertNull(r.moment());
    }

    @Test
    void read_momentPresent_isKnown() {
        Map<String, Object> row = new HashMap<>();
        row.put("date_created", "2026-11-07");
        row.put("created_at", "2026-11-07T21:14:05.123Z");
        CreationMoment.Read r = CreationMoment.read(row, "date_created", "created_at");
        assertTrue(r.timeKnown());
        assertEquals(Instant.parse("2026-11-07T21:14:05.123Z"), r.moment());
        assertEquals("2026-11-07", r.date());
    }

    @Test
    void read_legacyDateOnly_isMarkedTimeUnknownNotMidnight() {
        Map<String, Object> row = new HashMap<>();
        row.put("date_created", "2026-07-02");
        CreationMoment.Read r = CreationMoment.read(row, "date_created", "created_at");
        assertFalse(r.timeKnown(), "старая запись — «время неизвестно»");
        assertNull(r.moment(), "не полночь, а отсутствие момента");
        assertEquals("2026-07-02", r.date());
    }

    @Test
    void migrationDeclaresMomentFieldsAndSpecHistVersion() {
        LoreSchemaMigrations.Step s = LoreSchemaMigrations.STEPS.stream()
            .filter(x -> x.name().equals("creation_moment_and_spec_hist_version")).findFirst().orElseThrow();
        assertTrue(s.version() > 68, "после шагов батча S2 и S2-13: V" + s.version());
        String all = String.join("\n", s.sql());
        for (String p : new String[]{"KnowADR.created_at", "KnowDecision.created_at",
                "KnowRelease.released_at", "KnowSpecHist.version"})
            assertTrue(all.contains("CREATE PROPERTY " + p + " IF NOT EXISTS STRING"), p + " не объявлено: " + all);
    }

    @Test
    void fieldsRegistryCoversAdrDecisionRelease() {
        assertEquals("created_at", CreationMoment.FIELDS.get("KnowADR"));
        assertEquals("created_at", CreationMoment.FIELDS.get("KnowDecision"));
        assertEquals("released_at", CreationMoment.FIELDS.get("KnowRelease"));
    }
}
