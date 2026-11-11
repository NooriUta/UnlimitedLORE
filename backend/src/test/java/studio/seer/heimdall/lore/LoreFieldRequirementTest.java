package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_UXR_S10_SEIDR_KIT_2/MD-REQUIRED (D-2026-LORE-RECORD-FIELD-REQUIRED,
 * SPEC-LORE-MD-INLINE-REF §5). Ответ владелицы 11.11 (A2): обязательные (block) — из схемы
 * БД, рекомендуемые (warn) — из проверок качества MCP, с условиями.
 * Чистый юнит: без Quarkus и БД — схема и линтер приходят аргументом/вызовом.
 */
class LoreFieldRequirementTest {

    private static Map<String, List<String>> schema() {
        return Map.of(
            "KnowTask", List.of("task_uid", "task_id", "title", "status_raw"),
            "KnowTaskHist", List.of("state_uid", "status_raw", "note_md", "effort_days", "work_class"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> fields(Map<String, Object> holder) {
        return (List<Map<String, Object>>) holder.get("fields");
    }

    private static Map<String, Object> field(Map<String, Object> holder, String key) {
        return fields(holder).stream().filter(f -> key.equals(f.get("key"))).findFirst()
            .orElseThrow(() -> new AssertionError("нет поля " + key));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rules(Map<String, Object> f) {
        Object r = f.get("required_rules");
        assertInstanceOf(List.class, r, f.get("key") + ": required_rules — массив");
        return (List<Map<String, Object>>) r;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> modelType(Map<String, Set<String>> mandatory, String t) {
        return (Map<String, Object>) LoreModelTypes.build(schema(), Map.of(), mandatory).get(t);
    }

    // ── block: из схемы БД ─────────────────────────────────────────────────

    @Test
    void schemaRowsMandatoryOrNotNullAreBlock() {
        List<Map<String, Object>> rows = List.of(
            Map.of("name", "KnowTask", "properties", List.of(
                Map.of("name", "title", "type", "STRING", "mandatory", true, "notNull", false),
                Map.of("name", "task_id", "type", "STRING", "mandatory", false, "notNull", true),
                Map.of("name", "order_index", "type", "INTEGER", "mandatory", false, "notNull", false),
                Map.of("name", "legacy", "type", "STRING"))),
            Map.of("name", "KnowSprint", "properties", List.of()));
        Map<String, Set<String>> m = LoreFieldRequirement.mandatoryOf(rows);
        assertEquals(Set.of("title", "task_id"), m.get("KnowTask"), "mandatory ИЛИ notNull — обязательное");
        assertEquals(Set.of(), m.get("KnowSprint"), "тип прочитан, обязательных нет — пустое множество, а не отсутствие");
    }

    @Test
    void mandatoryPropertyInSchemaGivesBlock() {
        Map<String, Object> task = modelType(Map.of("KnowTask", Set.of("title"), "KnowTaskHist", Set.of("effort_days")), "task");
        Map<String, Object> title = field(task, "title");
        assertEquals("block", title.get("required_level"));
        assertEquals(true, title.get("required"), "старый клиент видит required: true");
        assertTrue(rules(title).stream().anyMatch(r -> "block".equals(r.get("level")) && "schema".equals(r.get("source"))
            && "title".equals(r.get("code")) && r.get("when") == null), "правило block из схемы: " + rules(title));

        Map<String, Object> effort = field(task, "effort");
        assertEquals("block", effort.get("required_level"), "свойство Hist (effort_days) тоже из схемы");

        Map<String, Object> exec = field(task, "executor");
        assertNull(exec.get("required_level"), "не обязательное в схеме и не в линтере — null");
        assertEquals(false, exec.get("required"));
        assertEquals("schema", task.get("requirements_block"), "схема прочитана — block известен");
    }

    @Test
    void withoutMandatoryInSchemaThereIsNoBlock() {
        Map<String, Object> task = modelType(Map.of("KnowTask", Set.of(), "KnowTaskHist", Set.of()), "task");
        for (Map<String, Object> f : fields(task))
            assertNotEquals("block", f.get("required_level"), "task." + f.get("key") + ": block только из схемы");
    }

    @Test
    void recordSchemaWithoutDbSchemaSaysBlockUnknown() {
        Map<String, Object> s = LoreRecordRegistry.schemaJson("task");
        assertEquals("unknown", s.get("requirements_block"), "схема БД не читалась — «не знаем», а не «нет обязательных»");
        Map<String, Object> title = field(s, "title");
        assertEquals(true, title.get("required"), "обратная совместимость: required у названия остаётся true");
        assertTrue(title.containsKey("required_level"));
    }

    // ── warn: из проверок качества MCP ─────────────────────────────────────

    @Test
    void qualityMissingGivesWarn() {
        Map<String, Object> s = LoreRecordRegistry.schemaJson("task");
        Map<String, Object> status = field(s, "status");
        assertEquals("warn", status.get("required_level"));
        Map<String, Object> effort = field(s, "effort");
        assertEquals("warn", effort.get("required_level"));
        assertTrue(rules(effort).stream().anyMatch(r -> "quality".equals(r.get("source"))
            && "effort_days".equals(r.get("code")) && r.get("message") != null && r.get("when") == null), rules(effort).toString());
        assertEquals(false, effort.get("required"), "warn не делает поле required для старого клиента");

        // Сверка с тем, что MCP реально отвечает (task_new → quality.missing): код warn — из missing.
        @SuppressWarnings("unchecked")
        List<String> missing = (List<String>) WorkQuality.compact(
            WorkQuality.evaluateTask(null, null, null, null, null, null, null)).get("missing");
        assertTrue(missing.stream().anyMatch(m -> m.startsWith("effort_days ")), missing.toString());
    }

    @Test
    void everyQualityCodeIsMappedAndEveryTargetExists() {
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> s = LoreRecordRegistry.schemaJson(t);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> reqs = (List<Map<String, Object>>) s.get("requirements");
            assertNotNull(reqs, t + ": нет requirements");
            Set<String> codes = new java.util.HashSet<>();
            for (Map<String, Object> r : reqs) codes.add(String.valueOf(r.get("code")));
            for (String code : LoreFieldRequirement.missingCodes(t, Map.of()))
                assertTrue(codes.contains(code), t + ": код линтера " + code + " не попал в requirements");
            for (Map<String, Object> r : reqs) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> targets = (List<Map<String, Object>>) r.get("targets");
                assertNotNull(targets, t + "." + r.get("code") + ": targets");
                for (Map<String, Object> tg : targets) {
                    String key = String.valueOf(tg.get("key"));
                    if ("field".equals(tg.get("kind")))
                        assertTrue(fields(s).stream().anyMatch(f -> key.equals(f.get("key"))), t + ": нет поля " + key);
                    else {
                        assertEquals("relation", tg.get("kind"));
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> rels = (List<Map<String, Object>>) s.get("relations");
                        assertTrue(rels.stream().anyMatch(x -> key.equals(x.get("key"))), t + ": нет связи " + key);
                    }
                }
            }
        }
    }

    // ── Условные правила: только при своём условии ─────────────────────────

    @Test
    void conditionalRuleOnlyUnderItsCondition() {
        assertFalse(LoreFieldRequirement.missingCodes("task", Map.of()).contains("justified_by"));
        assertFalse(LoreFieldRequirement.missingCodes("task", Map.of("work_class", "jtd")).contains("justified_by"));
        assertTrue(LoreFieldRequirement.missingCodes("task", Map.of("work_class", "enb")).contains("justified_by"));

        Map<String, Object> s = LoreRecordRegistry.schemaJson("task");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> reqs = (List<Map<String, Object>>) s.get("requirements");
        Map<String, Object> jb = reqs.stream().filter(r -> "justified_by".equals(r.get("code"))).findFirst().orElseThrow();
        assertEquals("warn", jb.get("level"));
        @SuppressWarnings("unchecked")
        Map<String, Object> when = (Map<String, Object>) jb.get("when");
        assertEquals("work_class", when.get("field"));
        assertEquals("enb", when.get("eq"));
        assertTrue(String.valueOf(when.get("text")).contains("enb"), "условие словами для клиента: " + when);
        assertEquals(List.of(Map.of("kind", "relation", "key", "adrs")), jb.get("targets"), "JUSTIFIED_BY — связь «adrs»");

        // Условное правило на поле: realizes_uc — только при work_class=uc; безусловного уровня нет.
        Map<String, Object> uc = field(s, "realizes_uc");
        assertNull(uc.get("required_level"), "условное правило не поднимает безусловный уровень");
        List<Map<String, Object>> ucRules = rules(uc);
        assertEquals(1, ucRules.size(), ucRules.toString());
        @SuppressWarnings("unchecked")
        Map<String, Object> ucWhen = (Map<String, Object>) ucRules.get(0).get("when");
        assertEquals(Map.of("field", "work_class", "eq", "uc"), Map.of("field", ucWhen.get("field"), "eq", ucWhen.get("eq")));

        // У ADR последствия рекомендуются только у принятого.
        Map<String, Object> adr = LoreRecordRegistry.schemaJson("adr");
        Map<String, Object> cons = field(adr, "consequences_md");
        assertNull(cons.get("required_level"));
        assertTrue(rules(cons).stream().anyMatch(r -> {
            @SuppressWarnings("unchecked") Map<String, Object> w = (Map<String, Object>) r.get("when");
            return w != null && "status".equals(w.get("field")) && "ACCEPTED".equals(w.get("eq"));
        }), rules(cons).toString());
        assertEquals("warn", field(adr, "context_md").get("required_level"), "контекст ADR — безусловно");
    }

    /** Обратная проверка формы: правила без уровня/источника не проходят. */
    @Test
    void ruleShapeIsClosed() {
        List<Map<String, Object>> all = new ArrayList<>();
        for (String t : LoreRecordRegistry.TYPES)
            for (Map<String, Object> f : fields(LoreRecordRegistry.schemaJson(t))) all.addAll(rules(f));
        assertFalse(all.isEmpty());
        for (Map<String, Object> r : all) {
            assertTrue(Set.of("block", "warn").contains(r.get("level")), r.toString());
            assertTrue(Set.of("schema", "quality").contains(r.get("source")), r.toString());
            assertNotNull(r.get("code"));
            assertNotNull(r.get("message"));
            assertTrue(r.containsKey("when"));
        }
    }
}
