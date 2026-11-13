package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-01 — эталон «после = до» для переноса модели из Java в файл
 * (D-2026-LORE-MODEL-AS-CONFIG, MC-02).
 *
 * <p>Два снимка в {@code src/test/resources/model-golden/}:
 * <ul>
 *   <li>{@code lore-model.json} — документ {@code GET /lore/model} ({@link LoreModel#build}) на
 *       фиксированном входе: статусные справочники прода ({@code dict.json}) и замороженная схема v1
 *       ({@code v1-schema-baseline.txt}, она же у V1WorksOnNewSchemaLiveDbTest).</li>
 *   <li>{@code lore-record.json} — сборка {@code GET /lore/record/{type}/{id}} по каждому типу
 *       паспорта: схема (без БД и со схемой v1), values/computed по строке среза
 *       ({@link LoreRecordSnapshotTest#ROWS}), связи из строки, вкладки отдельным срезом,
 *       состояние непрочитанных вкладок, части, умолчания пустого паспорта.</li>
 * </ul>
 * Сверка — посимвольная по канонической форме (JSON с отступом; порядок ключей — часть контракта).
 *
 * <p><b>Обновить снимок</b> можно только сознательно: {@code LORE_GOLDEN_UPDATE=1 ./gradlew test
 * --tests '*LoreModelGoldenTest'} перезаписывает файлы, а дифф снимка идёт в PR и читается
 * ревьюером как изменение контракта.
 */
class LoreModelGoldenTest {

    static final String DIR = "model-golden/";

    // ── Вход ──────────────────────────────────────────────────────────────

    static String resource(String name) {
        try (InputStream in = LoreModelGoldenTest.class.getClassLoader().getResourceAsStream(name)) {
            assertNotNull(in, "нет ресурса " + name);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> dictRows() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : new JsonArray(resource(DIR + "dict.json"))) out.add(((JsonObject) o).getMap());
        return out;
    }

    /** Схема v1: «Type» и «Type.prop:TYPE» построчно → свойства и их объявленные типы. */
    record Schema(Map<String, List<String>> props, Map<String, Map<String, String>> declared) {}

    static Schema schemaV1() {
        Map<String, List<String>> props = new TreeMap<>();
        Map<String, Map<String, String>> declared = new TreeMap<>();
        for (String line : resource("v1-schema-baseline.txt").split("\\R")) {
            String l = line.strip();
            if (l.isEmpty() || l.startsWith("#")) continue;
            int dot = l.indexOf('.');
            if (dot < 0) { props.computeIfAbsent(l, k -> new ArrayList<>()); continue; }
            String type = l.substring(0, dot);
            String rest = l.substring(dot + 1);
            int colon = rest.indexOf(':');
            String prop = colon < 0 ? rest : rest.substring(0, colon);
            props.computeIfAbsent(type, k -> new ArrayList<>()).add(prop);
            if (colon >= 0) declared.computeIfAbsent(type, k -> new LinkedHashMap<>()).put(prop, rest.substring(colon + 1));
        }
        return new Schema(props, declared);
    }

    // ── Снимки ────────────────────────────────────────────────────────────

    static Map<String, Object> modelDoc() {
        Schema s = schemaV1();
        // mandatory пустой, а не null: «схема прочитана, обязательных нет» — block считается.
        return LoreModel.build(dictRows(), s.props(), s.declared(), Map.of());
    }

    static Map<String, Object> recordDoc() {
        Schema s = schemaV1();
        Map<String, Object> out = new LinkedHashMap<>();
        for (String type : LoreRecordRegistry.TYPES) {
            Map<String, Object> t = new LinkedHashMap<>();
            LoreModelTypes.Graph g = LoreModelTypes.GRAPH.get(type);
            Set<String> props = new LinkedHashSet<>(s.props().getOrDefault(g.vertex(), List.of()));
            if (g.hist() != null) props.addAll(s.props().getOrDefault(g.hist(), List.of()));
            t.put("schema_unread", LoreRecordRegistry.schemaJson(type));
            t.put("schema_v1", LoreRecordRegistry.schemaJson(type, props, Set.of()));
            Map<String, Object> row = LoreRecordSnapshotTest.ROWS.get(type);
            if (row != null) {
                t.put("values", LoreRecordValues.values(type, row));
                t.put("computed", LoreRecordValues.computed(type, row));
                t.put("row_links", LoreRecordValues.withKinds(type, LoreRecordValues.rowLinks(type, row)));
                t.put("values_empty_row", LoreRecordValues.values(type, Map.of()));
            }
            List<Map<String, Object>> parts = new ArrayList<>();
            for (LoreRecordRegistry.Part p : LoreRecordRegistry.get(type).parts()) parts.add(LoreRecordRegistry.partJson(p));
            t.put("parts", parts);
            List<String> sliceLinks = new ArrayList<>();
            for (LoreRecordFrom.SliceLink sl : LoreRecordFrom.SLICE_LINKS.getOrDefault(type, List.of()))
                sliceLinks.add(String.valueOf(sl));
            t.put("slice_links", sliceLinks);
            t.put("unread", LoreRecordValues.unreadState(type));
            t.put("defaults", LoreRecordValues.defaults(type));
            t.put("read_only", LoreRecordRegistry.READ_ONLY.contains(type));
            out.put(type, t);
        }
        return out;
    }

    static String canonical(Map<String, Object> doc) {
        return new JsonObject(doc).encodePrettily().replace("\r\n", "\n") + "\n";
    }

    /** Сверка со снимком; LORE_GOLDEN_UPDATE=1 — перезапись снимка (сознательное изменение контракта). */
    static void assertGolden(String file, String actual) throws IOException {
        Path path = Path.of("src/test/resources", DIR, file);
        if ("1".equals(System.getenv("LORE_GOLDEN_UPDATE"))) {
            Files.createDirectories(path.getParent());
            Files.writeString(path, actual, StandardCharsets.UTF_8);
            return;
        }
        String expected = resource(DIR + file).replace("\r\n", "\n");
        if (!expected.equals(actual)) {
            String[] e = expected.split("\n", -1), a = actual.split("\n", -1);
            int i = 0;
            while (i < Math.min(e.length, a.length) && e[i].equals(a[i])) i++;
            fail(file + ": расхождение с эталоном MC-01 со строки " + (i + 1)
                + "\n  эталон: " + (i < e.length ? e[i] : "<конец>")
                + "\n  сейчас: " + (i < a.length ? a[i] : "<конец>")
                + "\nЕсли изменение контракта сознательное — LORE_GOLDEN_UPDATE=1 и дифф снимка в PR.");
        }
    }

    @Test
    void modelDocumentEqualsGolden() throws IOException {
        assertGolden("lore-model.json", canonical(modelDoc()));
    }

    @Test
    void recordAssemblyEqualsGolden() throws IOException {
        assertGolden("lore-record.json", canonical(recordDoc()));
    }

    /** Детерминизм: два прогона сборки дают один и тот же текст (порядок не зависит от хеш-карт). */
    @Test
    void snapshotsAreDeterministic() {
        assertEquals(canonical(modelDoc()), canonical(modelDoc()));
        assertEquals(canonical(recordDoc()), canonical(recordDoc()));
    }

    /** Эталон покрывает каждый тип паспорта — новый тип без снимка не пройдёт молча. */
    @Test
    void goldenCoversEveryPassportType() {
        JsonObject rec = new JsonObject(resource(DIR + "lore-record.json"));
        JsonObject types = new JsonObject(resource(DIR + "lore-model.json")).getJsonObject("types");
        for (String t : LoreRecordRegistry.TYPES) {
            assertTrue(rec.containsKey(t), "в lore-record.json нет типа " + t);
            assertTrue(types.containsKey(t), "в lore-model.json нет типа " + t);
        }
    }
}
