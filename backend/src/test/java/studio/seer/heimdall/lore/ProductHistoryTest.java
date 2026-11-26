package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_ADMIN_POLISH/AP-PASSPORT-EDIT (владелец 25.11.2026: «историчность доделываем»). Правка боли, выгоды,
 * работы, роли продукта и фичи (PR #1829) не попадала в «Историю»: SCD2-цепочек у этих типов не было. Здесь — чистые
 * правила (без базы): какая версия пишется после правки, что она несёт и что история стала «одним путём» для пяти типов.
 * Живой цикл на настоящей ArcadeDB — {@link ProductHistoryEmbeddedTest}.
 */
class ProductHistoryTest {

    private static final List<String> WAVE1 = List.of("pain", "gain", "job", "actor", "feature");

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void правкаПоля_новаяВерсия_повторТойЖе_безВерсии_первойНет_первая() {
        ProductHistory.Spec s = ProductHistory.spec("pain");
        String was = ProductHistory.hashOf(s, row("title", "Медленно", "severity", "high", "body_md", "x"));
        String now = ProductHistory.hashOf(s, row("title", "Медленный поиск", "severity", "high", "body_md", "x"));
        assertNotEquals(was, now, "правка поля снимка меняет хэш");
        assertEquals(ProductHistory.Step.NEXT, ProductHistory.decide(now, true, was), "правка поля → новая версия");
        assertEquals(ProductHistory.Step.NONE, ProductHistory.decide(now, true, now), "повтор той же правки → без версии");
        assertEquals(ProductHistory.Step.FIRST, ProductHistory.decide(now, false, null), "версии нет → первая");
        // поле вне снимка (date_created, updated_at) версию не открывает
        assertEquals(now, ProductHistory.hashOf(s, row("title", "Медленный поиск", "severity", "high", "body_md", "x", "date_created", "2026-11-25")));
    }

    @Test
    void скриптВерсии_закрываетСтаруюИОткрываетНовую_сАвторомИСнимком() {
        for (String t : WAVE1) {
            ProductHistory.Spec s = ProductHistory.spec(t);
            String next = ProductHistory.script(s, ProductHistory.Step.NEXT);
            assertTrue(next.contains("UPDATE " + s.hist() + " SET valid_to = :now"), t + ": закрыть открытую");
            assertTrue(next.contains("AND valid_to IS NULL"), t + ": закрывается только ещё открытая (S2-09)");
            assertTrue(next.contains("INSERT INTO " + s.hist() + " SET " + s.key() + " = :id"), t + ": открыть новую");
            assertTrue(next.contains(ChangeAuthor.SET_SQL), t + ": версия несёт автора (S2-12)");
            for (String f : s.fields()) assertTrue(next.contains(f + " = :f_" + f), t + ": снимок поля " + f);
            assertTrue(next.contains("CREATE EDGE HAS_STATE FROM (SELECT FROM " + s.vertex()), t + ": ребро версии");
            String first = ProductHistory.script(s, ProductHistory.Step.FIRST);
            assertTrue(first.contains("LET opened = SELECT FROM " + s.hist()), t + ": первая — только если открытой нет (S2-15)");
            assertFalse(first.contains("SET valid_to"), t + ": первой нечего закрывать");
        }
    }

    @Test
    void пятьТиповСтали_историчными_одинПутьИстории() {
        for (String t : WAVE1) {
            ProductHistory.Spec s = ProductHistory.spec(t);
            assertEquals(t, LoreSlices.HIST_PARENT.get(s.hist()).entityType(), t + ": пара цепочки в HIST_PARENT");
            assertEquals(s.key(), LoreSlices.HIST_PARENT.get(s.hist()).idField(), t);
            assertTrue(LoreSchemaMigrations.HIST_VALID_FROM_TEMPORAL.contains(s.hist()), t + ": время версии — DATETIME (RM-P13)");
            assertTrue(LoreEntityHistory.types().contains(t), t + ": дверь /lore/history");
            assertEquals(s.hist(), LoreModelTypes.GRAPH.get(t).hist(), t + ": модель называет цепочку");
            assertEquals(Boolean.TRUE, LoreRecordHistory.flag(t).get("available"), t + ": паспорт говорит «история есть»");
        }
        // родитель цепочки — вершина паспорта (заголовок истории берётся с неё)
        assertEquals("KnowUseCase", ProductHistory.spec("feature").vertex());
        assertTrue(LoreEntityHistory.titleSql("actor").contains("FROM KnowProjectActor "));
    }

    @Test
    void срезИстории_отдаётСнимокПолейВерсии() {
        for (String t : WAVE1) {
            ProductHistory.Spec s = ProductHistory.spec(t);
            String sql = LoreEntityHistory.sql(t);
            assertTrue(sql.contains(" FROM " + s.hist() + " "), t + ": читает свою цепочку");
            for (String f : s.fields()) assertTrue(sql.contains(", " + f), t + ": поле снимка " + f + " в ответе истории");
        }
    }

    @Test
    void профильКлиента_глобальный_фича_поПроекту() {
        // pains/gains/jobs/actors — общие продуктовые вершины (AL-106, AL-113): скоуп истории их не режет
        for (String t : List.of("pain", "gain", "job", "actor")) assertTrue(LoreEntityHistory.isGlobal(t), t);
        assertFalse(LoreEntityHistory.isGlobal("feature"), "фича — по проекту, как срез features");
        assertTrue(LoreEntityHistory.sql("feature").contains("in('HAS_STATE').out('BELONGS_TO_PROJECT').slug AS projects"));
        assertTrue(LoreEntityHistory.sql("feature").contains("in('DECOMPOSES_INTO').out('BELONGS_TO_PROJECT').slug AS projects_via"),
            "сценарий наследует проект родителя — как паспорт (uc_by_id)");
    }

    @Test
    void доводкаV5_заводитЦепочкиИСеетНачальнуюВерсию() {
        LoreSchemaAdditive.Change c = LoreSchemaAdditive.change("product_history");
        assertNotNull(c, "запись доводки product_history");
        assertNotNull(c.seed(), "посев начальной версии");
        for (ProductHistory.Spec s : ProductHistory.SPECS) {
            assertTrue(c.ddl().contains("CREATE VERTEX TYPE " + s.hist() + " IF NOT EXISTS"), s.hist());
            assertTrue(c.ddl().contains("CREATE PROPERTY " + s.hist() + ".valid_from IF NOT EXISTS DATETIME"), s.hist());
            assertTrue(c.ddl().contains("CREATE PROPERTY " + s.hist() + ".changed_by_kind IF NOT EXISTS STRING"), s.hist());
            assertTrue(c.ddl().contains("CREATE INDEX IF NOT EXISTS ON " + s.hist() + " (state_uid) UNIQUE"), s.hist());
            assertTrue(LoreSchemaInitializer.DDL.contains("CREATE VERTEX TYPE " + s.hist() + " IF NOT EXISTS"),
                s.hist() + ": свежая база шагов V знает цепочку до V77 (splitSharedStates читает каждую цепочку)");
        }
        assertTrue(ProductHistory.withoutHistorySql(ProductHistory.spec("pain")).contains("out('HAS_STATE').size() = 0"),
            "посев — только записям без истории");
    }
}
