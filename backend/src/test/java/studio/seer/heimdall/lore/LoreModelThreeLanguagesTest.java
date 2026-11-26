package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_KNOW_REGISTRY/KREG-10 — подписи модели на трёх языках (владелец 25.11.2026, вариант «а»).
 *
 * <p>Замер зонтика: у типов, полей и вкладок связей ru/en/pl есть, а у связей типов
 * ({@code types[].relations[]}) все 240 подписей были только по-русски — английский и польский
 * интерфейс показывали связь русским словом.
 *
 * <p>Сторож: у каждой подписи модели — типа, поля (и тела), вкладки связей, связи, обратной подписи
 * связи и свойства ребра — есть ru, en и pl; у связи ещё ключ локализации {@code pp.rel.*}, как
 * {@code pp.field.*} у полей. Читается сырой JSON канона — сторож не зависит от того, знает ли
 * кодек новые ключи. Чистый JUnit.
 */
class LoreModelThreeLanguagesTest {

    static JsonObject canonJson() throws Exception {
        return new JsonObject(Files.readString(LoreModelFileTest.CANON, StandardCharsets.UTF_8));
    }

    private static boolean blank(JsonObject o, String k) {
        String v = o.getString(k);
        return v == null || v.isBlank();
    }

    /** Подпись {@code ru} есть → у неё есть {@code en} и {@code pl}. */
    private static void triple(List<String> bad, JsonObject o, String at, String ru, String en, String pl) {
        if (blank(o, ru)) return;
        if (blank(o, en)) bad.add(at + ": нет " + en);
        if (blank(o, pl)) bad.add(at + ": нет " + pl);
    }

    private static List<JsonObject> objs(JsonObject o, String k) {
        List<JsonObject> out = new ArrayList<>();
        JsonArray a = o.getJsonArray(k);
        if (a != null) for (Object x : a) out.add((JsonObject) x);
        return out;
    }

    /** Все типы модели: паспортные и «только ребёнок». */
    private static List<JsonObject> allTypes(JsonObject m) {
        List<JsonObject> out = new ArrayList<>(objs(m, "types"));
        Object co = m.getValue("child_only");
        if (co instanceof JsonObject j) for (String k : j.fieldNames()) out.add(j.getJsonObject(k));
        else if (co instanceof JsonArray a) for (Object x : a) out.add((JsonObject) x);
        return out;
    }

    /** Подписи без перевода; {@code counts[0]} — сколько связей увидено (положительный контроль). */
    static List<String> missing(JsonObject m, int[] counts) {
        List<String> bad = new ArrayList<>();
        for (JsonObject t : allTypes(m)) {
            String type = t.getString("type");
            if (blank(t, "label")) bad.add(type + ": нет русской подписи типа");
            triple(bad, t, type, "label", "labelEn", "labelPl");
            for (JsonObject f : objs(t, "fields")) triple(bad, f, type + ".field." + f.getString("key"), "label", "labelEn", "labelPl");
            for (JsonObject b : objs(t, "body")) triple(bad, b, type + ".body." + b.getString("key"), "label", "labelEn", "labelPl");
            for (JsonObject lt : objs(t, "linkTabs")) triple(bad, lt, type + ".tab." + lt.getString("key"), "label", "labelEn", "labelPl");
            for (JsonObject r : objs(t, "relations")) {
                counts[0]++;
                String at = type + ".rel." + r.getString("key");
                if (blank(r, "label")) bad.add(at + ": нет русской подписи");
                String key = r.getString("labelKey");
                if (key == null || !key.startsWith("pp.rel.")) bad.add(at + ": labelKey «" + key + "»");
                triple(bad, r, at, "label", "labelEn", "labelPl");
                triple(bad, r, at + "(обратная)", "inverseLabel", "inverseLabelEn", "inverseLabelPl");
                for (JsonObject p : objs(r, "props")) triple(bad, p, at + ".prop." + p.getString("key"), "label", "labelEn", "labelPl");
            }
        }
        return bad;
    }

    @Test
    void everyLabelHasRuEnPl() throws Exception {
        int[] counts = {0};
        List<String> bad = missing(canonJson(), counts);
        assertTrue(counts[0] >= 240, "положительный контроль: связей в каноне не меньше замера (240), есть " + counts[0]);
        assertEquals(List.of(), bad, "подписи модели без всех трёх языков");
    }

    @Test
    void sameRelationKeyMeansSameTexts() throws Exception {
        // Один ключ — одна подпись: иначе перевод по ключу покажет не то, что написано в модели.
        Map<String, String> seen = new HashMap<>();
        List<String> bad = new ArrayList<>();
        for (JsonObject t : allTypes(canonJson()))
            for (JsonObject r : objs(t, "relations")) {
                String k = r.getString("labelKey");
                if (k == null) continue;
                String texts = r.getString("label") + " | " + r.getString("labelEn") + " | " + r.getString("labelPl");
                String was = seen.putIfAbsent(k, texts);
                if (was != null && !was.equals(texts)) bad.add(k + ": «" + was + "» ≠ «" + texts + "»");
            }
        assertEquals(List.of(), bad);
    }

    @Test
    void relationWithoutPolishIsCaught() throws Exception {
        // Обратная проверка: снятый у одной связи labelPl сторож видит, а не принимает молча.
        JsonObject m = canonJson();
        JsonObject first = objs(objs(m, "types").get(0), "relations").get(0);
        first.remove("labelPl");
        first.put("labelPl", "");
        List<String> bad = missing(m, new int[]{0});
        assertEquals(1, bad.stream().filter(s -> s.endsWith("нет labelPl")).count(), String.valueOf(bad));
    }

    @Test
    @SuppressWarnings("unchecked")
    void contractCarriesRelationKeyAndTranslations() {
        // Кодек строгий: новые ключи связи обязаны быть компонентами записи, иначе канон не разберётся и до контракта не дойдёт.
        List<Map<String, Object>> rels = (List<Map<String, Object>>) LoreRecordRegistry.schemaJson("task").get("relations");
        Map<String, Object> dep = rels.stream().filter(r -> "dependsOn".equals(r.get("key"))).findFirst().orElseThrow();
        assertEquals("pp.rel.depends_on", dep.get("label_key"));
        assertEquals("Depends on", dep.get("label_en"));
        assertEquals("Zależy od", dep.get("label_pl"));
        assertEquals("Dependents", dep.get("inverse_label_en"));
        assertEquals("Zależne", dep.get("inverse_label_pl"));
        List<Map<String, Object>> props = (List<Map<String, Object>>) dep.get("props");
        Map<String, Object> reason = props.stream().filter(p -> "reason".equals(p.get("key"))).findFirst().orElseThrow();
        assertEquals("Reason", reason.get("label_en"));
        assertEquals("Powód", reason.get("label_pl"));
    }
}
