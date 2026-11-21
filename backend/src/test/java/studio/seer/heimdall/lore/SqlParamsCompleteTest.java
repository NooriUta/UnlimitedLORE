package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06, патч 1.18.1 · запись плана спринта без статуса падала 400 на препроде:
 * ArcadeDB CommandParameterMissingException «Expected parameter(s): status». Вставка версии (SCD2) ссылается на :param,
 * которого нет в карте параметров. Правило общее: каждый :param запроса присутствует в карте — и при null.
 */
class SqlParamsCompleteTest {

    /** Вставка версии плана спринта — та же форма, что LoreStatusResource (путь /lore/sprint/plan). */
    static final String PLAN_INSERT = "INSERT INTO KnowSprintHist SET state_uid = :nsid, valid_from = :now, "
        + "status_raw = :status_raw, priority = :priority, planned_start_date = :planned_start_date, "
        + "planned_end_date = :planned_end_date, pr_refs = :pr_refs, context_md = :context_md, outcome_md = :outcome_md, "
        + "content_hash = :content_hash;";

    static Map<String, Object> planParams(Object status) {
        Map<String, Object> p = new HashMap<>();
        p.put("nsid", "S-v2");
        p.put("now", "2026-11-21T10:00:00Z");
        p.put("status_raw", status);
        p.put("priority", null);
        p.put("planned_start_date", "2026-11-22");
        p.put("planned_end_date", null);
        p.put("pr_refs", null);
        p.put("context_md", null);
        p.put("outcome_md", null);
        p.put("content_hash", null);
        return p;
    }

    @Test
    void namesOfParamsOutsideStrings() {
        assertEquals(List.of("a", "b"), SqlParams.names("SELECT ':x' AS s FROM T WHERE a = :a AND b IN :b AND c = '::y'"));
    }

    @Test
    void sprintWithoutStatusOnNewSchema_everyParamIsPresent() {
        String sql = ModelSchemaAdapter.rewriteSql(PLAN_INSERT);
        // корень дефекта: переходник переименовал :status_raw в :status, а ключ карты остался прежним
        assertEquals(List.of("status"), SqlParams.missing(sql, ModelSchemaAdapter.rewriteParams(PLAN_INSERT, planParams(null))), sql);
        Map<String, Object> params = SqlParams.complete(sql, ModelSchemaAdapter.rewriteParams(PLAN_INSERT, planParams(null)));
        assertEquals(List.of(), SqlParams.missing(sql, params), sql);
        assertTrue(params.containsKey("status") && params.get("status") == null, "статуса нет — null, а не пропуск параметра");
    }

    @Test
    void sprintWithStatusOnNewSchema_valueTravelsUnderNewName() {
        String sql = ModelSchemaAdapter.rewriteSql(PLAN_INSERT);
        Map<String, Object> params = SqlParams.complete(sql, ModelSchemaAdapter.rewriteParams(PLAN_INSERT, planParams("🔄 IN PROGRESS")));
        assertEquals(List.of(), SqlParams.missing(sql, params));
        assertNotNull(params.get(sql.contains(":status_raw") ? "status_raw" : "status"));
    }

    @Test
    void forgottenParamIsNamedNotInvented() {
        Map<String, Object> p = new HashMap<>(Map.of("a", 1));
        assertEquals(List.of("b"), SqlParams.missing("UPDATE T SET a = :a, b = :b", p));
        Map<String, Object> done = SqlParams.complete("UPDATE T SET a = :a, b = :b", p);
        assertTrue(done.containsKey("b") && done.get("b") == null, "пропущенный параметр — null, движок не падает");
    }
}
