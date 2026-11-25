package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-02 (+ KREG-04 срезы) — генератор KnowRegistry и гейт MDL-05 (тройка).
 *
 * <p>Сторожа: выдача в репозитории = прогон генератора (ручная правка выдачи — дефект; переснять —
 * {@code KNOW_REGISTRY_REGEN=1}); реестр ⊇ модели (каждый тип, поле и связь модели — в реестре);
 * каждый срез реестра срезов — вид {@code slice:*}; поле реестра — только из тройки DDL / модель /
 * ребро; свойство живой схемы вне тройки — в unclassified (MDL-10), а не в реестре.
 */
class KnowRegistryGeneratorTest {

    static KnowRegistry.Result run() {
        return KnowRegistry.generate(KnowRegistryInputs.inputs(), null);
    }

    @Test
    void committedArtifactEqualsGenerator() throws Exception {
        String expected = KnowRegistry.render(KnowRegistry.document(KnowRegistryInputs.inputs().model(), run()));
        if ("1".equals(System.getenv("KNOW_REGISTRY_REGEN"))) {
            Files.writeString(KnowRegistryInputs.ARTIFACT, expected, StandardCharsets.UTF_8);
            return;
        }
        assertTrue(Files.exists(KnowRegistryInputs.ARTIFACT), "нет выдачи генератора " + KnowRegistryInputs.ARTIFACT + " — KNOW_REGISTRY_REGEN=1");
        String actual = Files.readString(KnowRegistryInputs.ARTIFACT, StandardCharsets.UTF_8).replace("\r\n", "\n");
        assertEquals(expected, actual, "know-registry.json разошёлся с генератором — не правьте руками, KNOW_REGISTRY_REGEN=1");
    }

    @Test
    void generatorIsDeterministic() {
        String a = KnowRegistry.render(KnowRegistry.document(KnowRegistryInputs.inputs().model(), run()));
        String b = KnowRegistry.render(KnowRegistry.document(KnowRegistryInputs.inputs().model(), run()));
        assertEquals(a, b);
    }

    /** UNIQUE kind: две записи одного вида — дефект входов (SPEC-MODEL-EXPORT-064 §5). */
    @Test
    void kindsAreUnique() {
        Set<String> seen = new TreeSet<>();
        List<String> dup = new ArrayList<>();
        for (Map<String, Object> k : run().kinds()) if (!seen.add((String) k.get("kind"))) dup.add((String) k.get("kind"));
        assertEquals(List.of(), dup);
    }

    /** QG-инвариант «реестр ⊇ модели»: тип, поле и связь модели — записи реестра. */
    @Test
    void registryCoversEveryModelTypeFieldAndLink() {
        KnowRegistry.Result r = run();
        JsonObject model = KnowRegistryInputs.inputs().model();
        List<String> missing = new ArrayList<>();
        for (String arr : List.of("types", "child_only"))
            for (Object o : model.getJsonArray(arr)) {
                JsonObject t = (JsonObject) o;
                Map<String, Object> k = r.kind("entity:" + t.getString("type"));
                if (k == null) { missing.add("entity:" + t.getString("type")); continue; }
                Set<String> names = names(k, "fields", "name");
                for (String part : List.of("fields", "body"))
                    if (t.getJsonArray(part) != null)
                        for (Object fo : t.getJsonArray(part))
                            if (!names.contains(((JsonObject) fo).getString("key")))
                                missing.add(k.get("kind") + "." + ((JsonObject) fo).getString("key"));
                Set<String> rels = names(k, "links", "rel");
                if (t.getJsonArray("relations") != null)
                    for (Object ro : t.getJsonArray("relations"))
                        if (!rels.contains(((JsonObject) ro).getString("rel")))
                            missing.add(k.get("kind") + " → " + ((JsonObject) ro).getString("rel"));
            }
        assertEquals(List.of(), missing, "модель называет то, чего нет в реестре");
    }

    /** KREG-04: каждый срез — вид slice:* с параметрами его сигнатуры (обязательные + фильтры + SE-01). */
    @Test
    void registryCoversEverySliceWithItsSignature() {
        KnowRegistry.Result r = run();
        List<String> missing = new ArrayList<>();
        for (String id : LoreSlices.ids()) {
            Map<String, Object> k = r.kind("slice:" + id);
            if (k == null) { missing.add("slice:" + id); continue; }
            Set<String> params = names(k, "params", "name");
            LoreSlices.SliceDef d = LoreSlices.get(id);
            for (String p : d.required()) if (!params.contains(p)) missing.add(id + "?" + p);
            for (String p : d.optionalFilters().keySet()) if (!params.contains(p)) missing.add(id + "?" + p);
            for (String p : KnowRegistry.COMMON_SLICE_PARAMS) if (!params.contains(p)) missing.add(id + "?" + p);
        }
        assertEquals(List.of(), missing);
        long sliceKinds = r.kinds().stream().filter(k -> String.valueOf(k.get("kind")).startsWith("slice:")).count();
        assertEquals(LoreSlices.ids().size(), sliceKinds, "describe-coverage срезов — 100%, лишних видов нет");
    }

    @Test
    void sliceSprintsCarriesParamsAndColumns() {
        Map<String, Object> k = run().kind("slice:sprints");
        assertNotNull(k);
        assertTrue(names(k, "params", "name").containsAll(Set.of("limit", "offset", "fields")), String.valueOf(k.get("params")));
        assertTrue(names(k, "fields", "name").contains("sprint_id"), String.valueOf(k.get("fields")));
    }

    /** Гейт MDL-05 (тройка): у каждого поля entity:* слой — ddl / model / edge / computed, и он правдив. */
    @Test
    void everyEntityFieldComesFromTheTriple() {
        KnowRegistry.Inputs in = KnowRegistryInputs.inputs();
        List<String> bad = new ArrayList<>();
        for (Map<String, Object> k : run().kinds()) {
            String kind = (String) k.get("kind");
            if (!kind.startsWith("entity:") && !kind.startsWith("ddl:")) continue;
            Set<String> ddl = new TreeSet<>();
            for (String v : new String[]{(String) k.get("vertex"), (String) k.get("hist")})
                if (v != null) ddl.addAll(in.ddl().getOrDefault(v, Map.of()).keySet());
            String type = kind.substring(kind.indexOf(':') + 1);
            Set<String> modelNames = new TreeSet<>(FieldDeclaredGuardTest.modelFieldsOf(in.model(), type));
            // дочерние типы (child_only: phase, qg_metric) описаны своим разделом модели
            for (Object o : in.model().getJsonArray("child_only"))
                if (type.equals(((JsonObject) o).getString("type")) && ((JsonObject) o).getJsonArray("fields") != null)
                    for (Object fo : ((JsonObject) o).getJsonArray("fields")) modelNames.add(((JsonObject) fo).getString("key"));
            for (Map<String, Object> f : fields(k)) {
                String layer = String.valueOf(f.get("layer"));
                String prop = (String) f.get("property");
                boolean ok = switch (layer) {
                    case "ddl" -> ddl.contains(prop) || ddl.contains((String) f.get("name"));
                    case "model", "computed" -> modelNames.contains((String) f.get("name"));
                    case "edge" -> f.get("rel") != null;
                    default -> false;
                };
                if (!ok) bad.add(kind + "." + f.get("name") + " [" + layer + "]");
            }
        }
        assertEquals(List.of(), bad, "поле реестра не из тройки DDL / модель / ребро (MDL-05)");
    }

    /**
     * Обратная проверка гейта: свойство живой схемы, которого нет ни в DDL, ни в модели, ни на ребре,
     * в реестр не попадает — уходит в unclassified (MDL-10). Объявленное в DDL туда не попадает.
     */
    @Test
    void reverseCheckUndeclaredSchemaPropertyGoesToUnclassifiedNotRegistry() {
        Map<String, Set<String>> dump = Map.of("KnowSprint", Set.of("sprint_id", "zz_kreg02_invented", "@rid"));
        KnowRegistry.Result r = KnowRegistry.generate(KnowRegistryInputs.inputs(), dump);
        assertTrue(r.unclassified().stream().anyMatch(u -> "zz_kreg02_invented".equals(u.get("property"))
            && "sprint".equals(u.get("type")) && "schema-only".equals(u.get("reason"))), String.valueOf(r.unclassified()));
        assertFalse(r.unclassified().stream().anyMatch(u -> "sprint_id".equals(u.get("property")) || "@rid".equals(u.get("property"))));
        assertFalse(names(r.kind("entity:sprint"), "fields", "name").contains("zz_kreg02_invented"));
    }

    /**
     * Прогон на прод-копии схемы (дамп {@code docs/reports/model-schema-prod-2026-11-24.json}, KREG-10, или путь из
     * {@code KREG_SCHEMA_DUMP}): свойства вне тройки уходят в unclassified и в реестре их нет. Дампа нет — пропуск.
     */
    @Test
    void prodDumpRunKeepsUnclassifiedOutOfTheRegistry() throws Exception {
        java.nio.file.Path dump = System.getenv("KREG_SCHEMA_DUMP") != null ? java.nio.file.Path.of(System.getenv("KREG_SCHEMA_DUMP"))
            : java.nio.file.Path.of("..", "docs", "reports", "model-schema-prod-2026-11-24.json");
        org.junit.jupiter.api.Assumptions.assumeTrue(Files.exists(dump), "нет дампа схемы " + dump);
        KnowRegistry.Result r = KnowRegistry.generate(KnowRegistryInputs.inputs(), KnowRegistryInputs.dump(Files.readString(dump, StandardCharsets.UTF_8)));
        for (Map<String, Object> u : r.unclassified()) {
            Map<String, Object> k = r.kind("entity:" + u.get("type"));
            assertFalse(names(k, "fields", "name").contains(String.valueOf(u.get("property"))), String.valueOf(u));
        }
        System.out.println("[KREG-02] прогон на дампе " + dump + ": видов " + r.kinds().size() + " " + countsByPrefix(r)
            + ", unclassified " + r.unclassified().size() + " " + r.unclassified());
    }

    @Test
    void entityKindHasRegistryShape() {
        Map<String, Object> k = run().kind("entity:sprint");
        assertNotNull(k);
        for (String key : List.of("kind", "id_field", "title", "fields", "links", "guards", "roles", "replaces", "source", "content_hash"))
            assertTrue(k.containsKey(key), "нет " + key);
        assertEquals("sprint_id", k.get("id_field"));
        assertEquals(List.of("full", "pm"), k.get("roles"));
        assertTrue(names(k, "guards", "name").contains("status-moves"));
        Map<String, Object> status = fields(k).stream().filter(f -> "status".equals(f.get("name"))).findFirst().orElseThrow();
        assertEquals("dict:sprint_status", status.get("enum_ref"));
    }

    /**
     * Приёмка SKILL-04/KREG-07: вид skill:* — в реестре (до этого генератор знал только ddl:KnowSkill — KnowSkill
     * не тип паспорта модели, а других путей в реестр у вершины не было). Поля — из DDL KnowSkill, гарды, связи,
     * жизненный цикл и роли записи — из тех же констант, что исполняют гарды записи ({@link SkillRules}).
     */
    @Test
    void skillKindIsInTheRegistry() {
        Map<String, Object> k = run().kind("skill:*");
        assertNotNull(k, "вида skill:* нет в реестре");
        assertEquals("skill_id", k.get("id_field"));
        assertTrue(names(k, "fields", "name").containsAll(List.of("skill_id", "title", "body_md", "status", "source", "version")),
            String.valueOf(names(k, "fields", "name")));
        assertEquals(Set.of("BELONGS_TO_PROJECT", "APPLIES_TO_ROLE", "SKILL_EXTENDS", "OWNED_BY"), names(k, "links", "rel"));
        assertTrue(names(k, "guards", "name").containsAll(List.of("required-edges", "no-extends-cycle", "no-dangling-unlink", "status-moves")));
        assertEquals(List.of("architect", "full"), k.get("roles"));
        assertNotNull(k.get("lifecycle"));
        Map<String, Object> status = fields(k).stream().filter(f -> "status".equals(f.get("name"))).findFirst().orElseThrow();
        assertEquals("dict:skill_status", status.get("enum_ref"));
        Map<String, Object> source = fields(k).stream().filter(f -> "source".equals(f.get("name"))).findFirst().orElseThrow();
        assertEquals(SkillRules.SOURCES, source.get("enum"));
    }

    // ── мелочи ──

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> fields(Map<String, Object> k) {
        return (List<Map<String, Object>>) k.get("fields");
    }

    @SuppressWarnings("unchecked")
    static Set<String> names(Map<String, Object> k, String list, String key) {
        Set<String> out = new TreeSet<>();
        Object v = k.get(list);
        if (v instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m && m.get(key) != null) out.add(String.valueOf(m.get(key)));
        return out;
    }

    static Map<String, Integer> countsByPrefix(KnowRegistry.Result r) {
        Map<String, Integer> out = new TreeMap<>();
        for (Map<String, Object> k : r.kinds()) out.merge(String.valueOf(k.get("kind")).split(":", 2)[0], 1, Integer::sum);
        return out;
    }
}
