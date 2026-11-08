package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S2_GRAPH_MEMORY/S2-05 — «что LORE помнит обо мне», чистые правила
 * без живой базы: шаг схемы (аддитивно, вслед за S2-04), белый список видов
 * памяти, проверка привычки, идентификаторы записей памяти, срок хранения и
 * правило доступа «только сам и его агенты».
 */
class LoreMemoryTest {

    // ── Схема ───────────────────────────────────────────────────────────────

    @Test
    void schemaStepFollowsViewsStepAndIsAdditive() {
        LoreSchemaMigrations.Step views = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("user_views_prefs")).findFirst().orElseThrow();
        LoreSchemaMigrations.Step step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.name().equals("user_memory")).findFirst().orElseThrow(
                () -> new AssertionError("шаг схемы user_memory не зарегистрирован"));
        assertTrue(step.version() > views.version(), "миграция памяти идёт вслед за видами S2-04");
        assertEquals(17, step.compatMajor(), "аддитивно: major не поднимается, v1 переживает");
        for (String sql : step.sql()) {
            assertTrue(sql.startsWith("CREATE VERTEX TYPE") || sql.startsWith("CREATE PROPERTY")
                    || sql.startsWith("CREATE INDEX"), "только аддитивный DDL: " + sql);
            assertTrue(sql.contains("IF NOT EXISTS"), "идемпотентно: " + sql);
            assertTrue(sql.matches(".*\\b(KnowUserHabit|KnowUserMemoryPref|KnowUserRecent)\\b.*"),
                "шаг трогает только типы личной памяти: " + sql);
        }
        String all = String.join("\n", step.sql());
        assertTrue(all.contains("ON KnowUserHabit (owner_sub, kind, habit_key) UNIQUE"), all);
        assertTrue(all.contains("ON KnowUserHabit (memory_id) UNIQUE"), all);
        assertTrue(all.contains("ON KnowUserMemoryPref (owner_sub) UNIQUE"), all);
        List<String> types = LoreSchemaMigrations.requiredLiveTypes();
        for (String t : List.of("KnowUserHabit", "KnowUserMemoryPref"))
            assertTrue(types.contains(t), "тип " + t + " обязан сверяться на старте");
    }

    // ── Виды памяти — те же, что в контракте S2-01 (MEMORY_KINDS) ──────────

    @Test
    void kindsMatchContract() {
        assertEquals(List.of("frequent_views", "frequent_slices", "recent_records"), LoreMemory.KINDS);
        assertEquals(90, LoreMemory.RETENTION_DAYS);
        assertEquals("self_and_own_agents", LoreMemory.ACCESS);
        assertTrue(LoreMemory.HABIT_KINDS.containsAll(List.of("frequent_views", "frequent_slices")));
        assertFalse(LoreMemory.HABIT_KINDS.contains("recent_records"),
            "недавние живут в KnowUserRecent (S2-04), а не в привычках");
    }

    // ── Привычка ────────────────────────────────────────────────────────────

    @Test
    void hitValidation() {
        assertNull(LoreMemory.validateHit("frequent_views", "view-123e4567", null));
        assertNull(LoreMemory.validateHit("frequent_slices", "tasks?status=open&mine=1", "Мои"));
        assertNull(LoreMemory.validateHit("frequent_slices", "adrs", null), "раздел без запроса — тоже срез");

        assertNotNull(LoreMemory.validateHit("recent_records", "adr:ADR-1", null),
            "недавние пишутся через /lore/me/recent, не через привычки");
        assertNotNull(LoreMemory.validateHit("bogus", "x", null));
        assertNotNull(LoreMemory.validateHit(null, "x", null));
        assertNotNull(LoreMemory.validateHit("frequent_views", "", null));
        assertNotNull(LoreMemory.validateHit("frequent_views", "not a view id", null));
        assertNotNull(LoreMemory.validateHit("frequent_slices", "Bad Section?x=1", null));
        assertNotNull(LoreMemory.validateHit("frequent_slices", "tasks?" + "x".repeat(LoreMePrefs.QUERY_MAX + 1), null));
        assertNotNull(LoreMemory.validateHit("frequent_slices", "tasks", "л".repeat(LoreMePrefs.NAME_MAX + 1)));
    }

    // ── Идентификатор записи памяти ─────────────────────────────────────────

    @Test
    void recentMemoryIdRoundTrips() {
        String id = LoreMemory.recentMemoryId("task", "SPRINT_X/CO-11");
        assertEquals("recent:task:SPRINT_X/CO-11", id);
        LoreMemory.RecentRef r = LoreMemory.parseRecentMemoryId(id);
        assertNotNull(r);
        assertEquals("task", r.type());
        assertEquals("SPRINT_X/CO-11", r.id());
        assertNull(LoreMemory.parseRecentMemoryId("mem-abc"));
        assertNull(LoreMemory.parseRecentMemoryId("recent:"));
        assertNull(LoreMemory.parseRecentMemoryId("recent:Bad Type:x"));
        assertNull(LoreMemory.parseRecentMemoryId(null));
    }

    @Test
    void habitMemoryIdShape() {
        String id = LoreMemory.newHabitId();
        assertTrue(LoreMemory.HABIT_ID.matcher(id).matches(), id);
        assertNotEquals(id, LoreMemory.newHabitId());
    }

    // ── Срок хранения ───────────────────────────────────────────────────────

    @Test
    void retentionCutoffIsNinetyDaysBackAndFixedWidth() {
        Instant now = Instant.parse("2026-11-07T12:00:00Z");
        String cut = LoreMemory.cutoff(now);
        assertEquals("2026-08-09T12:00:00.000000Z", cut);
        assertTrue(LoreMemory.fresh("2026-08-09T12:00:00.000001Z", cut));
        assertFalse(LoreMemory.fresh("2026-08-09T11:59:59.999999Z", cut), "старше срока — стирается");
        assertFalse(LoreMemory.fresh(null, cut), "без метки времени — не храним бессрочно");
    }

    // ── Доступ: сам пользователь и его агенты; admin — нет ─────────────────

    @Test
    void accessIsSelfOnly() {
        assertTrue(LoreMemory.canRead("sub-a", "sub-a"));
        assertFalse(LoreMemory.canRead("sub-b", "sub-a"));
        assertFalse(LoreMemory.canRead(null, "sub-a"), "не опознан — не читает ничью память");
        assertFalse(LoreMemory.canRead("sub-a", null));
    }
}
