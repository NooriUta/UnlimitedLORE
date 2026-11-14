package studio.seer.heimdall.lore;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-08 (приёмка v1.17.20): поле-флаг «Не требует релиза» в паспорте
 * спринта было прочерком «—» без ✎. Корень: значение уходило строкой «Да»/null (BOOL_YES), а клиент
 * вида bool признаёт только true/false — «Да» и false оба давали «—»; у поля в модели не было пути
 * записи. Правило: значение поля вида bool — Boolean (null — «не задан»), флаг спринта правится.
 */
class LoreRecordBoolFieldTest {

    private static Map<String, Object> row(String key, Object value, String... more) {
        Map<String, Object> r = new HashMap<>();
        for (int i = 0; i + 1 < more.length; i += 2) r.put(more[i], more[i + 1]);
        r.put(key, value);
        return r;
    }

    @Test
    void sprintNoReleaseIsBoolean() {
        assertEquals(Boolean.TRUE, LoreRecordValues.values("sprint", row("no_release_required", true, "sprint_id", "S")).get("no_release"));
        assertEquals(Boolean.FALSE, LoreRecordValues.values("sprint", row("no_release_required", false, "sprint_id", "S")).get("no_release"));
        assertEquals(Boolean.TRUE, LoreRecordValues.values("sprint", row("no_release_required", "true", "sprint_id", "S")).get("no_release"));
        assertNull(LoreRecordValues.values("sprint", row("no_release_required", null, "sprint_id", "S")).get("no_release"));
    }

    @Test
    void productIsActiveIsBoolean() {
        assertEquals(Boolean.TRUE, LoreRecordValues.values("product", row("is_active", true, "code", "P")).get("is_active"));
        assertEquals(Boolean.FALSE, LoreRecordValues.values("product", row("is_active", false, "code", "P")).get("is_active"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void sprintNoReleaseIsEditableViaSprintUpdate() {
        Map<String, Object> types = (Map<String, Object>) LoreModelGoldenTest.modelDoc().get("types");
        Map<String, Object> f = ((List<Map<String, Object>>) ((Map<String, Object>) types.get("sprint")).get("fields"))
            .stream().filter(x -> "no_release".equals(x.get("key"))).findFirst().orElseThrow();
        assertEquals("bool", f.get("kind"));
        assertEquals(true, f.get("editable"));
        Map<String, Object> w = (Map<String, Object>) f.get("write");
        assertEquals("/lore/sprint/update", w.get("endpoint"));
        assertEquals("no_release_required", w.get("field"));
    }
}
