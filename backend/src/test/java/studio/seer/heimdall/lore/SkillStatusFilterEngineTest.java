package studio.seer.heimdall.lore;

import com.arcadedb.database.Database;
import com.arcadedb.database.DatabaseFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_KNOW_REGISTRY/SKILL-04 · стенд-e2e RFD3 (run 11094): {@code skills?status=active} — 0 при трёх active.
 *
 * <p>Корень: посев скиллов (доводка схемы кода) идёт ДО включения переходника схемы модели
 * ({@code LoreSchemaMigrationRunner}: applyAdditive → ModelSchemaAdapter.enable) и пишет код словаря skill_status
 * как есть — {@code active}. Переходник на чтении считал status кодом справочника модели и поднимал значение
 * фильтра {@code WHERE status = :status} до {@code ACTIVE} — мимо данных. Он же на записи поднимал литерал
 * {@code status = 'draft'} создания скилла до {@code DRAFT} — в базе смесь регистров.
 *
 * <p>Чистый JUnit на встроенном ArcadeDB: SQL среза идёт через тот же переходник, что у клиента mart-api
 * ({@link ModelSchemaClientFilter}): rewriteSql + rewriteParams на запросе, adaptRows на ответе.
 */
class SkillStatusFilterEngineTest {

    private Path dir;
    private DatabaseFactory factory;
    private Database db;

    @BeforeEach
    void open() throws Exception {
        ModelSchemaAdapter.enable(false);
        dir = Files.createTempDirectory("lore-skill-status-");
        factory = new DatabaseFactory(dir.resolve("db").toString());
        db = factory.create();
    }

    @AfterEach
    void close() {
        ModelSchemaAdapter.enable(false);
        if (db != null) db.drop();
        if (factory != null) factory.close();
    }

    /** Как раннер поверх REST, без переходника. */
    private List<Map<String, Object>> raw(String s, Map<String, Object> p) {
        List<Map<String, Object>> out = new ArrayList<>();
        Runnable r = () -> db.command("sql", s, p).stream().forEach(x -> out.add(new LinkedHashMap<>(x.toMap())));
        if (s.trim().toUpperCase().matches("^(CREATE|ALTER|DROP) (VERTEX TYPE|EDGE TYPE|DOCUMENT TYPE|PROPERTY|INDEX).*")) r.run();
        else db.transaction(r::run);
        return out;
    }

    /** Как клиент mart-api на базе из модели: запрос и ответ — через переходник. */
    private List<Map<String, Object>> adapted(String s, Map<String, Object> p) {
        String sql = ModelSchemaAdapter.rewriteSql(s);
        List<Map<String, Object>> rows = raw(sql, SqlParams.complete(sql, ModelSchemaAdapter.rewriteParams(s, p)));
        ModelSchemaAdapter.adaptRows(rows);
        return rows;
    }

    private List<Map<String, Object>> slice(String id, Map<String, String> given) {
        LoreSlices.Composed c = LoreSlices.compose(id, given);
        return adapted(c.sql(), c.params());
    }

    private void skillDatabase() {
        for (String t : List.of("KnowDictEntry", "KnowGitProject", "KnowUser")) raw("CREATE VERTEX TYPE " + t, Map.of());
        raw("CREATE EDGE TYPE BELONGS_TO_PROJECT", Map.of());
        raw("CREATE EDGE TYPE OWNED_BY", Map.of());
        for (String ddl : LoreSchemaAdditive.KNOW_SKILL_DDL) raw(ddl, Map.of());
        // посев доводки — до включения переходника (порядок раннера)
        LoreSchemaAdditive.seedSkills(this::raw);
        ModelSchemaAdapter.enable(true);
        for (String id : List.of("skill:test-a", "skill:test-b")) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", id); p.put("name", id.substring(6)); p.put("title", "T"); p.put("body", "b");
            p.put("ver", null); p.put("src", "human"); p.put("now", "2026-11-26T00:00:00Z");
            adapted(LoreSkillResource.CREATE_SQL, p);
        }
    }

    @Test
    void фильтрStatus_видитПосевныеActive_иСозданныеDraft() {
        skillDatabase();
        List<Map<String, Object>> all = slice("skills", Map.of());
        assertEquals(5, all.size(), "без фильтра — все: " + all);
        long active = all.stream().filter(r -> "active".equals(r.get("status"))).count();
        assertEquals(3, active, "посевные — active: " + all);

        assertEquals(3, slice("skills", Map.of("status", "active")).size(), "skills?status=active = числу active без фильтра");
        assertEquals(3, slice("skills_full", Map.of("status", "active")).size(), "skills_full?status=active");
        assertEquals(2, slice("skills", Map.of("status", "draft")).size(), "skills?status=draft — созданные дверью");
    }

    @Test
    void созданиеСкилла_пишетКодСловаряSkillStatus_какЕсть() {
        skillDatabase();
        // смотрим мимо переходника: что лежит в базе
        List<Map<String, Object>> stored = raw("SELECT skill_id, status FROM KnowSkill ORDER BY skill_id", Map.of());
        for (Map<String, Object> r : stored)
            assertTrue(SkillRules.STATUSES.contains(String.valueOf(r.get("status"))),
                "статус скилла — код словаря skill_status (" + SkillRules.STATUSES + "), не поднятый регистр: " + stored);
    }

    /** Общее правило, не кейс скиллов: любой тип доводки с полем status — в списке «регистр своего словаря». */
    @Test
    void всеТипыДоводкиСоStatus_вСпискеСвоегоСловаря() {
        java.util.regex.Pattern p = java.util.regex.Pattern.compile("(?i)CREATE PROPERTY (\\w+)\\.status\\s");
        java.util.Set<String> withStatus = new java.util.TreeSet<>();
        for (LoreSchemaAdditive.Change c : LoreSchemaAdditive.CHANGES)
            for (String ddl : c.ddl()) { var m = p.matcher(ddl); if (m.find()) withStatus.add(m.group(1)); }
        assertTrue(withStatus.contains("KnowSkill"), "положительный контроль: KnowSkill.status найден в DDL доводки: " + withStatus);
        for (String t : withStatus)
            assertTrue(ModelSchemaAdapter.OWN_DICT_STATUS_TYPES.contains(t) || ModelSchemaAdapter.TEXT_STATUS_TYPES.contains(t),
                "тип доводки " + t + " со status — в ModelSchemaAdapter.OWN_DICT_STATUS_TYPES (иначе переходник поднимет регистр мимо посева)");
    }

    @Test
    void строкиСтарогоРегистра_наСтенде_тожеПопадаютПодФильтр() {
        skillDatabase();
        // до правки дверь писала DRAFT/ACTIVE заглавными — такие строки уже лежат на стенде
        raw("INSERT INTO KnowSkill SET skill_id = 'skill:legacy-up', status = 'ACTIVE'", Map.of());
        assertEquals(4, slice("skills", Map.of("status", "active")).size(), "ACTIVE старой записи — тоже active");
    }
}
