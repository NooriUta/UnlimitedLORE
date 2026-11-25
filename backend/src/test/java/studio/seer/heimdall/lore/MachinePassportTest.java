package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-MACHINE-PASSPORT · паспорт машины из модели.
 *
 * <p>Повод — владелец 23.11.2026: «паспорта машины нет ни в админке ни в lore» и «а почему у нас машина ещё не в
 * модели???». Машина — вершина {@code KnowMachine} (V79), у неё не было своего типа в lore-model.json: только раздел
 * admin и ссылки {@code targetType: machine} у агента. Решения владельца (заметка задачи): паспорт только в админке
 * (1), агенты машины — ребро {@code USES_MACHINE} (2б), в паспорте обе даты с подписью источника (6б).
 *
 * <p>Тип machine — только чтение: машину пишут агенты (AgentMachineFilter) и дверь {@code machine_new}; владелец и
 * шлюз — у актора-шлюза {@code minilore-link-<id>} (ADR-MINILORE-007 В4), а не у самой вершины, поэтому в модели это
 * поля-ссылки без ребра вершины.
 */
class MachinePassportTest {

    @Test
    void тип_machine_в_модели_только_чтение_раздел_admin() {
        assertTrue(LoreRecordRegistry.TYPES.contains("machine"), "нет паспорта машины: " + LoreRecordRegistry.TYPES);
        assertTrue(LoreRecordRegistry.READ_ONLY.contains("machine"), "машину пишут агенты и machine_new — паспорт только чтение");
        LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get("machine");
        assertNotNull(g, "нет вершины машины в модели");
        assertEquals("KnowMachine", g.vertex());
        assertEquals("machine_id", g.key());
        assertNull(g.hist(), "истории SCD2 у машины нет");
        assertEquals("admin", LoreModelFile.content().audience().get("machine"), "решение 1: машины — только в админке");
        assertEquals("project", LoreRecordRegistry.TYPES.get(LoreRecordRegistry.TYPES.size() - 1), "проект — последним");
    }

    @Test
    void поля_паспорта_с_ключом_и_тремя_языками() {
        LoreRecordRegistry.TypeDef d = LoreRecordRegistry.get("machine");
        assertNotNull(d);
        List<String> keys = d.fields().stream().map(LoreRecordRegistry.Field::key).toList();
        for (String k : List.of("title", "owner", "gateway", "harness", "last_seen_at", "first_seen_at"))
            assertTrue(keys.contains(k), "нет поля " + k + ": " + keys);
        List<String> bad = new ArrayList<>();
        for (LoreRecordRegistry.Field f : d.fields()) {
            if (f.labelKey() == null || f.labelKey().isBlank()) bad.add(f.key() + ": нет labelKey");
            if (f.labelEn() == null || f.labelEn().isBlank()) bad.add(f.key() + ": нет labelEn");
            if (f.labelPl() == null || f.labelPl().isBlank()) bad.add(f.key() + ": нет labelPl");
            if (f.definition() == null || f.definition().isBlank()) bad.add(f.key() + ": нет definition");
        }
        assertEquals(List.of(), bad, "KREG-10: у полей — labelKey + labelEn + labelPl");
        // 6б: обе даты подписаны источником — отметка машины не выдаётся за «последнее действие».
        assertTrue(d.field("last_seen_at").definition().contains("last_seen_at"), d.field("last_seen_at").definition());
        assertEquals("user", d.field("owner").refType());
        assertNull(d.field("owner").rel(), "владелец — у актора-шлюза (OWNED_BY шлюза), не ребро вершины KnowMachine");
        assertEquals("agent", d.field("gateway").refType());
        assertNull(d.field("gateway").rel());
    }

    @Test
    void агенты_машины_вкладкой_по_ребру_USES_MACHINE() {
        LoreRecordRegistry.Relation r = LoreRecordRegistry.get("machine").relations().stream()
            .filter(x -> "agents".equals(x.key())).findFirst().orElse(null);
        assertNotNull(r, "решение 2б: агенты машины — ребро USES_MACHINE");
        assertEquals(List.of("USES_MACHINE", "in", "agent", "link_tab"), List.of(r.rel(), r.dir(), r.targetType(), r.place()));
        assertTrue(LoreRecordValues.readByEdge("machine").contains("agents"), "вкладка читается по ребру из модели");
        // Обратная сторона: у агента вкладка «Машины» ведёт на тип, у которого теперь есть паспорт.
        LoreRecordRegistry.Relation back = LoreRecordRegistry.get("agent").relations().stream()
            .filter(x -> "machines".equals(x.key())).findFirst().orElseThrow();
        assertEquals("machine", back.targetType());
        assertTrue(LoreRecordRegistry.TYPES.contains(back.targetType()));
    }

    @Test
    void источник_одна_строка_по_machine_id() {
        LoreRecordResource.Source s = LoreRecordResource.sourceOf("machine");
        assertNotNull(s, "нет главного среза машины");
        assertEquals("machine_by_id", s.slice());
        LoreSlices.SliceDef d = LoreSlices.get("machine_by_id");
        assertNotNull(d, "machine_by_id не зарегистрирован");
        assertEquals(List.of(s.param()), d.required());
        assertTrue(d.baseSql().contains("FROM KnowMachine"), d.baseSql());
        assertTrue(d.baseSql().contains("machine_id = :id"), d.baseSql());
        assertTrue(d.baseSql().contains("minilore-link-"), "шлюз — актор minilore-link-<id>: " + d.baseSql());
        assertTrue(LoreSlices.SCOPE_PENDING.containsKey("machine_by_id"), "скоуп паспорта машины — как у machine_acl: решение");
        assertTrue(LoreRecordResource.idAllowed("machine", "lorcetus"));
        assertFalse(LoreRecordResource.idAllowed("machine", "x' OR 1=1"));
    }

    @Test
    void значения_паспорта_из_строки_среза() {
        Map<String, Object> row = new HashMap<>();
        row.put("machine_id", "lorcetus");
        row.put("first_seen_at", "2026-11-11T08:00:00Z");
        row.put("last_seen_at", "2026-11-22T15:46:00Z");
        row.put("gateway", "minilore-link-lorcetus");
        row.put("gateway_name", "lorcetus (машина владелицы, miniLORE link)");
        row.put("harness", "kimi");
        row.put("owner", "52f6fad5-sub");
        row.put("owner_name", "Ann So");
        Map<String, Object> v = LoreRecordValues.values("machine", row);
        assertEquals("lorcetus", v.get("title"), "заголовок — имя машины");
        assertEquals("lorcetus", v.get("code"));
        assertEquals("minilore-link-lorcetus", v.get("gateway"));
        assertEquals("kimi", v.get("harness"));
        assertEquals("52f6fad5-sub", v.get("owner"));
        assertEquals("2026-11-22T15:46:00Z", v.get("last_seen_at"));
        assertEquals("2026-11-11T08:00:00Z", v.get("first_seen_at"));
        // Машина без шлюза (решение 3б): поля пустые, а не выдуманные.
        Map<String, Object> bare = LoreRecordValues.values("machine", Map.of("machine_id", "argharaga"));
        assertEquals("argharaga", bare.get("title"));
        assertNull(bare.get("gateway"));
        assertNull(bare.get("owner"));
    }
}
