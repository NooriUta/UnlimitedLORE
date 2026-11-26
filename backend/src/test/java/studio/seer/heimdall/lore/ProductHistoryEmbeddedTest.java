package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (владелец 25.11.2026: «историчность доделываем») — живой цикл истории боли,
 * выгоды, работы, роли продукта и фичи на настоящей ArcadeDB (встроенный движок, без сервера и без Quarkus):
 * доводка v5 заводит цепочки и сеет начальную версию «как есть» (повтор — ноль вставок); правка поля открывает новую
 * версию и закрывает прежнюю; повтор той же правки версии не множит; запрос истории отдаёт версии со снимком полей.
 */
class ProductHistoryEmbeddedTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        dir = Files.createTempDirectory("lore-product-hist-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
    }

    @AfterEach
    void close() {
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    private List<Map<String, Object>> run(String lang, String s, Map<String, Object> p) {
        List<Map<String, Object>> out = new ArrayList<>();
        Runnable r = () -> db.command(lang, s, p).stream().forEach(x -> out.add(x.toMap()));
        if ("sql".equals(lang) && s.trim().toUpperCase().matches("^(CREATE|ALTER|DROP) (VERTEX TYPE|EDGE TYPE|DOCUMENT TYPE|PROPERTY|INDEX).*")) r.run();
        else db.transaction(r::run);
        return out;
    }

    private List<Map<String, Object>> sql(String s, Map<String, Object> p) { return run("sql", s, p); }

    private final LoreSchemaAdditive.Sql exec = this::sql;
    private final ProductHistory.Exec write = this::run;

    private long count(String q, Map<String, Object> p) {
        return ((Number) sql(q, p).get(0).get("n")).longValue();
    }

    /** База из модели: вершины пяти типов с записями, заведёнными до доводки (истории у них нет). */
    private void modelDatabase() {
        // типы модели, которые читают прочие записи доводки (как в LoreSchemaAdditiveEmbeddedTest), и пять типов паспорта
        for (String t : List.of("KnowTag", "KnowDictEntry", "KnowDictEntryHist", "KnowUser", "KnowTask", "ClRoutineMetric",
                "KnowPain", "KnowGain", "KnowJob", "KnowProjectActor", "KnowUseCase", "KnowGitProject"))
            sql("CREATE VERTEX TYPE " + t, Map.of());
        sql("CREATE EDGE TYPE HAS_STATE", Map.of());
        sql("CREATE EDGE TYPE BELONGS_TO_PROJECT", Map.of());
        sql("INSERT INTO KnowPain SET pain_id = 'PAIN-SLOW', title = 'Медленно', severity = 'high', body_md = 'ищу долго'", Map.of());
        sql("INSERT INTO KnowPain SET pain_id = 'PAIN-LOST', title = 'Теряется контекст'", Map.of());
        sql("INSERT INTO KnowGain SET gain_id = 'GAIN-FAST', title = 'Быстро', rank = 'essential', metric_md = '< 1 c'", Map.of());
        sql("INSERT INTO KnowJob SET job_id = 'JOB-FIND', title = 'Найти решение', kind = 'functional', importance = 'high'", Map.of());
        sql("INSERT INTO KnowProjectActor SET actor_id = 'ACT-OWNER', name = 'Владелица', kind = 'human-role'", Map.of());
        sql("INSERT INTO KnowUseCase SET uc_id = 'FEAT-HIST', title = 'История паспорта', goal_level = 'cloud', body_md = 'v1'", Map.of());
        sql("INSERT INTO KnowGitProject SET slug = 'AIDA/UnlimitedLORE'", Map.of());
        sql("CREATE EDGE BELONGS_TO_PROJECT FROM (SELECT FROM KnowUseCase WHERE uc_id = 'FEAT-HIST') TO (SELECT FROM KnowGitProject)", Map.of());
    }

    private List<Map<String, Object>> history(String type, String id) {
        return sql(LoreEntityHistory.sql(type), Map.of("id", id));
    }

    @Test
    void посевНачальнойВерсии_какЕсть_идемпотентен() {
        modelDatabase();
        LoreSchemaAdditive.Report first = LoreSchemaAdditive.apply(exec);
        assertTrue(first.changes().contains("product_history"), String.valueOf(first));
        long seededVersions = ProductHistory.SPECS.stream().mapToLong(s -> count("SELECT count(*) AS n FROM " + s.hist(), Map.of())).sum();
        assertEquals(6, seededVersions, "по начальной версии каждой из шести записей пяти типов: " + first);
        assertTrue(first.seeded() >= 6, "посев версий входит в отчёт доводки: " + first);
        for (ProductHistory.Spec s : ProductHistory.SPECS) {
            assertTrue(db.getSchema().existsType(s.hist()), s.hist());
            assertEquals(0, count("SELECT count(*) AS n FROM " + s.vertex() + " WHERE out('HAS_STATE').size() <> 1", Map.of()),
                s.vertex() + ": у каждой записи ровно одна версия");
            assertEquals(0, count("SELECT count(*) AS n FROM " + s.hist() + " WHERE valid_to IS NOT NULL", Map.of()),
                s.hist() + ": начальная версия открыта");
        }
        // «как есть»: снимок — текущие поля записи; автор не установлен (правил не человек и не агент)
        List<Map<String, Object>> pain = history("pain", "PAIN-SLOW");
        assertEquals(1, pain.size());
        assertEquals("Медленно", pain.get(0).get("title"));
        assertEquals("high", pain.get(0).get("severity"));
        assertEquals("ищу долго", pain.get(0).get("body_md"));
        assertEquals(ChangeAuthor.KIND_UNKNOWN, pain.get(0).get("changed_by_kind"));
        assertNotNull(pain.get(0).get("valid_from"));
        assertEquals("Владелица", history("actor", "ACT-OWNER").get(0).get("name"));
        assertEquals(List.of("AIDA/UnlimitedLORE"), List.copyOf((java.util.Collection<?>) history("feature", "FEAT-HIST").get(0).get("projects")));

        // повтор — ноль вставок, число версий прежнее
        long versions = count("SELECT count(*) AS n FROM KnowPainHist", Map.of());
        LoreSchemaAdditive.Report second = LoreSchemaAdditive.apply(exec);
        assertEquals(0, second.seeded(), "повторный посев — ноль: " + second);
        assertFalse(second.changed(), String.valueOf(second));
        assertEquals(versions, count("SELECT count(*) AS n FROM KnowPainHist", Map.of()));

        // запись с уже начатой историей посев не трогает: только недостающее
        sql("INSERT INTO KnowPain SET pain_id = 'PAIN-NEW', title = 'Новая'", Map.of());
        assertEquals(1, ProductHistory.seed(exec, java.util.Set.of("KnowPain", "KnowPainHist")), "новой записи без истории — одна версия");
        assertEquals(0, ProductHistory.seed(exec, java.util.Set.of("KnowPain", "KnowPainHist")));
    }

    @Test
    void правкаПоля_новаяВерсия_повтор_безНовой_историяОтдаётВерсии() {
        modelDatabase();
        LoreSchemaAdditive.apply(exec);
        ChangeAuthor human = new ChangeAuthor("sub-owner", ChangeAuthor.KIND_HUMAN);

        // правка названия боли путём записи (UPSERT пишет вершину) → новая версия
        sql("UPDATE KnowPain SET title = 'Медленный поиск' WHERE pain_id = 'PAIN-SLOW'", Map.of());
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "pain", "PAIN-SLOW", human));
        List<Map<String, Object>> h = history("pain", "PAIN-SLOW");
        assertEquals(2, h.size(), "начальная + правка");
        assertEquals("Медленно", h.get(0).get("title"), "прежнее значение сохранилось в закрытой версии");
        assertNotNull(h.get(0).get("valid_to"), "прежняя закрыта");
        assertEquals("Медленный поиск", h.get(1).get("title"));
        assertNull(h.get(1).get("valid_to"), "новая открыта");
        assertEquals("sub-owner", h.get(1).get("changed_by"), "автор правки — из токена");
        assertEquals(ChangeAuthor.KIND_HUMAN, h.get(1).get("changed_by_kind"));

        // повтор той же правки → без новой версии
        sql("UPDATE KnowPain SET title = 'Медленный поиск' WHERE pain_id = 'PAIN-SLOW'", Map.of());
        assertEquals(ProductHistory.Step.NONE, ProductHistory.version(write, "pain", "PAIN-SLOW", human));
        assertEquals(2, history("pain", "PAIN-SLOW").size(), "повтор версию не множит");
        assertEquals(1, count("SELECT count(*) AS n FROM KnowPainHist WHERE valid_to IS NULL AND pain_id = 'PAIN-SLOW'", Map.of()),
            "открытая версия одна");

        // каждый из пяти типов: правка поля снимка → новая версия
        sql("UPDATE KnowGain SET rank = 'expected' WHERE gain_id = 'GAIN-FAST'", Map.of());
        sql("UPDATE KnowJob SET importance = 'normal' WHERE job_id = 'JOB-FIND'", Map.of());
        sql("UPDATE KnowProjectActor SET name = 'Владелица продукта' WHERE actor_id = 'ACT-OWNER'", Map.of());
        sql("UPDATE KnowUseCase SET body_md = 'v2' WHERE uc_id = 'FEAT-HIST'", Map.of());
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "gain", "GAIN-FAST", human));
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "job", "JOB-FIND", human));
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "actor", "ACT-OWNER", human));
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "feature", "FEAT-HIST", human));
        assertEquals("expected", history("gain", "GAIN-FAST").get(1).get("rank"));
        assertEquals("Владелица продукта", history("actor", "ACT-OWNER").get(1).get("name"));
        assertEquals("v1", history("feature", "FEAT-HIST").get(0).get("body_md"));
        assertEquals("v2", history("feature", "FEAT-HIST").get(1).get("body_md"));

        // поле вне снимка (отметка правки) версию не открывает
        sql("UPDATE KnowUseCase SET updated_at = '2026-11-25T23:00:00Z' WHERE uc_id = 'FEAT-HIST'", Map.of());
        assertEquals(ProductHistory.Step.NONE, ProductHistory.version(write, "feature", "FEAT-HIST", human));

        // запись, заведённая после доводки (через «+ Новая»), получает первую версию на своей записи
        sql("INSERT INTO KnowJob SET job_id = 'JOB-NEW', title = 'Новая работа'", Map.of());
        assertEquals(ProductHistory.Step.FIRST, ProductHistory.version(write, "job", "JOB-NEW", human));
        assertEquals(1, history("job", "JOB-NEW").size());
        // записи нет — писать версию нечему
        assertEquals(ProductHistory.Step.NONE, ProductHistory.version(write, "job", "JOB-NOPE", human));
    }

    /**
     * Один момент на одну запись (CI #1827, FreshnessChangedAtLiveDbTest: changed_at сценария ушёл на 4 мс позже
     * updated_at). Путь записи ставит на вершине updated_at и сразу открывает версию истории; срез отдаёт в
     * changed_at максимум из valid_from открытой версии и updated_at. Если версия берёт СВОИ часы, она всегда
     * чуть позже отметки — и changed_at перестаёт совпадать с моментом записи. Версия обязана нести момент,
     * переданный путём записи, — тот же, что лёг в updated_at.
     */
    @Test
    void версияНесётМоментЗаписи_аНеСвоиЧасы() {
        modelDatabase();
        LoreSchemaAdditive.apply(exec);
        ChangeAuthor human = new ChangeAuthor("sub-owner", ChangeAuthor.KIND_HUMAN);
        // Момент записи позже посева (иначе версия встала бы раньше начальной) и заведомо не «сейчас» этой JVM.
        java.time.Instant writeMoment = java.time.Instant.now().plusSeconds(60).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);

        sql("UPDATE KnowUseCase SET body_md = 'v2', updated_at = :u WHERE uc_id = 'FEAT-HIST'", Map.of("u", writeMoment.toString()));
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.version(write, "feature", "FEAT-HIST", human, writeMoment));
        List<Map<String, Object>> h = history("feature", "FEAT-HIST");
        Map<String, Object> open = h.get(h.size() - 1);
        assertNull(open.get("valid_to"), "последняя версия открыта: " + h);
        assertEquals(writeMoment, DataHygieneMigrationsLiveDbTest.at(open.get("valid_from")),
            "valid_from новой версии = момент записи (updated_at), а не свои часы");
        assertEquals(writeMoment, DataHygieneMigrationsLiveDbTest.at(h.get(h.size() - 2).get("valid_to")),
            "прежняя версия закрыта тем же моментом — без щели и наложения");

        // первая версия записи, заведённой после доводки, — тоже момент записи
        java.time.Instant created = writeMoment.plusSeconds(60).plusMillis(1);
        sql("INSERT INTO KnowJob SET job_id = 'JOB-AT', title = 'Работа', updated_at = :u", Map.of("u", created.toString()));
        assertEquals(ProductHistory.Step.FIRST, ProductHistory.version(write, "job", "JOB-AT", human, created));
        assertEquals(created, DataHygieneMigrationsLiveDbTest.at(history("job", "JOB-AT").get(0).get("valid_from")));
    }
}
