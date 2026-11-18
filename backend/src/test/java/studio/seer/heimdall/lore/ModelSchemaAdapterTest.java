package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
