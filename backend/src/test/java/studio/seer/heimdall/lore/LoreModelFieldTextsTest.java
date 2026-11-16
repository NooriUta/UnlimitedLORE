package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_DOCS_TIDY/MDL-02 — формат поля в файле модели (решения владелицы 15.11.2026):
 * у поля, кроме названия, — краткое название, определение, описание, слой (стабильное /
 * опциональное) и признак «значение живёт в версии». Историчность типа уже названа в {@code time}
 * ({@code history: scd2 | none}); отдельного описания версии в формате нет.
 *
 * <p>Название обязательно (без него модель не принимается), определение рекомендуется (счётчик в
 * ответе модели), краткое название и описание — по желанию.
 */
class LoreModelFieldTextsTest {

    static final String FIELD = "\"key\" : \"retired_reason\",\n      \"label\" : \"Причина вывода из работы\",";
    static final String BODY = "\"key\" : \"description\",\n      \"label\" : \"Что проверяет\"";

    @AfterEach
    void restore() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(LoreModelLiveReplaceTest.canon()));
    }

    static String canonWith(String anchor, String extra) throws Exception {
        String canon = LoreModelLiveReplaceTest.canon();
        assertTrue(canon.contains(anchor), "положительный контроль: якорь есть в каноне — " + anchor);
        return canon.replace(anchor, anchor + extra);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> fieldOf(String type, String key) {
        for (Map<String, Object> f : (List<Map<String, Object>>) LoreRecordRegistry.schemaJson(type).get("fields"))
            if (key.equals(f.get("key"))) return f;
        return fail("нет поля " + type + "." + key);
    }

    @Test
    void fieldTextsLayerAndHistoricityTravelFromFileToContract() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(canonWith(FIELD,
            "\n      \"shortLabel\" : \"Причина\",\n      \"definition\" : \"Почему гейт больше не запускается.\","
                + "\n      \"description\" : \"Заполняется при выводе гейта из работы.\",\n      \"layer\" : \"optional\",")));
        Map<String, Object> f = fieldOf("quality_gate", "retired_reason");
        assertEquals("Причина", f.get("short_label"));
        assertEquals("Почему гейт больше не запускается.", f.get("definition"));
        assertEquals("Заполняется при выводе гейта из работы.", f.get("description"));
        assertEquals("optional", f.get("layer"));
        assertEquals(false, f.get("historic"), "не задано в файле — «не историчное», а не пропуск ключа");
    }

    @Test
    void bodySectionCarriesTheSameTexts() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(canonWith(BODY,
            ",\n      \"definition\" : \"Что именно гейт проверяет.\",\n      \"layer\" : \"stable\"")));
        Map<String, Object> f = fieldOf("quality_gate", "description");
        assertEquals("Что именно гейт проверяет.", f.get("definition"));
        assertEquals("stable", f.get("layer"));
    }

    @Test
    void fieldWithoutTextsKeepsKeysWithNull() {
        Map<String, Object> f = fieldOf("quality_gate", "retired_reason");
        for (String k : List.of("short_label", "definition", "description", "layer", "historic"))
            assertTrue(f.containsKey(k), "ключ «" + k + "» есть всегда: клиент отличает «не задано» от «старый сервер»");
        assertNull(f.get("definition"));
        assertNull(f.get("layer"), "слой не задан — неизвестен, а не «опциональное»");
    }

    @Test
    void unknownLayerIsRefused() throws Exception {
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(canonWith(FIELD, "\n      \"layer\" : \"иногда\",")));
        assertTrue(e.getMessage().contains("quality_gate.retired_reason") && e.getMessage().contains("иногда"), e.getMessage());
    }

    @Test
    void historicFieldOfTypeWithoutHistoryIsRefused() throws Exception {
        // У гейта качества версий нет (time.history = none): историчному полю негде жить.
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(canonWith(FIELD, "\n      \"historic\" : true,")));
        assertTrue(e.getMessage().contains("quality_gate.retired_reason") && e.getMessage().contains("истори"), e.getMessage());
    }

    @Test
    void fieldWithoutNameIsRefused() throws Exception {
        String canon = LoreModelLiveReplaceTest.canon();
        assertTrue(canon.contains(FIELD));
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> LoreModelFile.parse(canon.replace(FIELD, "\"key\" : \"retired_reason\",")));
        assertTrue(e.getMessage().contains("quality_gate.retired_reason") && e.getMessage().contains("назван"), e.getMessage());
    }

    @Test
    @SuppressWarnings("unchecked")
    void modelCountsFieldsWithoutDefinition() throws Exception {
        Map<String, Object> before = (Map<String, Object>) content(LoreModel.build(List.of())).get("field_texts");
        assertNotNull(before, "счётчик текстов полей есть в ответе модели");
        int total = (int) before.get("fields");
        int without = (int) before.get("without_definition");
        assertTrue(total > 100, "положительный контроль: посчитаны поля всех типов, а не ноль — " + total);
        LoreModelFile.replace(LoreModelFile.parse(canonWith(FIELD, "\n      \"definition\" : \"Почему гейт больше не запускается.\",")));
        Map<String, Object> after = (Map<String, Object>) content(LoreModel.build(List.of())).get("field_texts");
        assertEquals(total, after.get("fields"));
        assertEquals(without - 1, after.get("without_definition"));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> content(Map<String, Object> doc) {
        Object c = doc.get("content");
        return c instanceof Map<?, ?> m ? (Map<String, Object>) m : doc;
    }
}
