package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S7B_ADMIN/S7B-ACT-1 — порог активности машины и harness (1..24 ч): поле в графе,
 * чтение срезами machine_acl / agent_owners, запись владельцем машины или admin. Чистый JUnit.
 *
 * <p>Слово владелицы 11.11: «считать активной в течении — от часа после последнего вызова до суток».
 */
class MachineActivityTest {

    private static final List<String> HARNESSES = List.of("claude-code", "kimi-code", "dsh");

    private static Map<String, Integer> map(Object... kv) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], (Integer) kv[i + 1]);
        return m;
    }

    // ── миграция ───────────────────────────────────────────────────────────

    @Test
    void schemaStep81_isRegistered_additive_onMachineActor() {
        var step = LoreSchemaMigrations.STEPS.stream()
            .filter(s -> s.sql() == MachineActivity.SCHEMA_SQL).findFirst()
            .orElseThrow(() -> new AssertionError("шага миграции с MachineActivity.SCHEMA_SQL нет"));
        assertEquals(81, step.version());
        assertEquals(17, step.compatMajor(), "аддитивно, major 17");
        assertTrue(LoreSchemaMigrations.STEPS.get(LoreSchemaMigrations.STEPS.size() - 1).version() >= 81, "V81 зарегистрирован, после него могут идти новые шаги");
        assertTrue(MachineActivity.SCHEMA_SQL.contains("CREATE PROPERTY KnowActor.activity_window_h IF NOT EXISTS INTEGER"));
        assertTrue(MachineActivity.SCHEMA_SQL.contains("CREATE PROPERTY KnowActor.activity_window_harness IF NOT EXISTS MAP"));
        for (String ddl : MachineActivity.SCHEMA_SQL) {
            String u = ddl.toUpperCase();
            assertFalse(u.startsWith("DROP") || u.startsWith("DELETE") || u.startsWith("ALTER"), ddl);
            assertTrue(u.contains("IF NOT EXISTS"), "идемпотентно: " + ddl);
        }
    }

    // ── чтение срезами ─────────────────────────────────────────────────────

    @Test
    void slices_machineAclAndAgentOwners_readTheWindow() {
        for (String id : List.of("machine_acl", "agent_owners")) {
            String sql = LoreSlices.get(id).baseSql();
            assertTrue(sql.contains("activity_window_h"), id + ": окно машины");
            assertTrue(sql.contains("activity_window_harness"), id + ": окна по harness");
        }
        assertTrue(LoreSlices.get("agent_owners").baseSql().contains("in('LOGGED_BY').last_activity_at AS session_activity"),
            "agent_owners: когда агент был на связи — по его сессиям");
        assertTrue(LoreSlices.get("agent_owners").baseSql().contains(MachineActivity.DEFAULT_H + " AS activity_default_h"),
            "agent_owners: общий дефолт называет сервер, клиент его не угадывает");
    }

    // ── правило «какое окно действует» ────────────────────────────────────

    @Test
    void effective_harnessOverride_thenMachine_thenDefault() {
        var s = new MachineActivity.Setting(6, map("dsh", 24));
        assertEquals(24, MachineActivity.effective(s, "dsh").hours());
        assertEquals("harness", MachineActivity.effective(s, "dsh").basis());
        assertEquals(6, MachineActivity.effective(s, "claude-code").hours());
        assertEquals("machine", MachineActivity.effective(s, "claude-code").basis());
        assertEquals(6, MachineActivity.effective(s, null).hours());
        var none = new MachineActivity.Setting(null, Map.of());
        assertEquals(MachineActivity.DEFAULT_H, MachineActivity.effective(none, "dsh").hours());
        assertEquals("default", MachineActivity.effective(none, "dsh").basis());
        assertEquals(MachineActivity.DEFAULT_H, MachineActivity.effective(null, null).hours());
    }

    @Test
    void active_withinWindow_inclusive() {
        assertTrue(MachineActivity.active(60L, 1), "ровно час при окне 1 ч — ещё активна («≤ окна»)");
        assertFalse(MachineActivity.active(61L, 1));
        assertTrue(MachineActivity.active(24L * 60, 24));
        assertFalse(MachineActivity.active(null, 24), "отметки нет — не «активна»");
    }

    @Test
    void settingOf_readsSliceRow_numbersAndMap_garbageIgnored() {
        Map<String, Object> row = new HashMap<>();
        row.put("activity_window_h", 3L);
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("dsh", 12);
        h.put("bad", "x");
        row.put("activity_window_harness", h);
        var s = MachineActivity.settingOf(row);
        assertEquals(3, s.windowH());
        assertEquals(Map.of("dsh", 12), s.harness());
        var empty = MachineActivity.settingOf(Map.of());
        assertNull(empty.windowH());
        assertTrue(empty.harness().isEmpty());
    }

    // ── запрос записи ─────────────────────────────────────────────────────

    @Test
    void requestError_rangeOneToTwentyFour_harnessFromDictionary() {
        assertNull(MachineActivity.requestError(new MachineActivity.Request("lorcetus", 3, map("dsh", 24), null), HARNESSES));
        assertNull(MachineActivity.requestError(new MachineActivity.Request("lorcetus", null, null, true), HARNESSES),
            "всё пусто — сброс к общему дефолту, законно");
        assertNotNull(MachineActivity.requestError(null, HARNESSES));
        assertNotNull(MachineActivity.requestError(new MachineActivity.Request(null, 3, null, null), HARNESSES));
        assertNotNull(MachineActivity.requestError(new MachineActivity.Request("bad/name", 3, null, null), HARNESSES));
        assertTrue(MachineActivity.requestError(new MachineActivity.Request("m", 0, null, null), HARNESSES).contains("1..24"));
        assertTrue(MachineActivity.requestError(new MachineActivity.Request("m", 25, null, null), HARNESSES).contains("1..24"));
        assertTrue(MachineActivity.requestError(new MachineActivity.Request("m", null, map("dsh", 48), null), HARNESSES).contains("1..24"));
        assertTrue(MachineActivity.requestError(new MachineActivity.Request("m", null, map("vim", 2), null), HARNESSES).contains("vim"));
        Map<String, Integer> nullValue = new HashMap<>();
        nullValue.put("dsh", null);
        assertNotNull(MachineActivity.requestError(new MachineActivity.Request("m", null, nullValue, null), HARNESSES));
    }

    @Test
    void plan_beforeAfter_unchangedWhenSame_harnessOrderIrrelevant() {
        var before = new MachineActivity.Setting(3, map("dsh", 12, "kimi-code", 6));
        var same = new MachineActivity.Request("m", 3, map("kimi-code", 6, "dsh", 12), null);
        assertEquals("unchanged", MachineActivity.plan(before, same).get("kind"));
        var other = new MachineActivity.Request("m", 6, map("dsh", 12), null);
        Map<String, Object> p = MachineActivity.plan(before, other);
        assertEquals("update", p.get("kind"));
        assertEquals(Map.of("window_h", 3, "harness", map("dsh", 12, "kimi-code", 6)), p.get("before"));
        @SuppressWarnings("unchecked")
        Map<String, Object> after = (Map<String, Object>) p.get("after");
        assertEquals(6, after.get("window_h"));
        assertEquals(MachineActivity.DEFAULT_H, p.get("default_h"));
        var reset = MachineActivity.plan(before, new MachineActivity.Request("m", null, null, null));
        assertEquals("update", reset.get("kind"));
        @SuppressWarnings("unchecked")
        Map<String, Object> cleared = (Map<String, Object>) reset.get("after");
        assertNull(cleared.get("window_h"), "окно машины снято — действует общий дефолт");
    }

    // ── запись: литерал карты, без параметров-коллекций ────────────────────

    @Test
    void updateSql_mapLiteral_noByParam_nullWhenEmpty() {
        String sql = MachineActivity.updateSql(new MachineActivity.Setting(3, map("dsh", 12, "kimi-code", 6)));
        assertTrue(sql.startsWith("UPDATE KnowActor SET activity_window_h = 3, activity_window_harness = {"), sql);
        assertTrue(sql.contains("'dsh': 12") && sql.contains("'kimi-code': 6"), sql);
        assertTrue(sql.endsWith(" WHERE kind = 'agent' AND client_id = :c"), sql);
        assertFalse(sql.contains(":by"), "BY — ключевое слово парсера ArcadeDB");
        String reset = MachineActivity.updateSql(new MachineActivity.Setting(null, Map.of()));
        assertTrue(reset.contains("activity_window_h = null") && reset.contains("activity_window_harness = null"), reset);
    }

    // ── обогащение machine_acl: когда машина была на связи ─────────────────

    @Test
    void enrich_lastSeenFromKnowMachine_defaultWindow_unreadSourceLeavesNoField() {
        List<Map<String, Object>> rows = new ArrayList<>();
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("client_id", "minilore-link-lorcetus");
        rows.add(a);
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("client_id", "minilore-link-ghost");
        rows.add(b);
        MachineActivity.enrichAcl(rows, List.of(
            Map.of("machine_id", "lorcetus", "last_seen_at", "2026-11-11T10:00:00Z"),
            Map.of("machine_id", "other", "last_seen_at", "2026-11-11T09:00:00Z")));
        assertEquals("2026-11-11T10:00:00Z", a.get("last_seen_at"));
        assertTrue(b.containsKey("last_seen_at"), "прочитано, но машину не видели — поле есть, значение null");
        assertNull(b.get("last_seen_at"));
        assertEquals(MachineActivity.DEFAULT_H, a.get("activity_default_h"));

        Map<String, Object> c = new LinkedHashMap<>();
        c.put("client_id", "minilore-link-lorcetus");
        MachineActivity.enrichAcl(List.of(c), null);
        assertFalse(c.containsKey("last_seen_at"), "источник не прочитан — поля нет, а не «никогда»");
        assertEquals(MachineActivity.DEFAULT_H, c.get("activity_default_h"));
    }
}
