package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелица 21.11.2026 (паспорт AIDA/MIDGARD и BRAGI на препроде): блок «Не описано в модели» показывал aliases, hosts,
 * mig_src_rid, regroup у проекта и dict_type, is_extensible, mig_src_rid у продукта — «не описаны в модели — дописать
 * описание в модель». Правило общее: свойство, которое база 1.18 хранит у записи типа (схема установщика + свойства,
 * которые ставят шаги переноса), либо описано полем модели, либо объявлено служебным (service_fields модели), либо
 * названо здесь с причиной как «ждёт описания». Новое неописанное свойство валит сторож.
 */
class ModelDescribesRecordPropsTest {

    /** Свойства, которые ставят шаги переноса поверх схемы установщика. */
    static final Map<String, List<String>> STEP_PROPS = Map.of(
        "*", List.of("mig_src_rid"),
        "KnowGitProject", List.of("aliases", "regroup", "hosts", "short_code", "short_title", "short_title_en", "short_title_pl",
            "title_en", "title_pl", "description", "description_en", "description_pl"),
        "QualityGate", List.of("scope"),
        "KnowDictEntry", List.of("kind", "dict_type", "is_extensible"));

    /** Неописанные свойства прочих типов — ждут описания в модели (найдены этим сторожем 21.11.2026). */
    // Владелица 21.11.2026: «опиши — нужно в инсталлятор отдать». Все свойства базы 1.18 описаны моделью или service_fields.
    static final Map<String, Set<String>> PENDING = Map.of();

    static Map<String, Set<String>> installerProps() throws Exception {
        Map<String, Set<String>> out = new HashMap<>();
        ObjectMapper m = new ObjectMapper();
        for (String file : List.of("sprint-phase-task.json", "all-objects.json")) {
            JsonNode types = m.readTree(Path.of("..", "scripts", "model-migration", "schema", file).toFile()).get("types");
            types.fields().forEachRemaining(e -> {
                Set<String> s = out.computeIfAbsent(e.getKey(), k -> new TreeSet<>());
                e.getValue().get("fields").fieldNames().forEachRemaining(s::add);
            });
        }
        return out;
    }

    static Map<String, Set<String>> unmodeled() throws Exception {
        Map<String, Set<String>> props = installerProps();
        Map<String, Set<String>> out = new TreeMap<>();
        for (String type : LoreRecordRegistry.TYPES) {
            if (!LoreRecordUnmodeled.reads(type)) continue;
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
            Map<String, Object> vertex = new LinkedHashMap<>();
            for (String p : props.getOrDefault(g.vertex(), Set.of())) vertex.put(p, "x");
            for (String p : STEP_PROPS.get("*")) vertex.put(p, "x");
            for (String p : STEP_PROPS.getOrDefault(g.vertex(), List.of())) vertex.put(p, "x");
            Set<String> left = LoreRecordUnmodeled.of(type, vertex).keySet();
            if (!left.isEmpty()) out.put(type, new TreeSet<>(left));
        }
        return out;
    }

    @Test
    void projectAndProductHaveNothingUnmodeled() throws Exception {
        Map<String, Set<String>> u = unmodeled();
        assertNull(u.get("project"), "у проекта «Не описано в модели» пусто: " + u.get("project"));
        assertNull(u.get("product"), "у продукта «Не описано в модели» пусто: " + u.get("product"));
    }

    @Test
    void everyStoredPropIsModeledServiceOrPendingWithReason() throws Exception {
        Map<String, Set<String>> u = unmodeled();
        assertEquals(PENDING, u, "свойства базы 1.18 без описания в модели (описать полем или service_fields): " + u);
    }

    /** Поля, описанные 21.11.2026 (бывший список «ждёт описания»): в схеме установщика каждое — с типом базы. */
    @Test
    void describedFieldsAreInInstallerSchemaWithType() throws Exception {
        Map<String, List<String>> was = Map.of(
            "KnowTask", List.of("task_id", "priority", "priority_note", "order_index", "src", "summary_md"),
            "KnowSprint", List.of("effort_days", "goal", "unplanned_intentional"),
            "KnowRelease", List.of("git_tag", "release_name", "released_at"),
            "KnowDoc", List.of("content_html", "content_html_bytes", "content_html_sha256", "content_md_en_bytes",
                "content_md_en_sha256", "content_md_ru_bytes", "content_md_ru_sha256", "sort_order"),
            "KnowDecision", List.of("refs_raw"), "KnowQuestion", List.of("trigger"), "KnowUseCase", List.of("feature_id"),
            "KnowPR", List.of("pr_number"), "QualityGate", List.of("routine_name"), "KnowSpec", List.of("file_path", "status"));
        ObjectMapper m = new ObjectMapper();
        Map<String, JsonNode> types = new HashMap<>();
        for (String file : List.of("sprint-phase-task.json", "all-objects.json"))
            m.readTree(Path.of("..", "scripts", "model-migration", "schema", file).toFile()).get("types").fields()
                .forEachRemaining(e -> types.put(e.getKey(), e.getValue()));
        for (Map.Entry<String, List<String>> e : was.entrySet())
            for (String f : e.getValue()) {
                JsonNode n = types.get(e.getKey()).get("fields").get(f);
                assertNotNull(n, e.getKey() + "." + f + ": нет в схеме установщика");
                assertFalse(n.get("db_type").asText().isBlank(), e.getKey() + "." + f + ": без типа базы");
            }
    }

    @Test
    void serviceFieldsAreDeclaredWithReason() {
        Map<String, String> s = LoreModelFile.content().serviceFields();
        for (String p : List.of("mig_src_rid", "regroup", "dict_type")) {
            assertTrue(s.containsKey(p), p + " — служебное поле модели");
            assertFalse(s.get(p).isBlank(), p + ": причина");
            assertTrue(LoreModelTypes.isInternal(p, "slug"), p + ": на поверхности не выводится");
        }
    }

    /**
     * Описанное поле не должно пропасть из паспорта: раньше его значение показывал блок «Не описано в модели» (чтение
     * вершины), а у главного среза такой колонки нет. Поле модели без значения в строке среза берётся из вершины;
     * значение среза не перезаписывается, служебное не подставляется.
     */
    @Test
    void describedFieldTakesValueFromVertexWhenSliceHasNone() {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("title", "Задача");
        Map<String, Object> vertex = Map.of("task_uid", "S/MD-05", "task_id", "MD-05", "order_index", 3, "title", "другое",
            "src", "manual", "mig_src_rid", "#1:2");
        LoreRecordUnmodeled.fillModeled("task", values, vertex);
        assertEquals("MD-05", values.get("task_id"));
        assertEquals(3, values.get("order_index"));
        assertEquals("Задача", values.get("title"), "значение среза не перезаписано");
        assertFalse(values.containsKey("src"), "служебное не подставляется");
        assertFalse(values.containsKey("mig_src_rid"));
    }

    /** Положительный контроль: свойство, которого нет в модели, блок показывает. */
    @Test
    void positiveControlUnknownPropIsShown() {
        assertEquals(Set.of("totally_new_prop"), LoreRecordUnmodeled.of("project", Map.of("slug", "a/b", "totally_new_prop", "x")).keySet());
    }

    /** Паспорт проекта: короткий код, краткое и полное название, описание на трёх языках, адреса и прежние ключи. */
    @Test
    void projectValuesCarryNames() {
        Map<String, Object> row = new HashMap<>();
        row.put("slug", "AIDA/MIDGARD");
        row.put("name", "MIDGARD");
        row.put("short_code", "MIDGARD");
        row.put("short_title", "MIDGARD");
        row.put("short_title_en", "MIDGARD");
        row.put("description", "Хаб GLADSHEIM и сервисы BOKVIT, TEIKN");
        row.put("description_en", "GLADSHEIM hub");
        row.put("aliases", List.of("AIDA/MIDGARD", "AIDA/GLADSHEIM"));
        row.put("hosts", List.of(Map.of("remote", "origin", "role", "primary", "base_url", "https://h/AIDA/MIDGARD")));
        Map<String, Object> v = LoreRecordValues.values("project", row);
        assertEquals("MIDGARD", v.get("short_code"));
        assertEquals("MIDGARD", v.get("short_title"));
        assertEquals("Хаб GLADSHEIM и сервисы BOKVIT, TEIKN", v.get("description"));
        assertEquals("GLADSHEIM hub", v.get("description_en"));
        assertEquals(List.of("AIDA/MIDGARD", "AIDA/GLADSHEIM"), v.get("aliases"));
        assertEquals(row.get("hosts"), v.get("hosts"), "адреса — структурой, kit рисует таблицей");
        row.remove("short_title");
        assertEquals("MIDGARD", LoreRecordValues.values("project", row).get("short_title"), "нет краткого — полное, не пусто");
        assertTrue(LoreSlices.get("project_by_id").baseSql().contains("short_title"));
        assertTrue(LoreSlices.get("git_projects").baseSql().contains("short_title_en"));
    }
}
