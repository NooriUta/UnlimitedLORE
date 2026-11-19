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

    /**
     * Канон, у двух подопытных полей гейта которого снято определение. В самом каноне определения
     * у них есть (MDL-04), а тестам нужно поле «без текста»: снимаем строку {@code definition}
     * внутри объекта поля, остальное — как в каноне. Не зависит от формулировки определения.
     */
    static String bareCanon() throws Exception {
        String s = LoreModelLiveReplaceTest.canon();
        for (String anchor : List.of(FIELD, BODY)) {
            assertTrue(s.contains(anchor), "положительный контроль: якорь есть в каноне — " + anchor);
            s = java.util.regex.Pattern.compile(java.util.regex.Pattern.quote(anchor)
                    + "(,?(?:\\n {6}\"(?!definition\")[^\\n]*)*)\\n {6}\"definition\" : \"(?:[^\"\\\\]|\\\\.)*\",")
                .matcher(s).replaceFirst(java.util.regex.Matcher.quoteReplacement(anchor) + "$1");
        }
        return s;
    }

    static String canonWith(String anchor, String extra) throws Exception {
        String canon = bareCanon();
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
    void fieldWithoutTextsKeepsKeysWithNull() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(bareCanon()));
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
        LoreModelFile.replace(LoreModelFile.parse(bareCanon()));
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

    // ── MDL-09 (D-2026-LORE-FIELD-LABELS-FROM-SERVER): подписи на двух языках отдаёт сервер ──

    @Test
    void englishPairsTravelFromFileToContract() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(canonWith(FIELD,
            "\n      \"shortLabelEn\" : \"Reason\",\n      \"definitionEn\" : \"Why the gate no longer runs.\","
                + "\n      \"descriptionEn\" : \"Filled in when the gate is retired.\",")));
        Map<String, Object> f = fieldOf("quality_gate", "retired_reason");
        assertEquals("Reason", f.get("short_label_en"));
        assertEquals("Why the gate no longer runs.", f.get("definition_en"));
        assertEquals("Filled in when the gate is retired.", f.get("description_en"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void everyFieldAndTypeOfCanonHasKeyAndEnglishLabel() {
        int checked = 0;
        for (String t : LoreRecordRegistry.TYPES) {
            Map<String, Object> schema = LoreRecordRegistry.schemaJson(t);
            assertNotNull(schema.get("label_en"), t + ": у типа нет английской подписи");
            for (Map<String, Object> f : (List<Map<String, Object>>) schema.get("fields")) {
                String id = t + "." + f.get("key");
                assertNotNull(f.get("label_key"), id + ": нет ключа локализации");
                assertNotNull(f.get("label_en"), id + ": нет английской подписи");
                assertNotNull(f.get("label_pl"), id + ": нет польской подписи");
                for (String k : List.of("short_label_pl", "definition_pl", "description_pl"))
                    assertTrue(f.containsKey(k), id + ": ключ «" + k + "» есть всегда");
                for (String k : List.of("short_label_en", "definition_en", "description_en"))
                    assertTrue(f.containsKey(k), id + ": ключ «" + k + "» есть всегда");
                checked++;
            }
        }
        assertTrue(checked > 150, "положительный контроль: проверены поля всех типов — " + checked);
    }

    @Test
    void fieldWithoutLocalizationKeyIsRefused() throws Exception {
        String canon = LoreModelLiveReplaceTest.canon();
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("(\"key\" : \"retired_reason\",\\n\\s+\"label\" : \"[^\"]+\",)\\n\\s+\"labelKey\" : \"[^\"]+\",").matcher(canon);
        assertTrue(m.find(), "положительный контроль: у поля канона есть ключ локализации");
        String broken = canon.substring(0, m.start()) + m.group(1) + canon.substring(m.end());
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(broken));
        assertTrue(e.getMessage().contains("quality_gate.retired_reason") && e.getMessage().contains("labelKey"), e.getMessage());
    }

    @Test
    @SuppressWarnings("unchecked")
    void modelCountsFieldsWithoutEnglishLabel() {
        Map<String, Object> c = (Map<String, Object>) content(LoreModel.build(List.of())).get("field_texts");
        assertEquals(0, c.get("without_label_en"), "у канона английская подпись есть у каждого поля");
        assertEquals(0, c.get("without_label_pl"), "у канона польская подпись есть у каждого поля");
        assertTrue((int) c.get("without_definition_en") > 0, "английских определений пока нет — счётчик это показывает");
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> content(Map<String, Object> doc) {
        Object c = doc.get("content");
        return c instanceof Map<?, ?> m ? (Map<String, Object>) m : doc;
    }
}
