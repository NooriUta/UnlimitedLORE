package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Сторож «тип вне модели 1.18» (дефект админки 1.18 на ryzenai, сборка 8d6098da, база migration_dst_rc118):
 * раздел «Привести в порядок» отвечал 502 {@code SchemaException: Type with name 'PlanVersion' was not found} —
 * тип доски плана по MD-02 не переносится, а раздел его читал.
 *
 * <p>Правило: каждый тип, который читают срезы и раздел гигиены, либо входит в модель 1.18 (схема установщика
 * {@code scripts/model-migration/schema/*.json} и карта связей {@code map/all.edges.json}), либо помечен
 * {@link ModelSchemaAdapter#OUTSIDE_MODEL} с причиной («легаси, только старая схема» или «заводит сервер на ходу»).
 * На базе из модели, где такого типа нет, чтение отвечает «нет данных: тип не перенесён в 1.18» с причиной —
 * не 502 и не пустым ответом.
 */
class OutsideModelTypesGuardTest {

    @AfterEach
    void reset() {
        ModelSchemaAdapter.enable(false);
        ModelSchemaAdapter.schemaTypes(null);
        ModelSchemaAdapter.planBoard(true);
    }

    /** Типы и связи модели 1.18 — как их заводит установщик. */
    static Set<String> modelTypes() throws Exception {
        ObjectMapper m = new ObjectMapper();
        Set<String> out = new HashSet<>();
        for (String f : List.of("all-objects.json", "sprint-phase-task.json")) {
            JsonNode types = m.readTree(java.nio.file.Path.of("..", "scripts", "model-migration", "schema", f).toFile()).get("types");
            types.fieldNames().forEachRemaining(out::add);
        }
        m.readTree(java.nio.file.Path.of("..", "scripts", "model-migration", "map", "all.edges.json").toFile())
            .get("edges").fieldNames().forEachRemaining(out::add);
        assertTrue(out.size() > 80, "модель прочиталась: " + out.size());
        return out;
    }

    /** Типы снимка схемы графа, собранной переносом (KnowRepository, KnowOrganization …). */
    static Set<String> snapshotTypes() throws Exception {
        try (var in = OutsideModelTypesGuardTest.class.getResourceAsStream("/model-v2-schema/schema-types.json")) {
            assertNotNull(in);
            JsonNode t = new ObjectMapper().readTree(in).get("types");
            Set<String> out = new HashSet<>();
            t.fields().forEachRemaining(e -> { if (!e.getValue().isNull()) out.add(e.getKey()); });
            return out;
        }
    }

    /**
     * Ряды (TIMESERIES) раздела series модели 1.18 ({@code shared/model/lore-model.json}): живые журналы — их пишут
     * журнал действий, квоты агентов, LoreRequestStats, KcLoginPoller, BRAGI. Это часть модели, а не «вне модели».
     */
    static Set<String> seriesTypes() throws Exception {
        JsonNode series = new ObjectMapper().readTree(java.nio.file.Path.of("..", "shared", "model", "lore-model.json").toFile()).get("series");
        Set<String> out = new HashSet<>();
        if (series != null) series.fieldNames().forEachRemaining(out::add);
        return out;
    }

    static Set<String> known() throws Exception {
        Set<String> s = new HashSet<>(modelTypes());
        s.addAll(snapshotTypes());
        s.addAll(seriesTypes());
        s.addAll(graphAndHistoricEdges());
        return s;
    }

    /**
     * MDL-13: вершины раздела graph и историчные связи edge_history модели 1.18 — тоже модель, даже когда их заводит
     * шаг переноса, а не схема установщика (трек: KnowTrack и ON_TRACK — шаг связей tracks.mjs).
     */
    static Set<String> graphAndHistoricEdges() throws Exception {
        JsonNode m = new ObjectMapper().readTree(java.nio.file.Path.of("..", "shared", "model", "lore-model.json").toFile());
        Set<String> out = new HashSet<>();
        m.get("graph").fields().forEachRemaining(e -> {
            out.add(e.getValue().get("vertex").asText());
            if (e.getValue().has("hist")) out.add(e.getValue().get("hist").asText());
        });
        m.get("edge_history").get("edges").fieldNames().forEachRemaining(out::add);
        return out;
    }

    @Test
    void живые_ряды_не_помечены_вне_модели() throws Exception {
        for (String t : List.of("AgentActionLog", "MetricSnapshot")) {
            assertTrue(seriesTypes().contains(t), t + " — ряд раздела series модели 1.18");
            assertFalse(ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t), t + " — живой ряд модели 1.18");
        }
        assertTrue(seriesTypes().contains("AuditDbLogin"), "раздел series модели прочитан");
    }

    @Test
    void каждый_тип_среза_в_модели_или_помечен_вне_модели() throws Exception {
        Set<String> model = known();
        Set<String> bad = new TreeSet<>();
        int slicesWithTypes = 0;
        for (String id : LoreSlices.ids()) {
            Set<String> ts = LoreSlices.typesOf(id);
            if (!ts.isEmpty()) slicesWithTypes++;
            for (String t : ts)
                if (!model.contains(t) && !ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t)) bad.add(id + " → " + t);
        }
        assertTrue(slicesWithTypes > 100, "типы узнаются у срезов: " + slicesWithTypes);
        assertTrue(bad.isEmpty(), "срез читает тип вне модели 1.18 без пометки ModelSchemaAdapter.OUTSIDE_MODEL:\n  "
            + String.join("\n  ", bad));
    }

    @Test
    void пометка_вне_модели_не_лжёт() throws Exception {
        Set<String> model = known();
        for (Map.Entry<String, String> e : ModelSchemaAdapter.OUTSIDE_MODEL.entrySet()) {
            assertFalse(model.contains(e.getKey()), e.getKey() + " есть в модели — пометка «вне модели» лишняя");
            assertFalse(e.getValue().isBlank(), e.getKey() + ": причина пустая");
        }
        for (String t : List.of("PlanConfig", "PlanTrack", "PlanSection", "PlanCheckpoint", "PlanVersion"))
            assertTrue(ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t), t);
    }

    @Test
    void тип_раздела_гигиены_в_модели_или_помечен() throws Exception {
        Set<String> model = known();
        List<String> bad = new ArrayList<>();
        for (String t : LoreTidyResource.readTypes())
            if (!model.contains(t) && !ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t)) bad.add(t);
        assertTrue(bad.isEmpty(), "гигиена читает тип вне модели без пометки: " + bad);
    }

    /** Схема базы из модели — ровно типы модели: всё, что вне её, отсутствует. */
    private Set<String> asModelBase() throws Exception {
        ModelSchemaAdapter.enable(true);
        Set<String> present = known();
        ModelSchemaAdapter.schemaTypes(present);
        return present;
    }

    @Test
    void на_базе_из_модели_срез_типа_вне_модели_отвечает_причиной() throws Exception {
        asModelBase();
        int seen = 0;
        for (String id : LoreSlices.ids()) {
            Set<String> outside = new TreeSet<>(LoreSlices.typesOf(id));
            outside.retainAll(ModelSchemaAdapter.OUTSIDE_MODEL.keySet());
            String why = ModelSchemaAdapter.sliceUnavailable(id);
            if (outside.isEmpty()) {
                assertNull(why, id + ": все типы в модели — срез работает");
            } else {
                seen++;
                assertNotNull(why, id + " читает " + outside + " — нужна причина, а не 502");
                assertTrue(why.contains(outside.iterator().next()), id + ": причина называет тип — " + why);
                assertTrue(why.contains("1.18"), id + ": причина говорит про 1.18 — " + why);
            }
        }
        // MDL-13: track_options больше не срез доски (вершины KnowTrack модели 1.18) — срезов доски пять
        assertTrue(seen >= 5, "срезы доски плана нашлись: " + seen);
        assertTrue(ModelSchemaAdapter.sliceUnavailable("plan_versions").contains("PlanVersion"));
    }

    @Test
    void на_старой_схеме_ничего_не_снимается() {
        ModelSchemaAdapter.schemaTypes(Set.of("KnowTask"));
        for (String id : LoreSlices.ids()) assertNull(ModelSchemaAdapter.sliceUnavailable(id), id);
        assertFalse(ModelSchemaAdapter.typeMissing("PlanVersion"));
    }

    @Test
    void схему_не_прочитали_значит_не_снимаем() {
        ModelSchemaAdapter.enable(true);
        assertFalse(ModelSchemaAdapter.typeMissing("PlanVersion"), "не знаем схему — не врём «не перенесён»");
        assertNull(ModelSchemaAdapter.sliceUnavailable("plan_versions"));
    }

    @Test
    void гигиена_на_базе_из_модели_пропускает_тип_и_говорит_почему() throws Exception {
        asModelBase();
        List<String> targets = LoreTidyResource.presentTargets().stream().map(LoreTidyResource.Target::type).toList();
        assertFalse(targets.contains("PlanVersion"), "PlanVersion не читается — его нет");
        assertTrue(targets.contains("KnowTask"));
        List<Map<String, String>> skipped = LoreTidyResource.notMigrated();
        assertEquals(1, skipped.stream().filter(s -> "PlanVersion".equals(s.get("type"))).count(), String.valueOf(skipped));
        String reason = skipped.stream().filter(s -> "PlanVersion".equals(s.get("type"))).findFirst().orElseThrow().get("reason");
        assertTrue(reason.contains("1.18") && reason.contains("PlanVersion"), reason);
    }

    @Test
    void гигиена_на_старой_схеме_читает_всё() {
        assertEquals(LoreTidyResource.TARGETS.size(), LoreTidyResource.presentTargets().size());
        assertTrue(LoreTidyResource.notMigrated().isEmpty());
    }

    // ── MD-02 8а: не только срезы — любой тип и связь, которые трогает код сервера ────────────────────────────
    // Владелица 19.11.2026: «функции оставить». Сторож один: код читает или пишет тип (литеральное имя в SQL:
    // INSERT INTO / UPDATE / DELETE FROM / CREATE VERTEX / CREATE EDGE / SELECT … FROM; константа-имя «+ X +» и
    // «+ Класс.X +»; помощник createEdgeIfVerticesExist("X", …)) — тип есть в модели 1.18 или в OUTSIDE_MODEL с причиной.
    // Тот же разбор у генератора карты (scripts/model-migration/code-types.mjs): по нему пустой тип, который трогает
    // код, переходит в 1.18 «только схемой».

    private static final java.util.regex.Pattern VERB = java.util.regex.Pattern.compile(
        "\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|DELETE\\s+VERTEX|CREATE\\s+VERTEX|CREATE\\s+EDGE|FROM)\\s+`?([A-Z][A-Za-z0-9_]*)`?");
    private static final Set<String> NOT_TYPE = Set.of("TYPE", "SET", "IF", "CONTENT", "MERGE", "SELECT", "WHERE", "FROM");
    private static final java.util.regex.Pattern CONST = java.util.regex.Pattern.compile(
        "static\\s+final\\s+String\\s+([A-Z_]+)\\s*=\\s*\"([A-Za-z][A-Za-z0-9_]*)\"\\s*;");
    // possessive: длинный литерал не уводит разбор в рекурсию (StackOverflowError на чередовании)
    private static final java.util.regex.Pattern LITERAL = java.util.regex.Pattern.compile("\"((?:[^\"\\\\\\n]++|\\\\.)*+)\"");
    private static final java.util.regex.Pattern HELPER = java.util.regex.Pattern.compile("createEdgeIfVerticesExist\\(\\s*\"([A-Z][A-Za-z0-9_]*)\"");
    private static final java.nio.file.Path LORE_SRC = java.nio.file.Path.of("src", "main", "java", "studio", "seer", "heimdall", "lore");

    /** Типы и связи, которые трогает код пакета lore: имя → файлы. */
    static Map<String, Set<String>> codeTypes() throws Exception {
        List<java.nio.file.Path> files;
        try (var s = java.nio.file.Files.list(LORE_SRC)) { files = s.filter(p -> p.toString().endsWith(".java")).sorted().toList(); }
        Map<String, Map<String, String>> consts = new java.util.HashMap<>();
        for (var f : files) {
            var m = CONST.matcher(java.nio.file.Files.readString(f));
            String cls = f.getFileName().toString().replace(".java", "");
            while (m.find()) consts.computeIfAbsent(cls, k -> new java.util.HashMap<>()).put(m.group(1), m.group(2));
        }
        Map<String, Set<String>> out = new java.util.TreeMap<>();
        for (var f : files) {
            String cls = f.getFileName().toString().replace(".java", "");
            String s = java.nio.file.Files.readString(f).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)^\\s*//.*$", "");
            List<String[]> subs = new ArrayList<>();
            consts.getOrDefault(cls, Map.of()).forEach((k, v) -> subs.add(new String[]{k, v}));
            consts.forEach((c, ks) -> ks.forEach((k, v) -> subs.add(new String[]{c + "\\." + k, v})));
            for (String[] kv : subs)
                s = s.replaceAll("\"\\s*\\+\\s*" + kv[0] + "\\s*\\+\\s*\"", kv[1]).replaceAll("\"\\s*\\+\\s*" + kv[0] + "\\s*([,)])", kv[1] + "\"$1");
            s = s.replaceAll("\"\\s*\\+\\s*\"", "");
            var lit = LITERAL.matcher(s);
            while (lit.find()) {
                String l = lit.group(1);
                if (l.matches("(?is)^\\s*CREATE\\s+(VERTEX|EDGE|DOCUMENT)\\s+TYPE\\b.*|^\\s*CREATE\\s+(PROPERTY|INDEX)\\b.*|^\\s*DROP\\s.*")) continue;
                var v = VERB.matcher(l);
                while (v.find()) if (!NOT_TYPE.contains(v.group(1))) out.computeIfAbsent(v.group(1), k -> new TreeSet<>()).add(f.getFileName().toString());
            }
            var h = HELPER.matcher(s);
            while (h.find()) out.computeIfAbsent(h.group(1), k -> new TreeSet<>()).add(f.getFileName().toString());
        }
        return out;
    }

    /** Служебные типы, которые заводит сам перенос (transfer.mjs ownTypes без типов карты): остаток и отметка схемы. */
    private static final Set<String> TRANSFER_OWN = Set.of("MigLeftover", "LoreModelSchema", "HAS_STATE");

    @Test
    void каждый_тип_который_трогает_код_в_модели_или_помечен_вне_модели() throws Exception {
        Map<String, Set<String>> used = codeTypes();
        // положительный контроль разбора: пустые типы «только схема» и связи, которые пишет код, узнаются
        for (String t : List.of("KnowCanvas", "KnowSavedView", "QGMetric", "LoreRefDismissal", "MEASURED_BY", "MACHINE_ACCESS", "SOURCED_FROM"))
            assertTrue(used.containsKey(t), "разбор узнаёт " + t);
        assertFalse(used.containsKey("FROM") || used.containsKey("SET"), "служебные слова SQL — не типы");
        Set<String> model = known();
        model.addAll(TRANSFER_OWN);
        List<String> bad = new ArrayList<>();
        used.forEach((t, fs) -> { if (!model.contains(t) && !ModelSchemaAdapter.OUTSIDE_MODEL.containsKey(t)) bad.add(t + " ← " + fs); });
        assertTrue(bad.isEmpty(), "код трогает тип вне модели 1.18 без пометки ModelSchemaAdapter.OUTSIDE_MODEL:\n  " + String.join("\n  ", bad));
    }

    @Test
    void пометка_вне_модели_нужна_коду() throws Exception {
        Map<String, Set<String>> used = codeTypes();
        for (String t : ModelSchemaAdapter.OUTSIDE_MODEL.keySet()) {
            // KREG-01: цепочки *Hist читает сгенерированный SQL среза history_hygiene
            // (LoreSlices по histChains()) — литерального имени в коде нет, но тип
            // кодом трогается именно так; членство в histChains — и есть это чтение.
            if (LoreSlices.histChains().contains(t)) continue;
            assertTrue(used.containsKey(t), t + ": код его не трогает — пометка «вне модели» устарела");
        }
    }

    @Test
    void трек_спринта_на_базе_без_доски_отказывает_причиной() throws Exception {
        asModelBase();
        // MDL-13: на базе из модели трек — вершина KnowTrack; её нет (база без шага треков) — отказ с причиной
        ModelSchemaAdapter.schemaTypes(java.util.Set.of("KnowSprint"));
        LoreResourceBase.LoreError e = LoreSprintTracks.unavailable();
        assertNotNull(e);
        assertTrue(e.detail().contains("KnowTrack"), e.detail());
        asModelBase();
        assertNull(LoreSprintTracks.unavailable(), "треки перенесены — отказа нет");
        ModelSchemaAdapter.enable(false);
        assertNull(LoreSprintTracks.unavailable());
    }
}
