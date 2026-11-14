package studio.seer.heimdall.lore;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Откат кода при живой базе (вопрос «Стабильности» 14.11): модель — данные в LORE (MC-05), и прежний
 * образ читает версию, записанную новым кодом. Читатель обязан не упасть: то, что он понимает, — берёт;
 * чего не понимает в записи — честно откатывается на файл своего образа (LoreModelStore.load ловит
 * ошибку разбора, warning + source=file, в базу ничего не пишет).
 */
class LoreModelOlderReaderTest {

    static JsonObject newer() throws Exception {
        return new JsonObject(LoreModelLiveReplaceTest.canon());
    }

    /** Новый раздел верхнего уровня (как create/workflow для образа до них) — пропускается без отказа. */
    @Test
    void unknownTopLevelSectionIsSkipped() throws Exception {
        JsonObject m = newer();
        m.put("future_section", new JsonObject().put("x", 1));
        LoreModelFile.Content c = LoreModelFile.parse(m.encode());
        assertFalse(LoreModelFile.render(c).contains("future_section"), "незнакомое не выдумывается в выводе");
    }

    /** Новый тип записи (как agent/user для образа до S9-05) — читается как обычный тип, остальные не задеты. */
    @Test
    void unknownTypeIsReadWithoutBreakingOthers() throws Exception {
        JsonObject m = newer();
        JsonObject sprint = m.getJsonArray("types").stream().map(o -> (JsonObject) o)
            .filter(t -> "sprint".equals(t.getString("type"))).findFirst().orElseThrow();
        JsonObject future = sprint.copy().put("type", "future_kind").put("label", "Будущий тип");
        m.getJsonArray("types").add(future);
        m.getJsonObject("graph").put("future_kind", m.getJsonObject("graph").getJsonObject("sprint").copy());
        m.getJsonObject("time").put("future_kind", m.getJsonObject("time").getJsonObject("sprint").copy());
        LoreModelFile.Content c = LoreModelFile.parse(m.encode());
        assertTrue(c.types().contains("future_kind"));
        assertEquals("Спринт", c.typeDefs().get("sprint").label(), "известные типы прочитаны как есть");
    }

    /**
     * Новый ключ ВНУТРИ записи (поле с неизвестным свойством) — разбор отказывает словами. Это и есть путь
     * отката: LoreModelStore.load ловит отказ и работает по файлу образа, а не падает.
     */
    @Test
    void unknownNestedKeyIsRefusedWithWords() throws Exception {
        JsonObject m = newer();
        JsonArray types = m.getJsonArray("types");
        types.getJsonObject(0).getJsonArray("fields").getJsonObject(0).put("future_flag", true);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> LoreModelFile.parse(m.encode()));
        assertTrue(e.getMessage().contains("future_flag"), e.getMessage());
    }

    @Test
    void storeStartIsGuardedAgainstAParseRefusal() throws Exception {
        String src = java.nio.file.Files.readString(java.nio.file.Path.of(
            "src/main/java/studio/seer/heimdall/lore/LoreModelStore.java"));
        int load = src.indexOf("void load()");
        int end = src.indexOf("private void seed()", load);
        String body = src.substring(load, end);
        assertTrue(body.contains("catch (RuntimeException e)") && body.contains("source = \"file\""),
            "разбор модели из LORE на старте — под отказом с откатом на файл образа");
        assertTrue(List.of(body.split("\n")).stream().anyMatch(l -> l.contains("LoreModelFile.parse(text)")));
    }
}
