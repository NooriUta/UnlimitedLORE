package studio.seer.heimdall.lore;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * SPRINT_LORE_MODEL_AS_CONFIG/MC-06 — правка модели из экрана «Модель»: «Проверить» = PUT с dry_run.
 * Несогласованная правка отвергается 422 MODEL_INCONSISTENT с причиной словами и ничего не пишет;
 * согласованная — 200 и {@code dry_run: true}, без записи.
 *
 * <p>Чистый JUnit: хранилище без Quarkus. Схема графа не читается (ingest не подключён) — правила,
 * которым нужна схема, пропускаются; правила этого теста схемы не требуют.
 */
class LoreModelEditDryRunTest {

    static final ChangeAuthor ADMIN = new ChangeAuthor("omiloreadmin", ChangeAuthor.KIND_HUMAN);

    @AfterEach
    void restore() throws Exception {
        LoreModelFile.replace(LoreModelFile.parse(LoreModelLiveReplaceTest.canon()));
    }

    /** Поле title типа product в группе props — правка экрана «Модель». */
    static String titleOutOfHead() throws Exception {
        io.vertx.core.json.JsonObject m = new io.vertx.core.json.JsonObject(LoreModelLiveReplaceTest.canon());
        for (Object o : m.getJsonArray("types")) {
            io.vertx.core.json.JsonObject t = (io.vertx.core.json.JsonObject) o;
            if (!"product".equals(t.getString("type"))) continue;
            for (Object fo : t.getJsonArray("fields")) {
                io.vertx.core.json.JsonObject f = (io.vertx.core.json.JsonObject) fo;
                if ("title".equals(f.getString("key"))) f.put("group", "props");
            }
        }
        return m.encode();
    }

    @Test
    void dryRunOfInconsistentEditIs422WithTheReasonAndWritesNothing() throws Exception {
        LoreModelStore store = new LoreModelStore();
        String before = store.hash();
        LoreModelStore.Result r = store.save(titleOutOfHead(), null, null, true, ADMIN);
        assertEquals(422, r.status(), r.body().toString());
        assertEquals("MODEL_INCONSISTENT", r.body().get("error"));
        assertEquals(false, r.body().get("written"));
        @SuppressWarnings("unchecked") List<String> problems = (List<String>) r.body().get("problems");
        assertTrue(problems.stream().anyMatch(p -> p.contains("product.title") && p.contains("head")), problems.toString());
        assertEquals(before, store.hash(), "отказ ничего не меняет");
    }

    @Test
    void unknownGroupIsNamed() throws Exception {
        String bad = LoreModelLiveReplaceTest.canon().replaceFirst("\"group\" : \"props\"", "\"group\" : \"сбоку\"");
        assertNotEquals(LoreModelLiveReplaceTest.canon(), bad, "подмена группы сработала");
        LoreModelStore.Result r = new LoreModelStore().save(bad, null, null, true, ADMIN);
        assertEquals(422, r.status(), r.body().toString());
        assertTrue(r.body().get("problems").toString().contains("сбоку"), r.body().toString());
    }

    @Test
    void dryRunOfConsistentEditIsOkAndNotWritten() throws Exception {
        // Положительный контроль: смена подписи согласована, dry_run возвращает 200 и не пишет
        // (запись упала бы — клиента базы у хранилища нет).
        String text = LoreModelLiveReplaceTest.canon().replaceFirst("\"label\" : \"Название\"", "\"label\" : \"Имя\"");
        assertNotEquals(LoreModelLiveReplaceTest.canon(), text);
        LoreModelStore store = new LoreModelStore();
        LoreModelStore.Result r = store.save(text, null, null, true, ADMIN);
        assertEquals(200, r.status(), r.body().toString());
        assertEquals(true, r.body().get("dry_run"));
        assertEquals(true, r.body().get("changed"));
    }

    @Test
    void canonPassesTheNewRules() throws Exception {
        LoreModelFile.Content c = LoreModelFile.parse(LoreModelLiveReplaceTest.canon());
        assertEquals(List.of(), LoreModelConsistency.problems(c, null, null, id -> LoreSlices.get(id) != null));
    }
}
