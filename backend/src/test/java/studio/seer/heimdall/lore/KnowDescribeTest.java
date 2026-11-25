package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-07 — describe-карточки из записей KnowKind (SPEC-AGENT-SURFACE-061 §8).
 * Карточки tag:* (field_schema, сторож rename), skill:* (гарды обязательных рёбер, lifecycle) и
 * slice:sprints (params) генерируются из записи; сверка с ручным describe_full из SPEC-SKILLS-TAGS-062 §9.
 */
class KnowDescribeTest {

    /** Эталонные словари (снимок MC-01): словарь → коды. */
    static Map<String, List<String>> dicts() {
        Map<String, List<String>> out = new TreeMap<>();
        for (Map<String, Object> r : LoreModelGoldenTest.dictRows())
            out.computeIfAbsent(String.valueOf(r.get("dict_type")), x -> new ArrayList<>()).add(String.valueOf(r.get("code")));
        return out;
    }

    /**
     * Запись вида skill:* по SPEC-SKILLS-TAGS-062 §5–§7 (вид заводит линия скиллов; здесь — форма записи,
     * как её выдаст генератор, когда тип skill появится в модели).
     */
    static Map<String, Object> skillKind() {
        Map<String, Object> k = new LinkedHashMap<>();
        k.put("kind", "skill:release-cutover");
        k.put("id_field", "skill_id");
        k.put("title", "Переключение релиза");
        k.put("fields", List.of(
            field("skill_id", "string", true, null), field("title", "string", true, null),
            field("body_md", "md", true, null), field("status", "enum", true, "dict:skill_status"),
            field("source", "enum", true, "dict:skill_source")));
        k.put("links", List.of(link("BELONGS_TO_PROJECT", "entity:project"), link("APPLIES_TO_ROLE", "dict:agent_profile")));
        k.put("guards", List.of(
            KnowRegistry.guard("required-edges", List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE")),
            KnowRegistry.guard("no-extends-cycle", List.of()),
            KnowRegistry.guard("status-moves", List.of("deprecated→active: owner only"))));
        k.put("roles", List.of("full", "architect"));
        k.put("replaces", List.of());
        k.put("source", "model+ddl");
        k.put("lifecycle", Map.of("draft", List.of("active"), "active", List.of("deprecated"), "deprecated", List.of("active")));
        return KnowRegistry.withHash(k);
    }

    static Map<String, Object> field(String name, String type, boolean required, String enumRef) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("name", name);
        f.put("type", type);
        f.put("required", required);
        f.put("enum_ref", enumRef);
        f.put("layer", "ddl");
        return f;
    }

    static Map<String, Object> link(String rel, String target) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("rel", rel);
        l.put("dir", "out");
        l.put("target_kind", target);
        l.put("edge_fields", List.of());
        return l;
    }

    /** Сверка с ручным describe_full skill:* из SPEC-SKILLS-TAGS-062 §9: гарды, личности, коды ошибок, lifecycle. */
    @Test
    void skillCardMatchesHandWrittenDescribeFull() {
        Map<String, List<String>> d = new TreeMap<>(dicts());
        d.put("skill_status", List.of("draft", "active", "deprecated"));
        d.put("skill_source", List.of("seed", "agent", "human"));
        Map<String, Object> card = KnowDescribe.describeFull(skillKind(), d);
        assertEquals("skill:release-cutover", card.get("kind"));
        assertEquals(List.of("full", "architect"), card.get("identities"));
        assertEquals(List.of(
            Map.of("name", "required-edges", "params", List.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE")),
            Map.of("name", "no-extends-cycle"),
            Map.of("name", "status-moves", "params", List.of("deprecated→active: owner only"))), card.get("guards"));
        assertEquals(List.of("draft", "active", "deprecated"), ((Map<?, ?>) card.get("enums")).get("skill_status"));
        assertEquals(List.of("REFUSED", "INVALID_VALUE", "NOOP", "FORBIDDEN_FOR_ROLE"), codes(card));
        Map<String, Object> forbidden = errors(card).get(3);
        assertEquals(List.of("full", "architect"), forbidden.get("allowed"));
        assertNotNull(card.get("lifecycle"));
    }

    @Test
    void tagCardCarriesFieldSchemaAndRenameGuard() {
        Map<String, Object> tag = KnowRegistry.tagKinds(FieldDeclaredGuardTest.model(), KnowRegistryTagImportTest.rows(),
            AgentScopeFilter.FAMILY_AGENTS).stream().filter(x -> "tag:security-review".equals(x.get("kind"))).findFirst().orElseThrow();
        Map<String, Object> card = KnowDescribe.describeFull(tag, dicts());
        Set<String> params = new TreeSet<>();
        for (Object p : (List<?>) card.get("params")) params.add(String.valueOf(((Map<?, ?>) p).get("name")));
        assertEquals(Set.of("reviewer", "verdict"), params);
        assertTrue(codes(card).contains("partial_failure"), String.valueOf(card.get("errors")));
        Object edge = ((List<?>) card.get("links")).get(0);
        assertTrue(((List<?>) ((Map<?, ?>) edge).get("edge_fields")).contains("fields{*}"), String.valueOf(edge));
    }

    /**
     * Приёмка SKILL-04/KREG-07 + 061 §5: карточка skill:* — из реестра (один источник describe), коды — словаря
     * 061 §5: переход вне жизненного цикла — INVALID_VALUE (не BAD_TRANSITION), deprecated→active не владельцем — NOOP.
     */
    @Test
    void skillCardComesFromTheRegistryWithSpec061Codes() {
        Map<String, List<String>> d = new TreeMap<>(dicts());
        d.put("skill_status", List.of("draft", "active", "deprecated"));
        Map<String, Object> card = KnowDescribe.describeFull(KnowDescribe.kindFor("skill:*", KnowRegistrySync.artifactKinds(),
            FieldDeclaredGuardTest.model()), d);
        assertEquals("skill:*", card.get("kind"));
        assertEquals(List.of("REFUSED", "INVALID_VALUE", "NOOP", "FORBIDDEN_FOR_ROLE"), codes(card));
        assertEquals(List.of("architect", "full"), card.get("identities"));
        assertEquals(SkillRules.SOURCES, ((Map<?, ?>) card.get("enums")).get("source"));
        assertEquals(List.of("draft", "active", "deprecated"), ((Map<?, ?>) card.get("enums")).get("skill_status"));
        assertEquals("skill:release-cutover", KnowDescribe.kindFor("skill:release-cutover", KnowRegistrySync.artifactKinds(),
            FieldDeclaredGuardTest.model()).get("kind"), "карточка вида — и по геоиду конкретного скилла");
    }

    /** Карточка tag:* — генератор вида тега; rename на занятое имя — IDENTITY_CONFLICT (061 §5), не TAG_TAKEN. */
    @Test
    void tagCardCarriesSpec061Codes() {
        Map<String, Object> card = KnowDescribe.describeFull(KnowDescribe.kindFor("tag:*", KnowRegistrySync.artifactKinds(),
            FieldDeclaredGuardTest.model()), dicts());
        assertEquals("tag:*", card.get("kind"));
        assertTrue(codes(card).containsAll(List.of("partial_failure", "IDENTITY_CONFLICT", "FORBIDDEN_FOR_ROLE")), codes(card).toString());
        assertFalse(String.valueOf(card).contains("TAG_TAKEN") || String.valueOf(card).contains("BAD_TRANSITION"), String.valueOf(card));
        assertNull(KnowDescribe.kindFor("adr:*", KnowRegistrySync.artifactKinds(), FieldDeclaredGuardTest.model()));
        assertNull(KnowDescribe.kindFor(null, KnowRegistrySync.artifactKinds(), FieldDeclaredGuardTest.model()));
    }

    @Test
    void sliceSprintsCardCarriesParams() {
        Map<String, Object> k = KnowRegistryGeneratorTest.run().kind("slice:sprints");
        Map<String, Object> card = KnowDescribe.describeFull(k, dicts());
        List<String> names = new ArrayList<>();
        for (Object p : (List<?>) card.get("params")) names.add(String.valueOf(((Map<?, ?>) p).get("name")));
        assertTrue(names.containsAll(List.of("limit", "offset", "fields")), names.toString());
        assertFalse(codes(card).contains("FORBIDDEN_FOR_ROLE"), "чтение среза — не запись");
        assertEquals(names, KnowDescribe.describeShort(k).get("params"));
    }

    @Test
    void entityCardEnumsComeFromDictionaries() {
        Map<String, Object> card = KnowDescribe.describeFull(KnowRegistryGeneratorTest.run().kind("entity:sprint"), dicts());
        Object status = ((Map<?, ?>) card.get("enums")).get("sprint_status");
        assertTrue(status instanceof List<?> l && !l.isEmpty(), String.valueOf(card.get("enums")));
        assertTrue(codes(card).contains("INVALID_VALUE"));
    }

    /** Словари не прочитаны — enums с null, а не пустые списки (не смогли ≠ пусто). */
    @Test
    void unreadDictionariesAreNullNotEmpty() {
        Map<String, Object> card = KnowDescribe.describeFull(KnowRegistryGeneratorTest.run().kind("entity:sprint"), null);
        assertTrue(((Map<?, ?>) card.get("enums")).containsKey("sprint_status"));
        assertNull(((Map<?, ?>) card.get("enums")).get("sprint_status"));
    }

    /** Ручная правка карточки — дефект: карточка = функция записи (повтор даёт тот же текст). */
    @Test
    void cardIsAPureFunctionOfTheRecord() {
        Map<String, Object> k = KnowRegistryGeneratorTest.run().kind("entity:task");
        assertEquals(KnowDescribe.describeFull(k, dicts()), KnowDescribe.describeFull(k, dicts()));
        assertEquals(k.get("content_hash"), KnowDescribe.describeFull(k, dicts()).get("content_hash"));
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> errors(Map<String, Object> card) {
        return (List<Map<String, Object>>) card.get("errors");
    }

    static List<String> codes(Map<String, Object> card) {
        return errors(card).stream().map(e -> String.valueOf(e.get("code"))).toList();
    }
}
