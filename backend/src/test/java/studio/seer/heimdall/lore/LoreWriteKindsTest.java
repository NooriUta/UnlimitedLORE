package studio.seer.heimdall.lore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-06 · сверка значения записи с видом поля из модели.
 * Ответ владелицы 15.11.2026: проверка типа при записи — «предупреждение»: запись не отклоняется,
 * ответ несёт {@code warnings[]}, строка уходит в журнал.
 */
class LoreWriteKindsTest {

    static final ObjectMapper M = new ObjectMapper();

    static List<Map<String, Object>> check(String path, String json) throws Exception {
        return LoreWriteKinds.check(path, M.readTree(json));
    }

    static List<Object> fields(List<Map<String, Object>> w) {
        return w.stream().map(x -> x.get("field")).toList();
    }

    @Test
    void stringInNumberFieldWarns() throws Exception {
        var w = check("/lore/task/edit", "{\"task_uid\":\"S/T1\",\"title\":\"x\",\"effort_days\":\"3\"}");
        assertEquals(List.of("effort_days"), fields(w));
        assertEquals("FIELD_KIND_MISMATCH", w.get(0).get("code"));
        assertEquals("number", w.get(0).get("kind"));
        assertEquals("3", w.get(0).get("value"));
    }

    @Test
    void numberFieldOnCreatePathWarnsToo() throws Exception {
        // путь создания задачи не объявлен в модели как путь записи поля: тип берётся из пути /lore/task
        assertEquals(List.of("effort_days"), fields(check("/lore/task", "{\"sprint_id\":\"S\",\"task_id\":\"T1\",\"title\":\"x\",\"effort_days\":\"2\"}")));
    }

    @Test
    void dateNotInFormatWarns() throws Exception {
        var w = check("/lore/sprint/plan", "{\"sprint_id\":\"S\",\"planned_start_date\":\"15.11.2026\"}");
        assertEquals(List.of("planned_start_date"), fields(w));
        assertEquals("date", w.get(0).get("kind"));
        assertEquals("ГГГГ-ММ-ДД", w.get(0).get("expected"));
    }

    @Test
    void impossibleCalendarDateWarns() throws Exception {
        assertEquals(List.of("planned_end_date"),
            fields(check("/lore/sprint/plan", "{\"sprint_id\":\"S\",\"planned_start_date\":\"2026-11-15\",\"planned_end_date\":\"2026-02-30\"}")));
    }

    @Test
    void momentFieldAcceptsIsoAndDateButNotText() throws Exception {
        // adr.date — момент (DATETIME в схеме переноса); дата без времени — полночь UTC, как в переносе
        assertTrue(check("/lore/adr", "{\"adr_id\":\"ADR-X\",\"name\":\"x\",\"created_at\":\"2026-11-19T10:00:00Z\"}").isEmpty());
        assertTrue(check("/lore/adr", "{\"adr_id\":\"ADR-X\",\"name\":\"x\",\"created_at\":\"2026-11-19\"}").isEmpty());
        var w = check("/lore/adr", "{\"adr_id\":\"ADR-X\",\"name\":\"x\",\"created_at\":\"вчера\"}");
        assertEquals(List.of("created_at"), fields(w));
        assertEquals("datetime", w.get(0).get("precision"));
    }

    @Test
    void textInBoolFieldWarns() throws Exception {
        assertEquals(List.of("no_release_required"),
            fields(check("/lore/sprint/update", "{\"sprint_id\":\"S\",\"no_release_required\":\"yes\"}")));
    }

    @Test
    void correctValuesGiveNoWarning() throws Exception {
        assertTrue(check("/lore/task/edit", "{\"task_uid\":\"S/T1\",\"title\":\"x\",\"effort_days\":2.5,\"actual_days\":1}").isEmpty());
        assertTrue(check("/lore/sprint/plan", "{\"sprint_id\":\"S\",\"planned_start_date\":\"2026-11-15\",\"planned_end_date\":null}").isEmpty());
        assertTrue(check("/lore/sprint/update", "{\"sprint_id\":\"S\",\"name\":\"N\",\"no_release_required\":true}").isEmpty());
        // пустая строка в дате — очистка поля, не значение не того вида
        assertTrue(check("/lore/sprint/plan", "{\"sprint_id\":\"S\",\"planned_start_date\":\"\"}").isEmpty());
    }

    @Test
    void batchItemsAreCheckedWithIndex() throws Exception {
        assertEquals(List.of("tasks[1].effort_days"),
            fields(check("/lore/task/edit/batch", "{\"tasks\":[{\"task_uid\":\"S/T1\",\"effort_days\":1},{\"task_uid\":\"S/T2\",\"effort_days\":\"x\"}]}")));
    }

    @Test
    void pathOutsideModelIsNotChecked() throws Exception {
        assertTrue(check("/lore/nothing/here", "{\"effort_days\":\"3\"}").isEmpty());
        assertTrue(check("lore/task/edit", "{\"effort_days\":4}").isEmpty(), "путь без ведущей косой черты — тот же путь");
        assertEquals(1, check("lore/task/edit", "{\"effort_days\":\"4\"}").size());
    }

    @Test
    void warningsJoinTheAnswerWithoutLosingIt() throws Exception {
        List<Map<String, Object>> w = List.of(Map.of("code", "FIELD_KIND_MISMATCH", "field", "effort_days"));
        JsonNode out = (JsonNode) LoreWriteKinds.withWarnings(Map.of("ok", true, "task_uid", "S/T1"), w, M);
        assertTrue(out.get("ok").asBoolean());
        assertEquals("effort_days", out.get("warnings").get(0).get("field").asText());
        // у ответа уже есть warnings — дописываются, а не заменяются
        JsonNode both = (JsonNode) LoreWriteKinds.withWarnings(Map.of("warnings", List.of("прежнее")), w, M);
        assertEquals(2, both.get("warnings").size());
        assertEquals("прежнее", both.get("warnings").get(0).asText());
        // не объект (строка, список) — ответ не трогается
        assertEquals("текст", LoreWriteKinds.withWarnings("текст", w, M));
    }
}
