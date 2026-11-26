package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MODEL-TYPES — время в описании модели (поручение
 * владелицы 10.11: «посмотри, где не хватает дата/время — или в БД, или у тебя в
 * описании модели… мы везде почти заводили поле с временем и переводили на SCD2»).
 *
 * <p>Инвентаризация показала: БД богаче описания. У решения, вехи, релиза и технологии
 * цепочка SCD2 есть (KnowDecisionHist, KnowMilestoneHist, KnowReleaseHist, KnowSpecHist —
 * LoreSlices.HIST_PARENT, LoreSchemaInitializer), а модель отдавала им {@code hist: null}
 * («истории нет»). Вида времени (день / момент) модель не называла вовсе — kit не мог
 * отличить «время дня нет» от «время не пришло».
 */
class LoreModelTimeTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> type(String t) {
        return (Map<String, Object>) LoreModelTypes.build(Map.of()).get(t);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> fields(String t) {
        return (List<Map<String, Object>>) type(t).get("fields");
    }

    /** hist модели = цепочка SCD2 в графе; null — только там, где её действительно нет. */
    @Test
    void histNamesTheRealScd2Chain() {
        Map<String, String> want = Map.ofEntries(
            Map.entry("sprint", "KnowSprintHist"), Map.entry("task", "KnowTaskHist"),
            Map.entry("adr", "KnowADRHist"), Map.entry("spec", "KnowSpecHist"),
            Map.entry("decision", "KnowDecisionHist"), Map.entry("milestone", "KnowMilestoneHist"),
            Map.entry("release", "KnowReleaseHist"), Map.entry("tech", "KnowSpecHist"),
            // S4-PRODUCTS-NODE: продукт — статья словаря, её цепочка SCD2 — KnowDictEntryHist (history_dict).
            Map.entry("product", "KnowDictEntryHist"),
            // MD-04: ранбук — тело в открытой версии KnowRunbookHist (runbook_new пишет SCD2-цепочку).
            Map.entry("runbook", "KnowRunbookHist"),
            // AP-PASSPORT-EDIT (доводка v5): боль, выгода, работа, роль продукта, фича — своя цепочка SCD2.
            Map.entry("pain", "KnowPainHist"), Map.entry("gain", "KnowGainHist"), Map.entry("job", "KnowJobHist"),
            Map.entry("actor", "KnowProjectActorHist"), Map.entry("feature", "KnowUseCaseHist"));
        for (String t : LoreRecordRegistry.TYPES) {
            String hist = LoreModelTypes.GRAPH.get(t).hist();
            if (want.containsKey(t)) assertEquals(want.get(t), hist, t + ": цепочка SCD2 есть в графе");
            else assertNull(hist, t + ": истории SCD2 в графе нет");
            if (hist != null)
                assertTrue(LoreSlices.HIST_PARENT.containsKey(hist), t + ": " + hist + " — известная цепочка корпуса");
        }
    }

    /** У каждого типа — раздел time: история, источники заведения и последней правки, вид каждого. */
    @Test
    @SuppressWarnings("unchecked")
    void everyTypeDescribesItsTime() {
        Set<String> precisions = Set.of("date", "datetime");
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> time = (Map<String, Object>) type(t).get("time");
            assertNotNull(time, t + ": нет раздела time");
            String history = String.valueOf(time.get("history"));
            assertEquals(LoreModelTypes.GRAPH.get(t).hist() != null ? "scd2" : "none", history, t + ".history");
            for (String k : List.of("created", "changed")) {
                List<Map<String, Object>> src = (List<Map<String, Object>>) time.get(k);
                assertNotNull(src, t + ".time." + k + ": пустой список = «источника нет», отсутствие ключа — «не смотрели»");
                for (Map<String, Object> s : src) {
                    assertNotNull(s.get("source"), t + ".time." + k + ": источник без имени");
                    assertTrue(precisions.contains(s.get("precision")), t + ".time." + k + " " + s);
                }
            }
            if ("scd2".equals(history)) {
                List<Map<String, Object>> changed = (List<Map<String, Object>>) time.get("changed");
                assertEquals("version.valid_from", changed.get(0).get("source"), t + ": у SCD2 правка — прежде всего версия");
                assertEquals("datetime", changed.get(0).get("precision"), t + ": valid_from — DATETIME");
            }
        }
        // Было (#1146): «честные пустоты» — у компонента времени нет совсем, у вопроса и
        // фичи только день. Поручение владелицы «свежесть = последняя дата изменения»:
        // пути записи этих типов ставят updated_at (ISO-момент) — он первый источник
        // правки, точность datetime; прежние дни остаются запасными (бэкфилла нет).
        // AP-PASSPORT-EDIT: у фичи с доводки v5 есть SCD2 — первый источник правки у неё версия (проверка выше), updated_at второй.
        for (String t : List.of("question", "component")) {
            List<Map<String, Object>> changed = (List<Map<String, Object>>) ((Map<String, Object>) type(t).get("time")).get("changed");
            assertFalse(changed.isEmpty(), t + ": у правки есть источник");
            assertEquals("updated_at", changed.get(0).get("source"), t + ": первый источник правки — отметка updated_at");
            assertEquals("datetime", changed.get(0).get("precision"), t + ": updated_at — момент");
        }
    }

    /** У поля вида date — точность: день, момент или текст; «не знаем» в модели не остаётся. */
    @Test
    void everyDateFieldNamesItsPrecision() {
        for (String t : LoreRecordRegistry.TYPES)
            for (Map<String, Object> f : fields(t))
                if ("date".equals(f.get("kind")))
                    assertTrue(Set.of("date", "datetime").contains(f.get("precision")),
                        t + "." + f.get("key") + ": точность не названа — " + f.get("precision"));
        // MDL-06: в схеме 1.18 created_date спринта — KnowSprint.created_at DATE (перенос сводит created_date и
        // date_created к дню, решение владелицы «одно «создано»»); было «ISO-момент» по старой схеме.
        assertEquals("date", field("sprint", "created").get("precision"), "created_at спринта в схеме переноса — день");
        assertEquals("date", field("release", "date").get("precision"), "release_date — день");
        assertEquals("datetime", field("tech", "checked_at").get("precision"), "проверено = valid_from версии");
        assertEquals("date", field("feature", "shipped_at").get("precision"), "shipped_at ставится LocalDate — день, хоть и _at");
    }

    private static Map<String, Object> field(String t, String key) {
        return fields(t).stream().filter(f -> key.equals(f.get("key"))).findFirst().orElseThrow();
    }

    /** Объявленный тип свойства — из схемы графа; не объявлено (schemaless) — null, а не выдумка. */
    @Test
    void propertyTypeComesFromTheDeclaredSchema() {
        Map<String, List<String>> schema = Map.of("KnowDecision", List.of("decision_id", "created_at", "updated_at"),
            "KnowDecisionHist", List.of("valid_from", "status_raw"));
        Map<String, Map<String, String>> declared = Map.of("KnowDecision", Map.of("updated_at", "STRING"),
            "KnowDecisionHist", Map.of("valid_from", "DATETIME"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> fs = (List<Map<String, Object>>)
            ((Map<String, Object>) LoreModelTypes.build(schema, declared).get("decision")).get("fields");
        Map<String, Object> date = fs.stream().filter(f -> "date".equals(f.get("key"))).findFirst().orElseThrow();
        assertEquals("created_at", date.get("property"));
        assertTrue(date.containsKey("property_type"), "ключ есть всегда");
        assertNull(date.get("property_type"), "created_at без объявленного типа — тип неизвестен, null");
        Map<String, Object> status = fs.stream().filter(f -> "status".equals(f.get("key"))).findFirst().orElseThrow();
        assertEquals("status_raw", status.get("property"), "Hist решения входит в свойства типа");
    }

    /** /lore/model берёт схему всех вершин модели, а не только Know*: компонент — LoreComponent. */
    @Test
    void modelSchemaCoversEveryVertexOfTheModel() {
        for (LoreModelTypes.Graph g : LoreModelTypes.GRAPH.values()) {
            assertTrue(LoreModelTypes.wantsSchemaOf(g.vertex()), g.vertex());
            if (g.hist() != null) assertTrue(LoreModelTypes.wantsSchemaOf(g.hist()), g.hist());
        }
        assertFalse(LoreModelTypes.wantsSchemaOf("LoreSchemaVersion"), "служебные типы в модель не едут");
    }

    /** Источники «последней правки» модели — те же, что у changed_at среза списка типа. */
    @Test
    @SuppressWarnings("unchecked")
    void changedSourcesMatchTheListSlice() {
        Map<String, String> listSlice = Map.ofEntries(
            Map.entry("sprint", "sprints"), Map.entry("task", "open_tasks"), Map.entry("adr", "adrs"),
            Map.entry("spec", "specs"), Map.entry("decision", "decisions"), Map.entry("question", "questions"),
            Map.entry("milestone", "milestones"), Map.entry("release", "releases"),
            Map.entry("tech", "tech_registry"), Map.entry("feature", "use_cases"),
            Map.entry("component", "components"));
        for (Map.Entry<String, String> e : listSlice.entrySet()) {
            String sql = LoreSlices.get(e.getValue()).baseSql();
            assertTrue(sql.contains(" AS changed_at"), e.getValue() + ": среза без changed_at");
            for (Map<String, Object> s : (List<Map<String, Object>>) ((Map<String, Object>) type(e.getKey()).get("time")).get("changed")) {
                String src = String.valueOf(s.get("source"));
                String token = src.startsWith("version.") ? "out('HAS_STATE')[valid_to IS NULL].valid_from" : src;
                assertTrue(sql.contains(token), e.getKey() + ": источник " + src + " модели не читается срезом " + e.getValue());
            }
        }
    }

    /**
     * Технология: версия, тело и «проверено» читались {@code out('HAS_STATE').x[0]} — из
     * ПЕРВОГО ребра, а не из открытой версии. При второй версии (смена номера открывает
     * версию, LoreSpecResource) паспорт показывал бы прежнюю. Читать — открытую.
     */
    @Test
    void techReadsTheOpenVersion() {
        for (String id : List.of("tech_registry", "tech_by_id")) {
            String sql = LoreSlices.get(id).baseSql();
            for (String f : List.of("version", "content_md", "valid_from"))
                assertFalse(sql.contains("out('HAS_STATE')." + f + "[0]"), id + ": " + f + " из первого ребра, а не из открытой версии");
            assertTrue(sql.contains("out('HAS_STATE')[valid_to IS NULL].version[0]"), id + ": версия — из открытой строки");
        }
    }
}
