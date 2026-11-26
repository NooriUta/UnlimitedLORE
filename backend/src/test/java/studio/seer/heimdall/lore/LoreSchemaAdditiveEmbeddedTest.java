package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import com.arcadedb.schema.DocumentType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Владелец 25.11.2026: «доделай из модели и подчисти версионирование, а то следующие будут тоже делать».
 *
 * <p>Прод после 1.18 — база, собранная ИЗ МОДЕЛИ (отметка LoreModelSchema, журнала шагов V нет). Шаги V на неё не
 * катятся по построению, а после 1.18 схему продолжали менять шагами V94–V100 — на проде их не было: ни KnowKind,
 * ни KnowSkill, ни посева скиллов и областей. Доводка схемы кода ({@link LoreSchemaAdditive}) — единственный путь
 * изменений схемы после 1.18: аддитивно (IF NOT EXISTS), посевы — только недостающее, данные не трогаются.
 *
 * <p>Здесь — настоящая ArcadeDB (встроенный движок, без сервера и без Quarkus): база «как из модели» и база «после
 * шагов V» доводятся одним и тем же путём.
 */
class LoreSchemaAdditiveEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    /** Типы, которые установщик заводит из модели 1.18 (подмножество, нужное доводке), с данными. */
    private static final List<String> MODEL_TYPES = List.of("KnowTag", "KnowDictEntry", "KnowDictEntryHist", "KnowGitProject", "KnowUser", "KnowTask", "ClRoutineMetric");

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-additive-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    /** Исполнитель SQL поверх встроенной базы — та же форма, что у раннера поверх REST ArcadeDB. */
    private List<Map<String, Object>> sql(String s, Map<String, Object> p) {
        List<Map<String, Object>> out = new ArrayList<>();
        Runnable r = () -> db.command("sql", s, p).stream().forEach(x -> out.add(x.toMap()));
        if (s.trim().toUpperCase().matches("^(CREATE|ALTER|DROP) (VERTEX TYPE|EDGE TYPE|DOCUMENT TYPE|PROPERTY|INDEX).*")) r.run();
        else db.transaction(r::run);
        return out;
    }

    private final LoreSchemaAdditive.Sql exec = this::sql;

    /** База, как её собирает перенос/установщик из модели: типы модели с mig_src_rid, отметка LoreModelSchema. */
    private void modelDatabase() {
        for (String t : MODEL_TYPES) {
            sql("CREATE VERTEX TYPE " + t, Map.of());
            sql("CREATE PROPERTY " + t + ".mig_src_rid STRING", Map.of());
            sql("CREATE INDEX ON " + t + " (mig_src_rid) UNIQUE", Map.of());
        }
        sql("CREATE PROPERTY KnowTag.tag_id STRING", Map.of());
        sql("CREATE VERTEX TYPE LoreModelSchema", Map.of());
        sql("CREATE EDGE TYPE HAS_STATE", Map.of());
        // связь модели (keep): есть; OWNED_BY — нарочно нет, доводка обязана завести конец ребра сама
        sql("CREATE EDGE TYPE BELONGS_TO_PROJECT", Map.of());
        sql("INSERT INTO LoreModelSchema SET model_hash = 'd7e16a827891d5e0', model_version = 1, source = 'installer', built_at = '2026-11-21T00:00:00Z'", Map.of());
        sql("INSERT INTO KnowTag SET tag_id = 'tag:infra', mig_src_rid = '#1:1'", Map.of());
        sql("INSERT INTO KnowTag SET tag_id = 'legacy token', mig_src_rid = '#1:2'", Map.of());
        sql("INSERT INTO KnowGitProject SET slug = 'NooriUta/UnlimitedLORE', name = 'UnlimitedLORE', mig_src_rid = '#2:1'", Map.of());
        sql("INSERT INTO KnowUser SET kc_sub = 'sub-1', display_name = 'Owner', mig_src_rid = '#3:1'", Map.of());
        sql("INSERT INTO KnowTask SET task_uid = 'SPRINT_X/T-1', mig_src_rid = '#4:1'", Map.of());
        for (String code : List.of("full", "tester", "architect"))
            sql("INSERT INTO KnowDictEntry SET dict_type = 'agent_profile', code = :c, label_ru = :c, mig_src_rid = :r", Map.of("c", code, "r", "#5:" + code));
        // область, правленная человеком: цвет не из посева — доводка его не переписывает
        sql("INSERT INTO KnowDictEntry SET dict_type = 'area', code = 'platform', label_ru = 'Платформа', color = 'red', mig_src_rid = '#5:p'", Map.of());
        sql("INSERT INTO KnowDictEntry SET dict_type = 'area', code = 'research', label_ru = 'Исследования', mig_src_rid = '#5:r'", Map.of());
    }

    private long count(String type) {
        return ((Number) sql("SELECT count(*) AS n FROM " + type, Map.of()).get(0).get("n")).longValue();
    }

    private Map<String, Long> counts(List<String> types) {
        Map<String, Long> m = new TreeMap<>();
        for (String t : types) m.put(t, count(t));
        return m;
    }

    private Map<String, Object> marker() {
        List<Map<String, Object>> rows = sql("SELECT version, hash, applied_at, changes FROM " + LoreSchemaAdditive.MARKER_TYPE, Map.of());
        assertEquals(1, rows.size(), "отметка схемы кода — одна строка: " + rows);
        return new LinkedHashMap<>(rows.get(0));
    }

    @Test
    void базаИзМодели_доводитсяДоСхемыКода_повторНичегоНеМеняет_данныеНеТронуты() {
        modelDatabase();
        List<String> data = List.of("KnowTag", "KnowGitProject", "KnowUser", "KnowTask", "LoreModelSchema");
        Map<String, Long> before = counts(data);
        long dictBefore = count("KnowDictEntry");
        Map<String, Object> modelMarkerBefore = sql("SELECT model_hash, model_version, source, built_at FROM LoreModelSchema", Map.of()).get(0);

        LoreSchemaAdditive.Report first = LoreSchemaAdditive.apply(exec);

        // типы и рёбра шагов V94/V96 и конец ребра посева
        for (String t : List.of("KnowKind", "KnowKindHist", "KnowSkill", "APPLIES_TO_ROLE", "SKILL_EXTENDS", "OWNED_BY", LoreSchemaAdditive.MARKER_TYPE))
            assertTrue(db.getSchema().existsType(t), "тип " + t + " заведён доводкой");
        // поля супертегов V95
        DocumentType tag = db.getSchema().getType("KnowTag");
        for (String f : List.of("name", "title", "source", "field_schema", "synonyms", "owner"))
            assertTrue(tag.existsProperty(f), "KnowTag." + f);
        // индексы V94/V96
        assertTrue(db.getSchema().getType("KnowKind").getIndexesByProperties("kind").stream().anyMatch(i -> i.isUnique()), "KnowKind(kind) UNIQUE");
        assertTrue(db.getSchema().getType("KnowSkill").getIndexesByProperties("skill_id").stream().anyMatch(i -> i.isUnique()), "KnowSkill(skill_id) UNIQUE");

        // посевы V97: словарь skill_status и три скилла с рёбрами
        assertEquals(3, count("KnowSkill"));
        List<Object> ids = sql("SELECT skill_id FROM KnowSkill ORDER BY skill_id", Map.of()).stream().map(r -> r.get("skill_id")).toList();
        assertEquals(List.of("skill:adr-review", "skill:qg-triage", "skill:release-cutover"), ids);
        assertEquals(3, ((Number) sql("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type = 'skill_status'", Map.of()).get(0).get("n")).intValue());
        assertEquals(5, count("APPLIES_TO_ROLE"), "роли посевных скиллов: full; full+tester; full+architect");
        assertEquals(3, ((Number) sql("SELECT count(*) AS n FROM BELONGS_TO_PROJECT", Map.of()).get(0).get("n")).intValue());

        // посев V100: 13 областей, правленная человеком не переписана
        List<Map<String, Object>> areas = sql("SELECT code, color FROM KnowDictEntry WHERE dict_type = 'area'", Map.of());
        for (StatusDictCoreSeed.Entry e : AreaDictSeed.AREA)
            assertTrue(areas.stream().anyMatch(a -> e.code().equals(a.get("code"))), "область " + e.code());
        assertEquals(14, areas.size(), "13 областей посева + research; platform не задвоена: " + areas);
        assertEquals("red", areas.stream().filter(a -> "platform".equals(a.get("code"))).findFirst().orElseThrow().get("color"));
        // посев доводки v3 (ISS-02-DICT-SEED-GUARD): task_type 9, priority 4, agent_profile 5 (full, tester, architect уже были)
        assertEquals(9, ((Number) sql("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type = 'task_type'", Map.of()).get(0).get("n")).intValue());
        assertEquals(4, ((Number) sql("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type = 'priority'", Map.of()).get(0).get("n")).intValue());
        assertEquals(8, ((Number) sql("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type = 'agent_profile'", Map.of()).get(0).get("n")).intValue(),
            "профили не задвоены");
        // доводка v4 (AP-APPEARANCE, AUD-AREA-COLORS 5а): подписи шести палитр и поле своего стиля tokens_json
        assertEquals(6, ((Number) sql("SELECT count(*) AS n FROM KnowDictEntry WHERE dict_type = 'palette'", Map.of()).get(0).get("n")).intValue());
        assertTrue(db.getSchema().getType("KnowDictEntry").existsProperty("tokens_json"), "KnowDictEntry.tokens_json");
        assertTrue(db.getSchema().getType("KnowDictEntryHist").existsProperty("tokens_json"), "KnowDictEntryHist.tokens_json");
        assertEquals(dictBefore + 3 + 12 + 18 + 6, count("KnowDictEntry"), "словарь: +3 skill_status, +12 областей (platform уже была), +18 словарей UI, +6 палитр");

        // отчёт доводки — что она сделала
        assertTrue(first.changed(), "первая доводка что-то сделала: " + first);
        assertTrue(first.types() >= 6, "типов заведено: " + first);
        assertTrue(first.properties() >= 6, "свойств заведено: " + first);
        assertTrue(first.indexes() >= 4, "индексов заведено: " + first);
        assertEquals(3 + 3 + 12 + 18 + 6, first.seeded(), "посеяно: skill_status 3 + скиллы 3 + области 12 + словари UI 18 + палитры 6: " + first);

        // отметка схемы кода: номер и хэш кода
        Map<String, Object> m1 = marker();
        assertEquals(LoreSchemaAdditive.VERSION, ((Number) m1.get("version")).intValue());
        assertEquals(LoreSchemaAdditive.hash(), m1.get("hash"));

        // существующие данные не тронуты: счёт и отметка модели
        assertEquals(before, counts(data), "доводка не меняет число записей существующих типов");
        assertEquals(List.of("legacy token", "tag:infra"),
            sql("SELECT tag_id FROM KnowTag ORDER BY tag_id", Map.of()).stream().map(r -> r.get("tag_id")).toList());
        assertEquals(modelMarkerBefore, sql("SELECT model_hash, model_version, source, built_at FROM LoreModelSchema", Map.of()).get(0),
            "отметку модели доводка не трогает");

        // повтор — ноль изменений
        Map<String, Long> all = counts(List.of("KnowTag", "KnowGitProject", "KnowUser", "KnowTask", "LoreModelSchema", "KnowDictEntry",
            "KnowSkill", "APPLIES_TO_ROLE", "BELONGS_TO_PROJECT", "KnowKind", LoreSchemaAdditive.MARKER_TYPE));
        LoreSchemaAdditive.Report second = LoreSchemaAdditive.apply(exec);
        assertFalse(second.changed(), "повторная доводка — 0 изменений: " + second);
        assertEquals(0, second.types() + second.properties() + second.indexes() + second.seeded(), String.valueOf(second));
        assertEquals(all, counts(List.copyOf(all.keySet())), "повтор не меняет число записей");
        assertEquals(m1, marker(), "повтор не переписывает отметку схемы кода");
    }

    @Test
    void базаПослеШаговV_уже_на_схеме_кода_доводкаТолькоОтмечает() {
        modelDatabase();
        // база шагов V: V94–V96 уже накатились своим SQL — доводка обязана совпасть с ними до стейтмента
        for (LoreSchemaMigrations.Step s : LoreSchemaMigrations.STEPS)
            if (LoreSchemaAdditive.FROM_V_STEPS.containsKey(s.version())) for (String q : s.sql()) sql(q, Map.of());
        LoreSchemaAdditive.Report r = LoreSchemaAdditive.apply(exec);
        // DDL шагов V совпадает с доводкой: новыми остаются только конец ребра посева, отметка и то, что пришло
        // после заморозки шагов V (доводка v2: ClRoutineMetric.basis, QG-07)
        // доводка v5 (AP-PASSPORT-EDIT): пять цепочек истории боли/выгоды/работы/роли/фичи — 11 служебных полей у каждой
        // (время, ключ, версия, хэш, автор) + поля снимка (22) и по три индекса
        int histProps = ProductHistory.SPECS.size() * 11 + ProductHistory.SPECS.stream().mapToInt(s -> s.fields().size()).sum();
        assertEquals(1 + ProductHistory.SPECS.size(), r.types(), "после шагов V нового — конец ребра OWNED_BY и цепочки доводки v5: " + r);
        assertEquals(3 + histProps, r.properties(), "свойства шагов V и доводки совпадают; новое после V100 — ClRoutineMetric.basis, tokens_json словаря и его истории, поля цепочек v5: " + r);
        assertEquals(3 * ProductHistory.SPECS.size(), r.indexes(), "индексы шагов V и доводки совпадают; новые — у цепочек v5: " + r);
        assertEquals(LoreSchemaAdditive.VERSION, ((Number) marker().get("version")).intValue());
        assertFalse(LoreSchemaAdditive.apply(exec).changed(), "повтор — 0 изменений");
    }

    /**
     * SPRINT_QG_REBUILD/QG-07, доводка v2: «база» метрики прогона (отпечаток знаменателя). На базе из модели после
     * доводки поле есть, существующие замеры не тронуты, повтор — 0 изменений.
     */
    @Test
    void базаИзМодели_доводкаV2_заводитBasisМетрикиПрогона_повторНоль() {
        modelDatabase();
        sql("INSERT INTO ClRoutineMetric SET metric_id = 'r1_k', value = 78.1, mig_src_rid = '#6:1'", Map.of());
        assertFalse(db.getSchema().getType("ClRoutineMetric").existsProperty("basis"), "до доводки поля нет");

        LoreSchemaAdditive.Report first = LoreSchemaAdditive.apply(exec);
        assertTrue(first.changes().contains("qg_metric_basis"), "запись доводки qg_metric_basis применена: " + first);
        assertTrue(db.getSchema().getType("ClRoutineMetric").existsProperty("basis"), "ClRoutineMetric.basis после доводки v2");
        assertEquals(LoreSchemaAdditive.VERSION, ((Number) marker().get("version")).intValue(), "отметка схемы кода — текущий номер (v2 и новее)");
        assertEquals(1, count("ClRoutineMetric"), "замеры не тронуты");

        LoreSchemaAdditive.Report second = LoreSchemaAdditive.apply(exec);
        assertFalse(second.changed(), "повтор — 0 изменений: " + second);
        assertTrue(second.changes().isEmpty(), String.valueOf(second));
    }

    @Test
    void отметкаСхемыКода_читаетсяИСравниваетсяСКодом() {
        modelDatabase();
        assertNull(LoreSchemaAdditive.appliedVersion(exec), "доводки не было — номера нет, а не 0 и не ошибка");
        LoreSchemaAdditive.apply(exec);
        assertEquals(LoreSchemaAdditive.VERSION, LoreSchemaAdditive.appliedVersion(exec));
    }
}
