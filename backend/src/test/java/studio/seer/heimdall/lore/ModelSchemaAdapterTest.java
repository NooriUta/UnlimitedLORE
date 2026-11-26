package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MIG-03 · переходник чтения для базы, собранной из модели: поле версии status_raw
 * в новой схеме называется status (код справочника), а клиенты читают ключ status_raw «значок + слово».
 */
class ModelSchemaAdapterTest {

    @Test
    void обращения_к_полю_в_условии_и_выражении_идут_в_status() {
        assertEquals("SELECT FROM KnowTaskHist WHERE status LIKE 'DONE%'",
            ModelSchemaAdapter.rewriteSql("SELECT FROM KnowTaskHist WHERE status_raw LIKE 'DONE%'"));
        assertEquals("SELECT out('HAS_STATE').last().status AS st FROM KnowTask",
            ModelSchemaAdapter.rewriteSql("SELECT out('HAS_STATE').last().status_raw AS st FROM KnowTask"));
        assertEquals("SELECT h.status AS status_raw FROM KnowTaskHist",
            ModelSchemaAdapter.rewriteSql("SELECT h.status_raw AS status_raw FROM KnowTaskHist"));
    }

    @Test
    void поле_без_псевдонима_в_выборке_сохраняет_ключ_ответа() {
        assertEquals("SELECT task_id, status AS status_raw FROM KnowTaskHist",
            ModelSchemaAdapter.rewriteSql("SELECT task_id, status_raw FROM KnowTaskHist"));
        assertEquals("SELECT status AS status_raw, valid_from FROM KnowTaskHist",
            ModelSchemaAdapter.rewriteSql("SELECT status_raw, valid_from FROM KnowTaskHist"));
    }

    @Test
    void однозначные_переименования_схемы_тоже_идут_по_новому_имени() {
        // KREG-10: код сам обращается к created_at (сторож LegacyCreationNamesCodeGuardTest) — переходник момент
        // создания больше не переводит, ключ ответа задаёт псевдоним в самом SQL. Запрос проходит как есть.
        String sql = "SELECT adr_id, created_at AS date_created FROM KnowADR WHERE created_at IS NOT NULL ORDER BY created_at DESC";
        assertEquals(sql, ModelSchemaAdapter.rewriteSql(sql));
        assertEquals("SELECT created_at AS created_date FROM KnowSprint",
            ModelSchemaAdapter.rewriteSql("SELECT created_at AS created_date FROM KnowSprint"));
        assertEquals(java.util.Set.of("status_raw"), ModelSchemaAdapter.RENAMES.keySet(), "осталось одно однозначное переименование");
    }

    @Test
    void коды_статусов_заглавные_сравнения_в_SQL_и_параметры_тоже() {
        // слово владелицы 16.11.2026: «статусная модель uppercase остальные в lower»; question_hygiene был пуст
        assertEquals("SELECT FROM KnowQuestion WHERE status IN ['OPEN', 'DEFERRED']",
            ModelSchemaAdapter.rewriteSql("SELECT FROM KnowQuestion WHERE status IN ['open', 'deferred']"));
        assertEquals("SELECT FROM KnowADR WHERE status = 'ACCEPTED' AND status <> 'SUPERSEDED'",
            ModelSchemaAdapter.rewriteSql("SELECT FROM KnowADR WHERE status = 'accepted' AND status <> 'superseded'"));
        assertEquals("SELECT FROM KnowADR WHERE title = 'accepted'",
            ModelSchemaAdapter.rewriteSql("SELECT FROM KnowADR WHERE title = 'accepted'"), "не поле статуса — не трогаем");
        assertEquals("OPEN", ModelSchemaAdapter.rewriteParams("UPDATE KnowQuestion SET status = :st", new HashMap<>(Map.of("st", "open"))).get("st"));
        // статус-текст (QG, BRAGI, рутины) в новой схеме не справочник — регистр прежний: qg_violations опустел бы
        assertEquals("SELECT FROM QGRecommendation WHERE status = 'pending'",
            ModelSchemaAdapter.rewriteSql("SELECT FROM QGRecommendation WHERE status = 'pending'"));
        assertEquals("pending", ModelSchemaAdapter.rewriteParams("UPDATE QGJobTask SET status = :st", new HashMap<>(Map.of("st", "pending"))).get("st"));
    }

    @Test
    void ответ_без_status_raw_тоже_разбирается() {
        String out = ModelSchemaAdapter.adaptJson("{\"result\":[{\"question_id\":\"Q-1\",\"status\":\"DEFERRED\"}]}");
        org.junit.jupiter.api.Assertions.assertTrue(out.contains("\"status\":\"deferred\""), out);
    }

    @Test
    void в_ответе_статус_не_плана_строчными_как_раньше_версия_плана_заглавными() {
        Map<String, Object> q = new HashMap<>(Map.of("question_id", "Q-1", "status", "DEFERRED"));
        Map<String, Object> uc = new HashMap<>(Map.of("uc_id", "UC-1", "status", "ACTIVE"));
        Map<String, Object> ver = new HashMap<>(Map.of("state_uid", "u", "status", "ACTIVE"));
        ModelSchemaAdapter.adaptRows(List.of(q, uc, ver));
        assertEquals("deferred", q.get("status"));
        assertEquals("active", uc.get("status"));
        assertEquals(null, uc.get("status_raw"), "у сценария нет строки статуса плана");
        assertEquals("ACTIVE", ver.get("status"));
        assertEquals("🔄 IN PROGRESS", ver.get("status_raw"));
    }

    @Test
    void фильтр_по_старому_имени_проекта_ведёт_в_его_группу() {
        // D-2026-MIG-PROJECTS-REGROUP: влитый проект удалён, его slug — синоним (aliases) у опоры группы.
        // Без перевода фильтр ?project=AIDA/GLADSHEIM на новой базе дал бы пусто.
        java.util.Map<String, String> given = new java.util.LinkedHashMap<>(java.util.Map.of("project", "AIDA/GLADSHEIM,AIDA/MIDGARD,X/y"));
        ModelSchemaAdapter.enable(true);
        try {
            ModelSchemaAdapter.projectAliases(java.util.Map.of("AIDA/GLADSHEIM", "AIDA/MIDGARD", "AIDA/TEIKN", "AIDA/MIDGARD"));
            ModelSchemaAdapter.canonicalProjects(given);
            assertEquals("AIDA/MIDGARD,X/y", given.get("project"), "синоним → опора, повтор схлопнут, чужое — как есть");
        } finally { ModelSchemaAdapter.enable(false); ModelSchemaAdapter.projectAliases(java.util.Map.of()); }
        java.util.Map<String, String> old = new java.util.LinkedHashMap<>(java.util.Map.of("project", "AIDA/GLADSHEIM"));
        ModelSchemaAdapter.canonicalProjects(old);
        assertEquals("AIDA/GLADSHEIM", old.get("project"), "старая схема — как есть");
    }

    @Test
    void название_спринта_в_старой_схеме_пишется_и_в_name() {
        // полный прогон 19.11: sprint_new писал только title, FT-индекс старой схемы — по name, поиск не находил спринт
        assertEquals("title=:nm, name=:nm", ModelSchemaAdapter.titleSet("nm"));
        ModelSchemaAdapter.enable(true);
        try {
            assertEquals("title=:nm", ModelSchemaAdapter.titleSet("nm"));
        } finally { ModelSchemaAdapter.enable(false); }
    }

    @Test
    void поле_внутри_скобок_функции_без_псевдонима() {
        // проба 19.11 (LoreRecordEdgeLinks): coalesce(status, status_raw, status_general) превратился в
        // coalesce(status, status AS status_raw, …) — «extraneous input 'AS'»; псевдоним — только на верхнем уровне выборки
        assertEquals("SELECT coalesce(status, status, status_general) AS end_status FROM X",
            ModelSchemaAdapter.rewriteSql("SELECT coalesce(status, status_raw, status_general) AS end_status FROM X"));
        assertEquals("SELECT a, status AS status_raw FROM X",
            ModelSchemaAdapter.rewriteSql("SELECT a, status_raw FROM X"), "на верхнем уровне — по-прежнему с псевдонимом");
    }

    @Test
    void псевдоним_и_текст_в_кавычках_не_трогаются() {
        String sql = "SELECT first(x) AS status_raw, 'status_raw' AS k FROM KnowTask WHERE note_md LIKE '%status_raw%'";
        assertEquals(sql, ModelSchemaAdapter.rewriteSql(sql));
        assertEquals("SELECT FROM KnowTask WHERE my_status_raw_x = 1",
            ModelSchemaAdapter.rewriteSql("SELECT FROM KnowTask WHERE my_status_raw_x = 1"));
    }

    @Test
    void код_статуса_в_ответе_становится_прежней_строкой() {
        Map<String, Object> r = new HashMap<>(Map.of("task_id", "T1", "status_raw", "ACTIVE"));
        Map<String, Object> d = new HashMap<>(Map.of("status_raw", "READY_FOR_DEPLOY"));
        Map<String, Object> u = new HashMap<>(Map.of("status_raw", "UAT"));
        Map<String, Object> a = new HashMap<>(Map.of("status_raw", "ACCEPTED"));
        Map<String, Object> old = new HashMap<>(Map.of("status_raw", "🔄 IN PROGRESS"));
        ModelSchemaAdapter.adaptRows(List.of(r, d, u, a, old));
        assertEquals("🔄 IN PROGRESS", r.get("status_raw"));
        assertEquals("🚀 READY FOR DEPLOY", d.get("status_raw"));
        assertEquals("🧪 UAT TESTING", u.get("status_raw"));
        assertEquals("ACCEPTED", a.get("status_raw"), "не плановый статус — код как есть");
        assertEquals("🔄 IN PROGRESS", old.get("status_raw"), "строка старого вида не меняется");
        // канон опознаётся и по новой строке
        assertEquals("in_progress", LoreStatusVocabulary.classify((String) r.get("status_raw")));
        assertEquals("ready_for_deploy", LoreStatusVocabulary.classify((String) d.get("status_raw")));
    }

    @Test
    void запись_статуса_пишет_код_в_status() {
        String sql = "UPDATE KnowTaskHist SET state_uid = :nsid, status_raw = :ns, status_category = :cat, title = :t WHERE x = 1";
        Map<String, Object> p = new HashMap<>(Map.of("nsid", "u1", "ns", "🔄 IN PROGRESS", "cat", "active", "t", "✅ DONE как заголовок"));
        Map<String, Object> out = ModelSchemaAdapter.rewriteParams(sql, p);
        assertEquals("ACTIVE", out.get("ns"));
        assertEquals("✅ DONE как заголовок", out.get("t"), "параметр не статуса не трогается");
        assertEquals("u1", out.get("nsid"));
        assertEquals("READY_FOR_DEPLOY", ModelSchemaAdapter.rewriteParams("INSERT INTO KnowTaskHist SET status_raw=:sraw", Map.of("sraw", "🚀 READY FOR DEPLOY")).get("sraw"));
        assertEquals("PARTIAL", ModelSchemaAdapter.rewriteParams("UPDATE X SET status_raw = :s", Map.of("s", "🟡 PARTIAL — ждём ответа")).get("s"));
        assertEquals("DONE", ModelSchemaAdapter.rewriteParams("UPDATE X SET status_raw = :s", Map.of("s", "DONE")).get("s"), "код остаётся кодом");
    }

    /**
     * MT-MCP-TRUTH Б7 (гипотеза сверки 19.11, подтверждена): статус с припиской («🟡 PARTIAL — ждём CI») на базе из
     * модели превращался в код PARTIAL, а приписка пропадала. В новой схеме её место — status_note версии
     * (так же раскладывает установщик, apply-map.mjs asStatus).
     */
    @Test
    void приписка_статуса_при_записи_версии_уходит_в_status_note() {
        String sql = "INSERT INTO KnowTaskHist SET state_uid = :nsid, status_raw = :ns, valid_from = :now";
        Map<String, Object> p = new HashMap<>(Map.of("nsid", "u1", "ns", "🟡 PARTIAL — ждём CI", "now", "t"));
        String rewritten = ModelSchemaAdapter.rewriteSql(sql);
        Map<String, Object> out = ModelSchemaAdapter.rewriteParams(sql, p);
        assertEquals("INSERT INTO KnowTaskHist SET state_uid = :nsid, status = :ns, status_note = :ns__note, valid_from = :now", rewritten);
        assertEquals("PARTIAL", out.get("ns"));
        assertEquals("ждём CI", out.get("ns__note"), "хвост статуса — в status_note, а не в никуда");
        // без приписки — пустая приписка (смена статуса пишет её заново, прежняя не переносится)
        Map<String, Object> plain = ModelSchemaAdapter.rewriteParams(sql, new HashMap<>(Map.of("ns", "🔄 IN PROGRESS")));
        assertEquals("ACTIVE", plain.get("ns"));
        assertTrue(plain.containsKey("ns__note") && plain.get("ns__note") == null, "параметр есть, значение null");
        // слово без значка тоже голова, а не хвост
        assertEquals("03.05.2026 — PR #105",
            ModelSchemaAdapter.rewriteParams(sql, new HashMap<>(Map.of("ns", "MERGED 03.05.2026 — PR #105"))).get("ns__note"));
        assertEquals("Закрыто вручную",
            ModelSchemaAdapter.rewriteParams(sql, new HashMap<>(Map.of("ns", "✅ Закрыто вручную"))).get("ns__note"),
            "слово-префикс внутри длинного слова — не голова статуса");
    }

    @Test
    void сравнение_статуса_в_where_приписку_не_заводит() {
        String sql = "UPDATE KnowTaskHist SET valid_to = :now WHERE in('HAS_STATE').task_uid CONTAINS :id AND valid_to IS NULL AND status_raw = :expected_raw";
        assertEquals(sql.replace("status_raw", "status"), ModelSchemaAdapter.rewriteSql(sql), "условие — не присваивание");
        Map<String, Object> out = ModelSchemaAdapter.rewriteParams(sql, new HashMap<>(Map.of("expected_raw", "🔄 IN PROGRESS", "now", "t", "id", "x")));
        assertEquals("ACTIVE", out.get("expected_raw"));
        assertFalse(out.containsKey("expected_raw__note"));
        // вершина (не версия): status_note у неё нет — не заводим
        String vertex = "UPDATE KnowSprint SET sprint_id=:sid, status_raw=:sraw WHERE sprint_id=:sid";
        assertFalse(ModelSchemaAdapter.rewriteSql(vertex).contains("status_note"));
    }

    /** MT-MCP-TRUTH A3 (гипотеза сверки 19.11, подтверждена): CASE status WHEN 'open' — сравнение со строчным кодом. */
    @Test
    void case_status_when_переводит_коды_в_заглавные() {
        assertEquals("SELECT CASE status WHEN 'OPEN' THEN 0 WHEN 'DEFERRED' THEN 1 WHEN 'CLOSED' THEN 2 WHEN 'DROPPED' THEN 3 ELSE 4 END AS status_rank FROM KnowQuestion",
            ModelSchemaAdapter.rewriteSql("SELECT CASE status WHEN 'open' THEN 0 WHEN 'deferred' THEN 1 WHEN 'closed' THEN 2 WHEN 'dropped' THEN 3 ELSE 4 END AS status_rank FROM KnowQuestion"));
        String questions = ModelSchemaAdapter.rewriteSql(LoreSlices.get("questions").baseSql());
        assertTrue(questions.contains("WHEN 'OPEN' THEN 0"), "срез questions на базе из модели сортирует открытые первыми");
        assertEquals("SELECT CASE status WHEN 'pending' THEN 0 ELSE 1 END AS r FROM QGRecommendation",
            ModelSchemaAdapter.rewriteSql("SELECT CASE status WHEN 'pending' THEN 0 ELSE 1 END AS r FROM QGRecommendation"),
            "у типов со статусом-текстом коды не трогаются");
        assertEquals("SELECT CASE kind WHEN 'open' THEN 0 END AS r FROM X",
            ModelSchemaAdapter.rewriteSql("SELECT CASE kind WHEN 'open' THEN 0 END AS r FROM X"), "не поле статуса");
    }

    @Test
    void строка_версии_целиком_получает_прежний_ключ_статуса() {
        // SELECT * открытой версии на новой базе: статус только в status — без этого old_status в ответе смены статуса пуст
        Map<String, Object> v = new HashMap<>(Map.of("state_uid", "u", "status", "PLANNED"));
        Map<String, Object> adr = new HashMap<>(Map.of("adr_id", "A", "status", "ACCEPTED"));
        ModelSchemaAdapter.adaptRows(List.of(v, adr));
        assertEquals("📋 PLANNED", v.get("status_raw"));
        assertEquals("PLANNED", v.get("status"), "код в status остаётся");
        assertEquals(null, adr.get("status_raw"), "статус не плана (ADR) — ключа не добавляем");
    }

    @Test
    void запись_статуса_не_плана_через_status_raw_не_превращается_в_TODO() {
        // StatusHistoryService пишет status_raw = :ns и для ADR/решения («accepted»); словарь плана слова не знает
        // и откатился бы на «todo» — ADR стал бы TODO. Статус не плана — код справочника заглавными.
        assertEquals("ACCEPTED", ModelSchemaAdapter.toCode("accepted"));
        assertEquals("SUPERSEDED", ModelSchemaAdapter.toCode("superseded"));
        assertEquals("ACTIVE", ModelSchemaAdapter.toCode("🔄 IN PROGRESS"), "план — по-прежнему код плана");
        assertEquals("TODO", ModelSchemaAdapter.toCode("⬜ TODO"));
    }

    @Test
    void статус_в_ответе_двери_записи_в_прежнем_виде() {
        // проба 19.11: /lore/status по ADR отвечал old_status=PROPOSED, new_status=ACCEPTED — клиенты знают «proposed»
        ModelSchemaAdapter.enable(true);
        try {
            assertEquals("accepted", ModelSchemaAdapter.forClient("ACCEPTED"));
            assertEquals("🔄 IN PROGRESS", ModelSchemaAdapter.forClient("ACTIVE"));
            assertEquals("🟡 PARTIAL", ModelSchemaAdapter.forClient("🟡 PARTIAL"));
            assertEquals(null, ModelSchemaAdapter.forClient(null));
        } finally { ModelSchemaAdapter.enable(false); }
        assertEquals("ACCEPTED", ModelSchemaAdapter.forClient("ACCEPTED"), "старая схема — как есть");
    }

    @Test
    void ответ_базы_целиком_json_приводится_к_прежнему_виду() {
        String json = "{\"result\":[{\"task_uid\":\"A/1\",\"status_raw\":\"BLOCKED\"},{\"n\":3}]}";
        String out = ModelSchemaAdapter.adaptJson(json);
        org.junit.jupiter.api.Assertions.assertTrue(out.contains("\"status_raw\":\"🔴 BLOCKED\""), out);
        assertEquals("{\"user\":\"x\"}", ModelSchemaAdapter.adaptJson("{\"user\":\"x\"}"));
    }

    @Test
    void все_коды_плана_опознаются_словарём_как_свой_канон() {
        Map<String, String> want = Map.ofEntries(
            Map.entry("TODO", "todo"), Map.entry("BACKLOG", "backlog"), Map.entry("PLANNED", "planned"),
            Map.entry("DESIGN", "design"), Map.entry("ACTIVE", "in_progress"), Map.entry("WAITING", "waiting"),
            Map.entry("PARTIAL", "partial"), Map.entry("REVIEW", "review"), Map.entry("READY_FOR_DEPLOY", "ready_for_deploy"),
            Map.entry("UAT", "uat"), Map.entry("DONE", "done"), Map.entry("FAILED", "failed"),
            Map.entry("BLOCKED", "blocked"), Map.entry("CANCELLED", "cancelled"));
        for (var e : want.entrySet()) {
            assertEquals(e.getValue(), LoreStatusVocabulary.classify(e.getKey()), "код " + e.getKey());
            assertEquals(e.getValue(), LoreStatusVocabulary.classify(ModelSchemaAdapter.display(e.getKey())), "строка " + e.getKey());
        }
    }
}
