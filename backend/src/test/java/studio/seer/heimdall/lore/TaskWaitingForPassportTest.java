package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Паспорт задачи: «чьего ответа ждём» и причина статуса — рядом со статусом.
 *
 * <p>Слова владелицы 16.11.2026 (с телефона, переданы сессией Mobilepoc): «какого ответа и от кого ждёшь
 * в карточке не написано». Статус WAITING без адресата запрещён (LoreDoneGate, 400 WAITING_FOR_REQUIRED),
 * значение пишется в KnowTaskHist.waiting_for, причина блокировки — в status_reason; но ни срез задачи,
 * ни модель паспорта их не отдавали — значение было записано и нигде не показано.
 */
class TaskWaitingForPassportTest {

    @Test
    void taskRecordCarriesWaitingForAndStatusReason() {
        Map<String, Object> row = new HashMap<>();
        row.put("task_uid", "SPRINT_X/T-1");
        row.put("title", "Задача");
        row.put("status_raw", "⏳ WAITING");
        row.put("waiting_for", "ответ владелицы по ELK");
        row.put("status_reason", "ждём решения");
        Map<String, Object> v = LoreRecordFrom.assemble(LoreRecordFrom.VALUES.get("task"), row);
        assertEquals("ответ владелицы по ELK", v.get("waiting_for"));
        assertEquals("ждём решения", v.get("status_reason"));
    }

    /**
     * Прод 16.11.2026: новая версия задачи копирует waiting_for и status_reason из прошлой — у 33 открытых
     * версий не в WAITING лежит прежний адресат (DONE 11, IN PROGRESS 10, UAT 6…), у 38 DONE — прежняя
     * причина. «Ждём» у готовой задачи — неправда; поэтому фасад отдаёт адресат только у ждущей задачи,
     * а причину — только у статусов, где причина и есть смысл статуса.
     */
    @Test
    void leftoverFromAPreviousStatusIsNotShown() {
        Map<String, Object> row = new HashMap<>();
        row.put("task_uid", "SPRINT_X/T-2");
        row.put("status_raw", "✅ DONE");
        row.put("waiting_for", "старый адресат");
        row.put("status_reason", "старая причина");
        Map<String, Object> v = LoreRecordValues.values("task", row);
        assertNull(v.get("waiting_for"));
        assertNull(v.get("status_reason"));
        row.put("status_raw", "🔴 BLOCKED");
        v = LoreRecordValues.values("task", row);
        assertNull(v.get("waiting_for"));
        assertEquals("старая причина", v.get("status_reason"));
        row.put("status_raw", "⏳ WAITING");
        v = LoreRecordValues.values("task", row);
        assertEquals("старый адресат", v.get("waiting_for"));
    }

    @Test
    void taskSliceReadsThemFromTheCurrentVersion() {
        String sql = LoreSlices.get("tasks_by_uids").baseSql();
        assertTrue(sql.contains("out('HAS_STATE')[valid_to IS NULL].waiting_for[0]"), sql);
        assertTrue(sql.contains("out('HAS_STATE')[valid_to IS NULL].status_reason[0]"), sql);
    }

    @Test
    void modelShowsThemInTheHeadNextToStatusReadOnly() throws Exception {
        JsonObject m = new JsonObject(Files.readString(Path.of("src/main/resources/lore-model/lore-model.json")));
        JsonObject task = null;
        for (Object o : m.getJsonArray("types")) if ("task".equals(((JsonObject) o).getString("type"))) task = (JsonObject) o;
        assertNotNull(task);
        JsonArray fields = task.getJsonArray("fields");
        List<String> keys = fields.stream().map(o -> ((JsonObject) o).getString("key")).toList();
        int status = keys.indexOf("status");
        assertEquals(status + 1, keys.indexOf("waiting_for"), "«Ждём» — сразу за статусом");
        assertEquals(status + 2, keys.indexOf("status_reason"), "причина — за «Ждём»");
        for (String k : List.of("waiting_for", "status_reason")) {
            JsonObject f = fields.getJsonObject(keys.indexOf(k));
            assertEquals("head", f.getString("group"), k);
            assertEquals("text", f.getString("kind"), k);
            assertNotEquals(Boolean.TRUE, f.getBoolean("editable"), k + ": пишется вместе со статусом, не отдельно");
            for (String l : List.of("label", "labelEn", "labelPl")) assertFalse(f.getString(l, "").isBlank(), k + "." + l);
        }
        assertEquals("Ждём", fields.getJsonObject(keys.indexOf("waiting_for")).getString("label"));
    }
}
